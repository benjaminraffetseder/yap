package vocabulary

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

type Entry struct {
	ID        string   `json:"id"`
	Canonical string   `json:"canonical"`
	Aliases   []string `json:"aliases"`
	Enabled   bool     `json:"enabled"`
}

// RE2 (?i) and EqualFold use Unicode simple folding, not lowercase equality.
func foldKey(text string) string {
	return strings.Map(func(r rune) rune {
		smallest := r
		for next := unicode.SimpleFold(r); next != r; next = unicode.SimpleFold(next) {
			if next < smallest {
				smallest = next
			}
		}
		return smallest
	}, text)
}

func Normalize(entries []Entry) ([]Entry, error) {
	if len(entries) > 100 {
		return nil, fmt.Errorf("use at most 100 vocabulary entries")
	}
	out := make([]Entry, 0, len(entries))
	ids, phrases := map[string]bool{}, map[string]string{}
	for _, entry := range entries {
		if entry.ID == "" || len(entry.ID) > 64 || ids[entry.ID] {
			return nil, fmt.Errorf("vocabulary entry IDs must be unique")
		}
		ids[entry.ID] = true
		entry.Canonical = strings.TrimSpace(entry.Canonical)
		if err := validPhrase(entry.Canonical); err != nil {
			return nil, err
		}
		if len(entry.Aliases) > 10 {
			return nil, fmt.Errorf("use at most 10 aliases per term")
		}
		aliases, own := []string{}, map[string]bool{}
		for _, phrase := range append([]string{entry.Canonical}, entry.Aliases...) {
			phrase = strings.TrimSpace(phrase)
			if err := validPhrase(phrase); err != nil {
				return nil, err
			}
			key := foldKey(phrase)
			if owner, found := phrases[key]; found && owner != entry.ID {
				return nil, fmt.Errorf("%q is already assigned to another vocabulary term", phrase)
			}
			phrases[key] = entry.ID
			if !own[key] && key != foldKey(entry.Canonical) {
				aliases = append(aliases, phrase)
			}
			own[key] = true
		}
		entry.Aliases = aliases
		out = append(out, entry)
	}
	return out, nil
}

func validPhrase(phrase string) error {
	if phrase == "" || utf8.RuneCountInString(phrase) > 80 || strings.ContainsFunc(phrase, unicode.IsControl) {
		return fmt.Errorf("vocabulary phrases must contain 1–80 characters without line breaks")
	}
	return nil
}

// Whisper has a bounded initial context. Keep complete terms, rather than
// cutting a word in half or constructing an unbounded process command line.
func Prompt(entries []Entry) string {
	terms, size := []string{}, 0
	for _, entry := range entries {
		if !entry.Enabled {
			continue
		}
		n := utf8.RuneCountInString(entry.Canonical) + 2
		if size+n > 1000 {
			break
		}
		terms = append(terms, entry.Canonical)
		size += n
	}
	return strings.Join(terms, ", ")
}

func word(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsNumber(r) || unicode.IsMark(r) || r == '_'
}
func boundary(text string, start, end int) bool {
	if start > 0 {
		r, _ := utf8.DecodeLastRuneInString(text[:start])
		if word(r) {
			return false
		}
	}
	if end < len(text) {
		r, _ := utf8.DecodeRuneInString(text[end:])
		if word(r) {
			return false
		}
	}
	return true
}

// Replace in one pass so aliases never cascade into another correction. Literal
// escaping and Unicode boundaries protect larger words and technical symbols.
func Apply(text string, entries []Entry) string {
	phrases, replacements := []string{}, map[string]string{}
	for _, entry := range entries {
		if !entry.Enabled {
			continue
		}
		for _, phrase := range append([]string{entry.Canonical}, entry.Aliases...) {
			key := foldKey(phrase)
			if _, exists := replacements[key]; !exists {
				phrases = append(phrases, phrase)
				replacements[key] = entry.Canonical
			}
		}
	}
	if len(phrases) == 0 {
		return text
	}
	sort.SliceStable(phrases, func(i, j int) bool { return len(phrases[i]) > len(phrases[j]) })
	for i := range phrases {
		phrases[i] = regexp.QuoteMeta(phrases[i])
	}
	pattern := regexp.MustCompile("(?i)(" + strings.Join(phrases, "|") + ")")
	fallbacks := make([]*regexp.Regexp, len(phrases))
	var out strings.Builder
	last := 0
	for search := 0; search < len(text); {
		match := pattern.FindStringIndex(text[search:])
		if match == nil {
			break
		}
		start, end := search+match[0], search+match[1]
		validStart := start == 0
		if start > 0 {
			previous, _ := utf8.DecodeLastRuneInString(text[:start])
			validStart = !word(previous)
		}
		valid := validStart && boundary(text, start, end)
		if validStart && !valid {
			// RE2 chooses the first alternative before we can check its suffix.
			// Retry shorter phrases at this start when a longer prefix is invalid.
			for i, phrase := range phrases {
				if fallbacks[i] == nil {
					fallbacks[i] = regexp.MustCompile("(?i)^" + phrase)
				}
				candidate := fallbacks[i].FindStringIndex(text[start:])
				if candidate != nil && boundary(text, start, start+candidate[1]) {
					end, valid = start+candidate[1], true
					break
				}
			}
		}
		if !valid {
			// A rejected interior prefix must not consume a later valid phrase.
			_, width := utf8.DecodeRuneInString(text[start:])
			search = start + width
			continue
		}
		out.WriteString(text[last:start])
		value, found := replacements[foldKey(text[start:end])]
		if !found { // RE2 Unicode folding also matches forms such as long-s.
			for phrase, canonical := range replacements {
				if strings.EqualFold(phrase, text[start:end]) {
					value = canonical
					break
				}
			}
		}
		out.WriteString(value)
		last, search = end, end
	}
	out.WriteString(text[last:])
	return out.String()
}
