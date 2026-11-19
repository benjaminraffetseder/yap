package desktopentry

import "testing"

func TestQuoteExec(t *testing.T) {
	for _, test := range []struct{ argument, want string }{
		{"/opt/Yap App/yap", `"/opt/Yap App/yap"`},
		{`/a"b$c` + "`" + `d\e%f`, `"/a\\"b\\$c\\` + "`" + `d\\\\e%%f"`},
		{"/a\nb\tc\rd", `"/a\nb\tc\rd"`},
	} {
		if got := QuoteExec(test.argument); got != test.want {
			t.Errorf("QuoteExec(%q) = %q; want %q", test.argument, got, test.want)
		}
	}
}
