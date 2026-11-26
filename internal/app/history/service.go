// Package history owns history mutation policy and saved audio reads.
package history

import (
	"database/sql"
	"encoding/base64"
	"errors"
	"time"

	"yap/internal/storage"
)

type Current struct{ ID, Phase string }

// Change describes a current-result update to publish after a storage mutation.
type Change struct {
	Changed       bool
	Refresh       bool
	Text, Message string
}

func Session(store *storage.Store, id string) (*storage.Session, error) {
	entry, err := store.Session(id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &entry, nil
}

func Edit(store *storage.Store, current Current, id, text string) (Change, error) {
	return edit(current, id, text, func() error { return store.UpdateTranscript(id, text) })
}

func EditChecked(store *storage.Store, current Current, id, text, expectedText string) (Change, error) {
	return edit(current, id, text, func() error { return store.UpdateTranscriptChecked(id, text, expectedText) })
}

func edit(current Current, id, text string, save func() error) (Change, error) {
	if id == current.ID && current.Phase == "transcribing" {
		return Change{}, errors.New("finish the current dictation before editing its transcript")
	}
	if err := save(); err != nil {
		return Change{}, err
	}
	if id == current.ID && current.Phase == "done" {
		return Change{Changed: true, Text: text, Message: "Transcript updated in History"}, nil
	}
	return Change{}, nil
}

func EditOutput(store *storage.Store, current Current, sessionID, outputID, text, expectedText string) (storage.GeneratedOutput, error) {
	if sessionID == current.ID && current.Phase == "transcribing" {
		return storage.GeneratedOutput{}, errors.New("finish the current dictation before editing its output")
	}
	return store.UpdateGeneratedOutput(sessionID, outputID, text, expectedText)
}

func Trash(store *storage.Store, current Current, ids []string) (Change, error) {
	if current.Phase == "transcribing" {
		for _, id := range ids {
			if id == current.ID {
				return Change{}, errors.New("finish the current dictation before deleting its transcript")
			}
		}
	}
	err := store.TrashSessions(ids, time.Now())
	change := Removed(store, current)
	change.Refresh = true
	return change, err
}

func Removed(store *storage.Store, current Current) Change {
	if current.ID == "" || current.Phase != "done" {
		return Change{}
	}
	if _, err := store.Session(current.ID); errors.Is(err, sql.ErrNoRows) {
		return Change{Changed: true, Message: "Dictation removed from History"}
	}
	return Change{}
}

// Audio captures identity under the operation lock, then reads bytes outside it.
type Audio struct {
	store *storage.Store
	path  string
}

func PrepareAudio(store *storage.Store, id string) (Audio, error) {
	entry, err := store.Session(id)
	return Audio{store: store, path: entry.AudioPath}, err
}

func (audio Audio) Read() (string, error) {
	data, err := audio.store.ReadAudio(audio.path)
	if err != nil {
		return "", err
	}
	return "data:audio/wav;base64," + base64.StdEncoding.EncodeToString(data), nil
}
