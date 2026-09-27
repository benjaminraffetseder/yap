package cleanup

import "testing"

func TestConservativeCleanup(t *testing.T) {
	for _, tc := range []struct{ name, input, lang, want string }{
		{"english", "um,  hello ,world! uh we can ship", "en", "Hello, world! We can ship."},
		{"german", "ähm, wir treffen uns um fünf Uhr", "de", "Wir treffen uns um fünf Uhr."},
		{"auto german", "um fünf Uhr", "auto", "Um fünf Uhr."},
		{"auto filler", "um, hello", "auto", "Hello."},
		{"other language", "um uh erm", "fr", "Um uh erm."},
		{"technical", "https://example.com/api uses uh2 and uh_oh with 3.14", "en", "https://example.com/api uses uh2 and uh_oh with 3.14."},
		{"names", "iPhone works with PostgreSQL", "en", "iPhone works with PostgreSQL."},
		{"paragraphs", "hello\nworld", "en", "Hello\nWorld."},
		{"only filler", "um uh", "en", "um uh"},
		{"only punctuated filler", "um. uh!", "en", "um. uh!"},
		{"leading filler sentence", "um. hello", "en", "Hello."},
		{"technical punctuation", "uh.example.com?q=1,hello user@um.com", "en", "uh.example.com?q=1,hello user@um.com."},
		{"meaning", "I like this, you know?", "en", "I like this, you know?"},
		{"empty", "", "auto", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := Apply(tc.input, tc.lang)
			if got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
			if twice := Apply(got, tc.lang); twice != got {
				t.Fatalf("cleanup changed on second pass: %q", twice)
			}
		})
	}
}

func TestVocabularyFillersAreProtected(t *testing.T) {
	if got := Apply("um, install Uh Tools", "en", "Uh Tools"); got != "Install Uh Tools." {
		t.Fatalf("vocabulary removed: %q", got)
	}
}
