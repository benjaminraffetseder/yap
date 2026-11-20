package app

import (
	"yap/internal/app/operations"
	"yap/internal/indicator"
)

type Status struct {
	ImportID             string  `json:"importId,omitempty"`
	ProfileID            string  `json:"profileId,omitempty"`
	ProfileShortcutError string  `json:"profileShortcutError,omitempty"`
	CompletionWarning    bool    `json:"completionWarning,omitempty"`
	Phase                string  `json:"phase"`
	Message              string  `json:"message"`
	StartedAt            int64   `json:"startedAt"`
	Transcript           string  `json:"transcript"`
	Progress             float64 `json:"progress"`
	ShortcutError        string  `json:"shortcutError"`
	IndicatorError       string  `json:"indicatorError"`
	TrayError            string  `json:"trayError"`
	StartupError         string  `json:"startupError"`
	HistoryError         string  `json:"historyError"`
}

// The caller holds mu. Publication also wakes queues in import-first order.
func (a *App) emitStatusLocked() {
	if a.imports.ActiveID() == "" && a.busyLocked() {
		a.status.ImportID = ""
	}
	if a.ctx != nil && !a.closing {
		a.updateTrayLocked()
		if a.indicator != nil && a.indicatorActive {
			historyMode := "Saving"
			if !a.recordSettings.SaveHistory {
				historyMode = "Not saving"
			}
			profileName := a.profiles.ProfileName(a.status.ProfileID)
			a.indicator.Update(indicator.State{
				SessionID: a.id, ProfileName: profileName, HistoryMode: historyMode,
				Phase: a.status.Phase, Message: a.status.Message,
				StartedAt: a.status.StartedAt, Warning: a.status.CompletionWarning,
			})
			if a.status.Phase != "recording" && a.status.Phase != "transcribing" {
				a.indicatorActive = false
			}
		}
		a.event("dictation:status", a.status)
	}
	a.pumpQueuesLocked()
}

// event also serves audio callbacks that do not hold mu. The notification
// adapter is installed before capture starts and remains valid through shutdown.
func (a *App) event(topic string, data ...interface{}) {
	if a.notify != nil {
		a.notify(topic, data...)
	}
}

func (a *App) failLocked(err error) {
	a.status.Phase = "error"
	a.status.Message = err.Error()
	a.status.StartedAt = 0
	a.emitStatusLocked()
}

func (a *App) availableLocked() error {
	return a.operationStateLocked().Available()
}

func (a *App) busyLocked() bool {
	return a.operationStateLocked().Busy()
}

func (a *App) operationStateLocked() operations.State {
	return operations.State{
		Closing: a.closing, DatabaseReady: a.store != nil, Message: a.status.Message, Phase: a.status.Phase,
		ShortcutRegistration: a.shortcuts.Registering(), ShortcutCapture: a.shortcuts.Capturing(),
		HomeResult: a.homeResultOperation, Import: a.imports.ActiveID() != "",
	}
}

// Never wait for a backup transaction while holding the application mutex:
// cancellation and shutdown need that mutex to release the transaction.
func (a *App) historyAvailableLocked() error {
	return a.operationStateLocked().HistoryAvailable()
}

// Imports reserve their pending start before bulk work can claim the text engine.
func (a *App) pumpQueuesLocked() {
	a.pumpImportQueueLocked()
	a.pumpBulkTextQueueLocked()
}
