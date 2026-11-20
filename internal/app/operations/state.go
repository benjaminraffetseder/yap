// Package operations defines the shared availability and resource-ownership rules.
// State is an immutable view; its caller owns synchronization and worker lifetime.
package operations

import "errors"

type State struct {
	Closing, DatabaseReady                bool
	Message, Phase                        string
	ShortcutRegistration, ShortcutCapture bool
	HomeResult, Import                    bool
}

func (s State) Available() error {
	if s.Closing {
		return errors.New("app is shutting down")
	}
	if !s.DatabaseReady {
		return errors.New("local database unavailable: " + s.Message)
	}
	return nil
}

func (s State) Busy() bool {
	if s.ShortcutRegistration || s.ShortcutCapture || s.HomeResult || s.Import {
		return true
	}
	switch s.Phase {
	case "backup", "text-processing", "recording", "transcribing", "downloading", "mic-test", "diagnostic-recording", "diagnostic-transcribing":
		return true
	}
	return false
}

func (s State) HistoryAvailable() error {
	if err := s.Available(); err != nil {
		return err
	}
	if s.Phase == "backup" {
		return errors.New("finish or cancel the backup before accessing History")
	}
	if s.HomeResult {
		return errors.New("finish the result action before accessing History")
	}
	return nil
}
