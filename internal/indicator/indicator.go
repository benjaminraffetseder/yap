package indicator

import (
	"fmt"
	"strings"
	"time"
)

// Controller owns an independent, non-activating status window.
type Controller interface {
	Update(State)
	SetLevel(float64)
	Close()
}

type State struct {
	Phase     string
	Message   string
	StartedAt int64
}

type Actions struct {
	Stop   func()
	Cancel func()
	Show   func()
}

type view struct {
	visible      bool
	label        string
	stop         string
	cancel       string
	dismissAfter time.Duration
}

func presentation(s State, now time.Time) view {
	switch s.Phase {
	case "recording":
		seconds := max(int64(0), (now.UnixMilli()-s.StartedAt)/1000)
		return view{visible: true, label: fmt.Sprintf("Recording  %d:%02d", seconds/60, seconds%60), stop: "Stop", cancel: "Cancel"}
	case "transcribing":
		label := "Transcribing…"
		if s.Message == "Processing text…" {
			label = "Processing text…"
		}
		if strings.Contains(s.Message, "Cancelling") {
			label = "Cancelling…"
		}
		return view{visible: true, label: label, cancel: "Cancel"}
	case "done":
		label := "Ready to paste"
		switch s.Message {
		case "Copied to clipboard":
			label = "Copied to clipboard"
		case "Pasted into your application":
			label = "Pasted"
		default:
			if strings.Contains(s.Message, "clipboard failed") || strings.Contains(s.Message, "History") {
				label = "Saved to history"
			}
		}
		return view{visible: true, label: label, cancel: "Dismiss", dismissAfter: 2500 * time.Millisecond}
	case "error":
		return view{visible: true, label: "Dictation failed", stop: "Open Yap", cancel: "Dismiss", dismissAfter: 6 * time.Second}
	case "idle":
		if strings.Contains(strings.ToLower(s.Message), "cancelled") || strings.Contains(s.Message, "discarded") {
			return view{visible: true, label: "Cancelled", cancel: "Dismiss", dismissAfter: 1500 * time.Millisecond}
		}
	}
	return view{}
}
