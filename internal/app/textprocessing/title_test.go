package textprocessing

import (
	"strings"
	"testing"
)

func TestTitleNormalizationPreservesUnicodeLimitAndValidation(t *testing.T) {
	for _, tc := range []struct{ input, title, failure string }{
		{" \t`“Meeting\n notes”`  ", "Meeting notes", ""},
		{strings.Repeat("界", 90), strings.Repeat("界", 80), ""},
		{strings.Repeat("a", 79) + " " + "extra", strings.Repeat("a", 79), ""},
		{"\"\"", "", "the text model returned an empty title; try again"},
		{"bad\x1btitle", "", "the text model returned an invalid title; try again"},
		{string([]byte{0xff}), "", "the text model returned an invalid title; try again"},
	} {
		title, err := NormalizeTitle(tc.input)
		if title != tc.title || tc.failure == "" && err != nil || tc.failure != "" && (err == nil || err.Error() != tc.failure) {
			t.Fatalf("input %q: title %q, error %v", tc.input, title, err)
		}
	}
}
