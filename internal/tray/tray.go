package tray

// Controller owns the native tray/menu-bar item. Update must not wait on the
// application's UI thread: the caller may hold the recording state lock.
type Controller interface {
	Update(State)
	Close()
}

type State struct {
	Phase               string
	Completion          string
	Warning             bool
	Ready               bool
	Busy                bool
	SaveHistory         bool
	HistoryLocked       bool
	ResultAvailable     bool
	ShortcutUnavailable bool
}

type Actions struct {
	ToggleHistory func()
	Show          func()
	Record        func()
	Cancel        func()
	Quit          func()
	Result        func()
	History       func()
	Settings      func()
	FixShortcut   func()
}

const (
	showAction = iota + 1
	recordAction
	cancelAction
	quitAction
	historyAction
	resultAction
	openHistoryAction
	settingsAction
	shortcutAction
)

type view struct {
	status, record               string
	recordEnabled, cancelEnabled bool
}

func presentation(s State) view {
	v := view{status: "Ready", record: "Start recording", recordEnabled: s.Ready}
	if !s.Ready {
		v.status = "Set up a speech model"
	}
	switch s.Phase {
	case "recording":
		v = view{status: "Recording", record: "Stop recording", recordEnabled: true, cancelEnabled: true}
	case "transcribing":
		v.status, v.recordEnabled, v.cancelEnabled = "Transcribing…", false, true
	case "text-processing":
		v.status, v.recordEnabled, v.cancelEnabled = "Processing text…", false, true
	case "downloading":
		v.status, v.recordEnabled, v.cancelEnabled = "Downloading…", false, true
	case "mic-test":
		v.status, v.recordEnabled, v.cancelEnabled = "Testing microphone…", false, true
	case "shortcut-capture":
		v.status, v.recordEnabled = "Choosing a shortcut…", false
	case "backup":
		v.status, v.recordEnabled, v.cancelEnabled = "Managing backup…", false, true
	case "diagnostic-recording", "diagnostic-transcribing":
		v.status, v.recordEnabled, v.cancelEnabled = "Testing dictation…", false, true
	case "error":
		v.status = "Dictation failed"
	case "done":
		v.status = "Dictation finished"
		if s.Warning {
			v.status = "Transcript ready — action needed"
		} else {
			switch s.Completion {
			case "Copied to clipboard", "Saved to History", "Not saved to History":
				v.status = s.Completion
			case "Paste requested; copied to clipboard":
				v.status = "Paste requested"
			}
		}
	case "closing":
		v.status, v.recordEnabled = "Quitting…", false
	}
	if s.Busy && s.Phase != "recording" {
		v.recordEnabled = false
	}
	return v
}

// The Wails adapter enforces disabled actions, including callbacks
// arriving just after recording state changes while the menu is open.
func (a Actions) dispatch(id int, s State) {
	v := presentation(s)
	var callback func()
	switch id {
	case showAction:
		callback = a.Show
	case recordAction:
		if v.recordEnabled {
			callback = a.Record
		}
	case cancelAction:
		if v.cancelEnabled {
			callback = a.Cancel
		}
	case historyAction:
		if s.Phase != "closing" && s.Phase != "backup" && !s.HistoryLocked {
			callback = a.ToggleHistory
		}
	case resultAction:
		if s.ResultAvailable && !s.Busy && s.Phase != "closing" {
			callback = a.Result
		}
	case openHistoryAction:
		if s.Phase != "closing" {
			callback = a.History
		}
	case settingsAction:
		if s.Phase != "closing" {
			callback = a.Settings
		}
	case shortcutAction:
		if s.ShortcutUnavailable && s.Phase != "closing" {
			callback = a.FixShortcut
		}
	case quitAction:
		callback = a.Quit
	}
	if callback != nil {
		go callback() // Native callbacks must not wait for shutdown of their own UI.
	}
}
