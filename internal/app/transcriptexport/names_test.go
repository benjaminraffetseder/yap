package transcriptexport

import (
	"strings"
	"testing"
)

func TestTranscriptExportNamesStayPortable(t *testing.T) {
	for _, input := range []string{"../\\bad:*?\"<>|", "CON", "NUL.txt", "COM1", "LPT¹", " . ", "é日本語😀", strings.Repeat("界", 200), "a\n\x00b"} {
		name := safeExportName(input, "output")
		if name == "" || name == "." || name == ".." || strings.ContainsAny(name, "<>:\"/\\|?*\n\x00") || len(name) > 200 || strings.HasSuffix(name, ".") {
			t.Fatalf("unsafe filename %q for %q", name, input)
		}
		if strings.HasPrefix(input, "CON") || strings.HasPrefix(input, "NUL") || strings.HasPrefix(input, "COM1") || strings.HasPrefix(input, "LPT") {
			if !strings.HasPrefix(name, "_") {
				t.Fatalf("reserved device name: %s", name)
			}
		}
	}
	used := map[string]bool{}
	if uniqueExportName("Summary", ".md", used) != "Summary.md" || uniqueExportName("summary", ".md", used) != "summary-2.md" {
		t.Fatal("case-insensitive collision was not handled")
	}
}
