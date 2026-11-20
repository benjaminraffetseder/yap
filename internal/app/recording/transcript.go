package recording

import (
	"yap/internal/cleanup"
	"yap/internal/storage"
	"yap/internal/vocabulary"
)

func ProcessTranscript(text string, settings storage.Settings, entries []vocabulary.Entry) string {
	if settings.CleanText {
		protected := []string{}
		for _, entry := range entries {
			if entry.Enabled {
				protected = append(protected, entry.Canonical)
				protected = append(protected, entry.Aliases...)
			}
		}
		text = cleanup.Apply(text, settings.Language, protected...)
	}
	return vocabulary.Apply(text, entries)
}
