package textprocessing

import (
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"
)

func NormalizeTitle(output string) (string, error) {
	if !utf8.ValidString(output) || strings.IndexFunc(output, func(r rune) bool {
		return unicode.IsControl(r) && !unicode.IsSpace(r)
	}) >= 0 {
		return "", errors.New("the text model returned an invalid title; try again")
	}
	title := strings.Trim(strings.Join(strings.Fields(output), " "), "\"“”`")
	runes := []rune(title)
	if len(runes) > 80 {
		title = strings.TrimSpace(string(runes[:80]))
	}
	if title == "" {
		return "", errors.New("the text model returned an empty title; try again")
	}
	return title, nil
}
