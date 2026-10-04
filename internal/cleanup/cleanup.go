// Package cleanup applies conservative local rules, without a language model.
package cleanup

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

var words = regexp.MustCompile(`[\pL\pM]+`)
var tokens = regexp.MustCompile(`\S+`)
var horizontalSpace = regexp.MustCompile(`[ \t]+`)
var beforePunctuation = regexp.MustCompile(`[ \t]+([,.;:!?])`)
var afterPunctuation = regexp.MustCompile(`([,;!?])([^\s\d,;.!?\)\]\}])`)
var duplicateComma = regexp.MustCompile(`,{2,}`)

func technical(token string) bool {
	if strings.ContainsAny(token, "/@_\\") {
		return true
	}
	runes := []rune(token)
	for i, r := range runes {
		if r == '.' && i > 0 && i+1 < len(runes) && (unicode.IsLetter(runes[i-1]) || unicode.IsNumber(runes[i-1])) && (unicode.IsLetter(runes[i+1]) || unicode.IsNumber(runes[i+1])) {
			return true
		}
	}
	return false
}

func identifier(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsNumber(r) || unicode.IsMark(r) || r == '_'
}
func standalone(text string, start, end int) bool {
	if start > 0 {
		r, _ := utf8.DecodeLastRuneInString(text[:start])
		if identifier(r) {
			return false
		}
	}
	if end < len(text) {
		r, _ := utf8.DecodeRuneInString(text[end:])
		if identifier(r) {
			return false
		}
	}
	return true
}

func Apply(text, language string, protected ...string) string {
	var spans [][]int
	for _, term := range protected {
		if term == "" {
			continue
		}
		pattern := regexp.MustCompile("(?i)" + regexp.QuoteMeta(term))
		for search := 0; search < len(text); {
			match := pattern.FindStringIndex(text[search:])
			if match == nil {
				break
			}
			start, end := search+match[0], search+match[1]
			if standalone(text, start, end) {
				spans = append(spans, []int{start, end})
			}
			// Advance from the start to retain overlapping protected occurrences.
			_, width := utf8.DecodeRuneInString(text[start:])
			search = start + width
		}
	}
	var out strings.Builder
	last, removed := 0, false
	for _, match := range words.FindAllStringIndex(text, -1) {
		term := strings.ToLower(text[match[0]:match[1]])
		filler := (language == "en" || language == "auto") && (term == "uh" || term == "erm")
		if language == "de" || language == "auto" {
			filler = filler || term == "äh" || term == "ähm"
		}
		if language == "en" {
			filler = filler || term == "um"
		}
		// "um" is meaningful German. Auto mode removes it only when a following
		// comma explicitly marks it as a disfluency.
		if language == "auto" && term == "um" {
			filler = strings.HasPrefix(strings.TrimLeft(text[match[1]:], " \t"), ",")
		}
		if !filler {
			continue
		}
		if match[0] < last {
			continue
		}
		if !standalone(text, match[0], match[1]) {
			continue
		}
		start := strings.LastIndexFunc(text[:match[0]], unicode.IsSpace) + 1
		end := strings.IndexFunc(text[match[1]:], unicode.IsSpace)
		if end < 0 {
			end = len(text) - match[1]
		}
		if technical(text[start : match[1]+end]) {
			continue
		}
		keep := false
		for _, span := range spans {
			if match[0] >= span[0] && match[1] <= span[1] {
				keep = true
				break
			}
		}
		if keep {
			continue
		}
		out.WriteString(text[last:match[0]])
		end = match[1]
		for end < len(text) && (text[end] == ' ' || text[end] == '\t') {
			end++
		}
		if end < len(text) && text[end] == ',' {
			end++
		}
		last, removed = end, true
	}
	out.WriteString(text[last:])
	result := horizontalSpace.ReplaceAllString(out.String(), " ")
	result = beforePunctuation.ReplaceAllString(result, "$1")
	result = tokens.ReplaceAllStringFunc(result, func(token string) string {
		if technical(token) {
			return token
		}
		return duplicateComma.ReplaceAllString(afterPunctuation.ReplaceAllString(token, "$1 $2"), ",")
	})
	result = strings.TrimSpace(result)
	if removed {
		result = strings.TrimLeft(result, ", .:;!?")
	}
	if result == "" || (removed && !strings.ContainsFunc(result, func(r rune) bool { return unicode.IsLetter(r) || unicode.IsNumber(r) })) {
		return text
	} // Never erase an entire dictation.
	// Preserve existing camel-case words; capitalization does not rewrite names.
	runes := []rune(result)
	capitalize := true
	for i, r := range runes {
		if capitalize && unicode.IsLetter(r) {
			end, mixed := i+1, false
			for end < len(runes) && unicode.IsLetter(runes[end]) {
				mixed = mixed || unicode.IsUpper(runes[end])
				end++
			}
			technical := false
			for j := i; j < len(runes) && !unicode.IsSpace(runes[j]); j++ {
				if strings.ContainsRune("/@_\\", runes[j]) || (runes[j] == '.' && j+1 < len(runes) && (unicode.IsLetter(runes[j+1]) || unicode.IsNumber(runes[j+1]))) {
					technical = true
				}
			}
			if !mixed && !technical {
				runes[i] = unicode.ToUpper(r)
			}
			capitalize = false
		} else if r == '\n' || ((r == '.' || r == '?' || r == '!') && i+1 < len(runes) && unicode.IsSpace(runes[i+1])) {
			capitalize = true
		} else if !unicode.IsSpace(r) && r != '"' && r != '\'' && r != '(' {
			capitalize = false
		}
	}
	result = string(runes)
	lastRune, _ := utf8.DecodeLastRuneInString(result)
	if unicode.IsLetter(lastRune) || unicode.IsNumber(lastRune) {
		result += "."
	}
	return result
}
