package vocabulary

import (
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestNormalizeAndValidate(t *testing.T) {
	entries := []Entry{{ID: "one", Canonical: " PostgreSQL ", Aliases: []string{"postgres", " POSTGRES ", "postgresql"}, Enabled: true}}
	got, err := Normalize(entries)
	if err != nil || got[0].Canonical != "PostgreSQL" || !reflect.DeepEqual(got[0].Aliases, []string{"postgres"}) {
		t.Fatalf("normalization: %+v %v", got, err)
	}
	got[0].Aliases[0] = "changed"
	if entries[0].Aliases[0] != "postgres" {
		t.Fatal("normalization mutated input")
	}
	for _, bad := range [][]Entry{
		{{ID: "one", Canonical: ""}},
		{{ID: "one", Canonical: "line\nbreak"}},
		{{ID: "one", Canonical: strings.Repeat("ä", 81)}},
		{{ID: "one", Canonical: "term"}, {ID: "one", Canonical: "other"}},
		{{ID: "one", Canonical: "term"}, {ID: "two", Canonical: "other", Aliases: []string{"TERM"}}},
	} {
		if _, err := Normalize(bad); err == nil {
			t.Fatalf("accepted invalid vocabulary: %+v", bad)
		}
	}
}

func TestAliasesAreLiteralBoundedAndNonCascading(t *testing.T) {
	entries := []Entry{
		{ID: "a", Canonical: "PostgreSQL", Aliases: []string{"post gre SQL", "postgres"}, Enabled: true},
		{ID: "b", Canonical: "C++", Aliases: []string{"c plus plus"}, Enabled: true},
		{ID: "c", Canonical: ".NET", Aliases: []string{"dot net"}, Enabled: true},
		{ID: "d", Canonical: "Disabled", Aliases: []string{"old"}},
		{ID: "e", Canonical: "Science", Enabled: true},
	}
	input := "POST GRE SQL and postgres; c plus plus, dot net, old. xpostgres postgres2 postgres_thing Äpostgres. ſcience"
	want := "PostgreSQL and PostgreSQL; C++, .NET, old. xpostgres postgres2 postgres_thing Äpostgres. Science"
	if got := Apply(input, entries); got != want {
		t.Fatalf("got %q", got)
	}
	if got := Apply("alpha", []Entry{{Canonical: "beta", Aliases: []string{"alpha"}, Enabled: true}, {Canonical: "gamma", Aliases: []string{"beta"}, Enabled: true}}); got != "beta" {
		t.Fatalf("cascaded replacement: %q", got)
	}
	if got := Prompt(entries); got != "PostgreSQL, C++, .NET, Science" {
		t.Fatalf("prompt: %q", got)
	}
	long := []Entry{}
	for i := 0; i < 100; i++ {
		long = append(long, Entry{Canonical: strings.Repeat("ü", 80), Enabled: true})
	}
	if utf8.RuneCountInString(Prompt(long)) > 1000 {
		t.Fatal("unbounded prompt")
	}
}
