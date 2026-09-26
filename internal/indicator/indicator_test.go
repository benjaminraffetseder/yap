package indicator

import (
	"testing"
	"time"
)

func TestPresentation(t *testing.T) {
	now := time.UnixMilli(100_000)
	for _, test := range []struct {
		name                   string
		state                  State
		label                  string
		visible, stop, expires bool
	}{
		{"idle", State{Phase: "idle"}, "", false, false, false},
		{"download", State{Phase: "downloading"}, "", false, false, false},
		{"recording", State{Phase: "recording", StartedAt: 35_000}, "Recording  1:05", true, true, false},
		{"clock adjustment", State{Phase: "recording", StartedAt: 101_000}, "Recording  0:00", true, true, false},
		{"transcribing", State{Phase: "transcribing"}, "Transcribing…", true, false, false},
		{"cancelling", State{Phase: "transcribing", Message: "Cancelling…"}, "Cancelling…", true, false, false},
		{"copied", State{Phase: "done", Message: "Copied to clipboard"}, "Copied to clipboard", true, false, true},
		{"pasted", State{Phase: "done", Message: "Pasted into your application"}, "Pasted", true, false, true},
		{"paste fallback", State{Phase: "done", Message: "Focus changed"}, "Ready to paste", true, false, true},
		{"clipboard failed", State{Phase: "done", Message: "Saved to history; clipboard failed: unavailable"}, "Saved to history", true, false, true},
		{"failed", State{Phase: "error"}, "Dictation failed", true, true, true},
		{"cancelled", State{Phase: "idle", Message: "Transcription cancelled"}, "Cancelled", true, false, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			v := presentation(test.state, now)
			if v.label != test.label || v.visible != test.visible || (v.stop != "") != test.stop || (v.dismissAfter > 0) != test.expires {
				t.Fatalf("unexpected presentation: %+v", v)
			}
		})
	}
}
