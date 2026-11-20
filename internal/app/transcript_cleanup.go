package app

import (
	"yap/internal/app/recording"
	"yap/internal/storage"
	"yap/internal/vocabulary"
)

func processTranscript(text string, settings storage.Settings, entries []vocabulary.Entry) string {
	return recording.ProcessTranscript(text, settings, entries)
}
