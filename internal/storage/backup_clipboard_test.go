package storage

import (
	"context"
	"encoding/json"
	"testing"
)

func TestLegacyBackupDefaultsAutomaticCopyOn(t *testing.T) {
	source, path := backupFixture(t)
	if _, err := source.ExportBackup(context.Background(), path, false); err != nil {
		t.Fatal(err)
	}
	archive, err := ReadBackup(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(archive.manifest)
	archive.Close()
	if err != nil {
		t.Fatal(err)
	}
	var legacy map[string]any
	if err := json.Unmarshal(data, &legacy); err != nil {
		t.Fatal(err)
	}
	delete(legacy["preferences"].(map[string]any), "autoCopy")
	writeBackupArchive(t, path, legacy, nil)
	archive, err = ReadBackup(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	result, err := backupStore(t).RestoreBackup(context.Background(), archive, true)
	if err != nil || !result.Settings.AutoCopy {
		t.Fatalf("legacy backup disabled automatic copying: %+v %v", result.Settings, err)
	}
}
