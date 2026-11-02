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
		{"profile switched", State{Phase: "profile", Message: "Profile: Email"}, "Profile: Email", true, false, true},
		{"automatic profile", State{Phase: "recording", StartedAt: 35000, HistoryMode: "Saving", ProfileName: "Email"}, "1:05 · Saving · Email", true, true, false},
		{"unsaved recording", State{Phase: "recording", StartedAt: 35000, HistoryMode: "Not saving"}, "1:05 · Not saving", true, true, false},
		{"unsaved done", State{Phase: "done", Message: "Not saved to History", HistoryMode: "Not saving"}, "Not saved to history", true, true, true},
		{"unsaved processing failure", State{Phase: "done", Message: "Text processing failed: unavailable", HistoryMode: "Not saving"}, "Open Yap to recover text", true, true, false},
		{"idle", State{Phase: "idle"}, "", false, false, false},
		{"download", State{Phase: "downloading"}, "", false, false, false},
		{"recording", State{Phase: "recording", StartedAt: 35_000}, "Recording  1:05", true, true, false},
		{"clock adjustment", State{Phase: "recording", StartedAt: 101_000}, "Recording  0:00", true, true, false},
		{"transcribing", State{Phase: "transcribing"}, "Transcribing…", true, false, false},
		{"processing", State{Phase: "transcribing", Message: "Processing text…"}, "Processing text…", true, false, false},
		{"cancelling", State{Phase: "transcribing", Message: "Cancelling…"}, "Cancelling…", true, false, false},
		{"copied", State{Phase: "done", Message: "Copied to clipboard"}, "Copied to clipboard", true, true, true},
		{"paste requested", State{Phase: "done", Message: "Paste requested; copied to clipboard"}, "Paste requested", true, true, true},
		{"legacy unconfirmed paste", State{Phase: "done", Message: "Pasted into your application"}, "Dictation finished", true, true, true},
		{"paste fallback", State{Phase: "done", Message: "Focus changed"}, "Dictation finished", true, true, true},
		{"clipboard failed", State{Phase: "done", Message: "Saved to history; clipboard failed: unavailable"}, "Open Yap to recover text", true, true, false},
		{"processing failed", State{Phase: "done", Message: "Saved to History; text processing failed: unavailable"}, "Open Yap to recover text", true, true, false},
		{"history write failure", State{Phase: "done", Message: "Transcript ready; History save failed. Save or copy it from Home.", HistoryMode: "Saving"}, "Open Yap to recover text", true, true, false},
		{"paste failure", State{Phase: "done", Message: "Automatic paste failed; copied to clipboard. Paste manually."}, "Open Yap to recover text", true, true, false},
		{"processing cancelled saved", State{Phase: "done", Message: "Text processing cancelled; transcript saved to History"}, "Open Yap to recover text", true, true, false},
		{"typed warning", State{Phase: "done", Warning: true, Message: "Review this result"}, "Open Yap to recover text", true, true, false},
		{"unknown History mention", State{Phase: "done", Message: "History not checked"}, "Dictation finished", true, true, true},
		{"unknown done", State{Phase: "done"}, "Dictation finished", true, true, true},
		{"known saved", State{Phase: "done", Message: "Saved to History"}, "Saved to history", true, true, true},
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
