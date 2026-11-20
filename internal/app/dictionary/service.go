// Package dictionary owns vocabulary correction merging and persistence.
package dictionary

import (
	"strings"

	"yap/internal/storage"
	"yap/internal/vocabulary"

	"github.com/google/uuid"
)

// Merge works against the current library, preserving it if validation fails.
func Merge(current []vocabulary.Entry, canonical string, aliases []string) []vocabulary.Entry {
	entries := append([]vocabulary.Entry{}, current...)
	for i, entry := range entries {
		if strings.EqualFold(entry.Canonical, strings.TrimSpace(canonical)) {
			entries[i].Canonical = canonical
			merged := append([]string{}, entry.Aliases...)
			for _, alias := range aliases {
				alias = strings.TrimSpace(alias)
				found := strings.EqualFold(alias, strings.TrimSpace(canonical))
				for _, existing := range merged {
					found = found || strings.EqualFold(alias, existing)
				}
				if !found {
					merged = append(merged, alias)
				}
			}
			entries[i].Aliases = merged
			entries[i].Enabled = true
			return entries
		}
	}
	return append(entries, vocabulary.Entry{ID: uuid.NewString(), Canonical: canonical, Aliases: aliases, Enabled: true})
}

func Save(store *storage.Store, entries []vocabulary.Entry) ([]vocabulary.Entry, error) {
	normalized, err := vocabulary.Normalize(entries)
	if err != nil {
		return nil, err
	}
	if err := store.SaveVocabulary(normalized); err != nil {
		return nil, err
	}
	return normalized, nil
}
