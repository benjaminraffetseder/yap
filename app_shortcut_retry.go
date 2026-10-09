package main

import "errors"

// Retry the saved shortcut after a permission change without changing settings
// or disturbing a working registration. Native macOS code prompts only once.
func (a *App) RetryShortcut() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.available(); err != nil {
		return err
	}
	if a.busy() {
		return errors.New("finish the current operation before retrying the shortcut")
	}
	if a.shortcut != nil {
		return nil
	}
	a.registerShortcut()
	a.emit()
	// Registration failures remain in ShortcutError, including after an
	// asynchronous permission prompt. Do not turn them into dictation errors.
	return nil
}
