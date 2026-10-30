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
	SetTheme(dark bool)
	Close()
}

type State struct {
	SessionID   string
	ProfileName string
	Phase       string
	Message     string
	StartedAt   int64
	HistoryMode string
}

type Actions struct {
	Stop   func(sessionID string)
	Cancel func(sessionID string)
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
	case "profile":
		return view{visible: true, label: s.Message, cancel: "Dismiss", dismissAfter: 2500 * time.Millisecond}
	case "recording":
		seconds := max(int64(0), (now.UnixMilli()-s.StartedAt)/1000)
		label := fmt.Sprintf("Recording  %d:%02d", seconds/60, seconds%60)
		if s.HistoryMode != "" {
			label = fmt.Sprintf("%d:%02d · %s", seconds/60, seconds%60, s.HistoryMode)
		}
		if s.ProfileName != "" {
			label += " · " + s.ProfileName
		}
		return view{visible: true, label: label, stop: "Stop", cancel: "Cancel"}
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
		message := strings.ToLower(s.Message)
		if strings.Contains(message, "failed") || strings.Contains(message, "cancelled") {
			return view{visible: true, label: "Open Yap to recover text", stop: "Open Yap", cancel: "Dismiss", dismissAfter: 6 * time.Second}
		}
		label := "Dictation finished"
		switch s.Message {
		case "Copied to clipboard":
			label = "Copied to clipboard"
		case "Paste requested; copied to clipboard":
			label = "Paste requested"
		case "Saved to History":
			label = "Saved to history"
		case "Not saved to History":
			label = "Not saved to history"
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
