package main

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	textmodel "yap/internal/inference/text"
	"yap/internal/storage"
)

func transcriptExportFixture(t *testing.T) (*App, []string, []string) {
	t.Helper()
	a := testApp(t)
	for _, id := range []string{"one", "two"} {
		entry := storage.NewSession(id, 1500, "original recognition", "base", "en", "")
		entry.Title, entry.CreatedAt = "Planning / ../ Notes?", "2026-11-06T10:00:00Z"
		entry.FinalTranscript = "# Edited transcript\n\n- Keep **formatting**.\n\n"
		if err := a.store.Add(entry); err != nil {
			t.Fatal(err)
		}
	}
	config := textmodel.Defaults()
	config.Enabled, config.Model = true, "local-model"
	prompt, _ := config.Prompt("summary")
	ids := []string{}
	for index := 0; index < 4; index++ {
		output := storage.NewGeneratedOutput("one", "saved model input", fmt.Sprintf("## Result %d\n\n- Saved **output**.", index), config, prompt)
		output.CreatedAt = "2026-11-06T11:00:00Z"
		if index >= 2 {
			output.Chain = storage.OutputChain{RunID: "run", ChainID: "chain", Name: "Meeting notes", StepID: fmt.Sprint(index), Step: index - 1, Total: 2, Input: "transcript"}
		}
		if err := a.store.AddGeneratedOutput(output); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, output.ID)
	}
	return a, []string{"one", "two"}, ids
}

func exportTo(t *testing.T, a *App, request TranscriptExportRequest, destination string) *TranscriptExportSummary {
	t.Helper()
	summary, err := a.exportTranscripts(request, func(transcriptExportPlan) (string, error) { return destination, nil })
	if err != nil {
		t.Fatal(err)
	}
	if summary == nil {
		t.Fatal("export unexpectedly cancelled")
	}
	return summary
}

func TestTranscriptExportZIPKeepsSeparateFilesVersionsAndChainSteps(t *testing.T) {
	a, sessions, _ := transcriptExportFixture(t)
	destination := filepath.Join(t.TempDir(), "transcripts.zip")
	summary := exportTo(t, a, TranscriptExportRequest{SessionIDs: sessions, Format: "markdown", Destination: "zip", IncludeTranscript: true, IncludeOutputs: true}, destination)
	if summary.Files != 6 || summary.Transcripts != 2 || summary.Outputs != 4 || summary.Path != destination {
		t.Fatalf("unexpected summary: %+v", summary)
	}
	archive, err := zip.OpenReader(destination)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	folders, names, bodies := map[string]bool{}, map[string]bool{}, map[string]bool{}
	transcripts, outputs, steps := 0, 0, 0
	for _, file := range archive.File {
		parts := strings.Split(file.Name, "/")
		if len(parts) < 2 || !strings.HasPrefix(parts[0], "2026-11-06-") || filepath.IsAbs(file.Name) || strings.Contains(file.Name, "../") || strings.ContainsAny(file.Name, "\\:?*") || names[strings.ToLower(file.Name)] {
			t.Fatalf("unsafe or colliding filename: %s", file.Name)
		}
		folders[parts[0]], names[strings.ToLower(file.Name)] = true, true
		reader, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(reader)
		reader.Close()
		if err != nil {
			t.Fatal(err)
		}
		body := string(data)
		if strings.Contains(body, "original recognition") || strings.Contains(body, "saved model input") {
			t.Fatal("export included a different source instead of saved text")
		}
		if len(parts) == 2 {
			transcripts++
			if parts[1] != "transcript.md" || !strings.HasSuffix(body, "# Edited transcript\n\n- Keep **formatting**.\n\n") || !strings.Contains(body, "Recorded: 2026-11-06T10:00:00Z") {
				t.Fatal("transcript or metadata changed:", body)
			}
		} else {
			outputs++
			bodies[body] = true
			if parts[1] != "outputs" || !strings.HasSuffix(parts[2], ".md") || !strings.Contains(body, "Generated: 2026-11-06T11:00:00Z") || !strings.Contains(body, "- Saved **output**.") {
				t.Fatal("output metadata or Markdown changed:", body)
			}
			if strings.Contains(body, "Chain: Meeting notes (step ") {
				steps++
			}
		}
	}
	if len(folders) != 2 || transcripts != 2 || outputs != 4 || len(bodies) != 4 || steps != 2 {
		t.Fatalf("lost separate transcripts, versions, or chain steps: %v %d %d %d %d", folders, transcripts, outputs, len(bodies), steps)
	}
}

func TestTranscriptExportSingleFileFormatsSelectionAndSnapshot(t *testing.T) {
	a, _, outputs := transcriptExportFixture(t)
	for _, format := range []string{"markdown", "text"} {
		t.Run(format, func(t *testing.T) {
			request := TranscriptExportRequest{SessionIDs: []string{"one"}, Format: format, Destination: "file", IncludeTranscript: true}
			destination := filepath.Join(t.TempDir(), "transcript")
			summary := exportTo(t, a, request, destination)
			body, err := os.ReadFile(destination)
			if err != nil || summary.Files != 1 || !strings.Contains(string(body), "# Edited transcript") || strings.Contains(string(body), "Result") {
				t.Fatalf("wrong transcript-only export: %+v %s %v", summary, body, err)
			}
			if strings.HasPrefix(string(body), "# Planning") != (format == "markdown") {
				t.Fatal("format did not control generated heading")
			}
		})
	}
	request := TranscriptExportRequest{SessionIDs: []string{"one"}, Format: "markdown", Destination: "file", IncludeOutputs: true, OutputIDs: []string{outputs[1]}}
	destination := filepath.Join(t.TempDir(), "output.md")
	summary, err := a.exportTranscripts(request, func(plan transcriptExportPlan) (string, error) {
		if !strings.HasSuffix(plan.filename, ".md") || strings.Contains(plan.filename, "/") {
			t.Fatal("invalid suggested filename:", plan.filename)
		}
		// Opening the picker must release the app lock and keep the saved snapshot.
		if err := a.DeleteSessionOutput("one", outputs[1]); err != nil {
			t.Fatal(err)
		}
		return destination, nil
	})
	if err != nil || summary == nil || summary.Transcripts != 0 || summary.Outputs != 1 {
		t.Fatalf("output-only export failed: %+v %v", summary, err)
	}
	body, _ := os.ReadFile(destination)
	if !strings.Contains(string(body), "## Result 1") || strings.Contains(string(body), "Edited transcript") || strings.Contains(string(body), "## Result 0") {
		t.Fatal("export lost the selected snapshot:", string(body))
	}
}

func TestTranscriptExportFoldersAreUniqueAndPreserveExistingFiles(t *testing.T) {
	a, sessions, outputs := transcriptExportFixture(t)
	parent := t.TempDir()
	keep := filepath.Join(parent, "transcript.txt")
	if err := os.WriteFile(keep, []byte("keep me"), 0600); err != nil {
		t.Fatal(err)
	}
	request := TranscriptExportRequest{SessionIDs: sessions[:1], Format: "text", Destination: "folder", IncludeTranscript: true, IncludeOutputs: true, OutputIDs: []string{outputs[2]}}
	first := exportTo(t, a, request, parent)
	second := exportTo(t, a, request, parent)
	if first.Path == second.Path || filepath.Dir(first.Path) != parent || first.Files != 2 || first.Outputs != 1 {
		t.Fatalf("folder export was not isolated: %+v %+v", first, second)
	}
	for _, root := range []string{first.Path, second.Path} {
		count := 0
		err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if !entry.IsDir() {
				count++
				if !strings.HasSuffix(path, ".txt") {
					t.Fatal("wrong extension:", path)
				}
			}
			return nil
		})
		if err != nil || count != 2 {
			t.Fatal("missing files:", count, err)
		}
	}
	if body, _ := os.ReadFile(keep); string(body) != "keep me" {
		t.Fatal("existing destination file changed")
	}
}

func TestTranscriptExportPreviewResolvesAllMatchingAcrossPages(t *testing.T) {
	a, _, _ := transcriptExportFixture(t)
	single, err := a.GetTranscriptExportPreview(TranscriptExportSelection{SessionIDs: []string{"one"}})
	if err != nil || single.OutputCount != 4 || len(single.Outputs) != 4 || single.Outputs[0].Name == "" {
		t.Fatalf("missing output choices: %+v %v", single, err)
	}
	for index := 0; index < 55; index++ {
		entry := storage.NewSession(fmt.Sprintf("bulk-%02d", index), 1000, "unmatched original", "base", "de", "")
		entry.Title = "ÄLTERE Besprechung"
		if err := a.store.Add(entry); err != nil {
			t.Fatal(err)
		}
	}
	if err := a.DeleteSessions([]string{"bulk-00"}); err != nil {
		t.Fatal(err)
	}
	preview, err := a.GetTranscriptExportPreview(TranscriptExportSelection{AllMatching: true, Query: "ältere"})
	if err != nil || len(preview.SessionIDs) != 54 || len(preview.Outputs) != 0 || preview.OutputCount != 0 {
		t.Fatalf("all-matching export missed entries: %+v %v", preview, err)
	}
	first, _ := a.GetHistory("ältere", 0)
	second, _ := a.GetHistory("ältere", 1)
	want := []string{}
	for _, entry := range append(first.Entries, second.Entries...) {
		want = append(want, entry.ID)
	}
	if !reflect.DeepEqual(preview.SessionIDs, want) {
		t.Fatal("export and History search disagree")
	}
	excluded, err := a.GetTranscriptExportPreview(TranscriptExportSelection{AllMatching: true, Query: "ältere", ExcludedSessionIDs: []string{want[0], want[51]}})
	if err != nil || len(excluded.SessionIDs) != 52 {
		t.Fatalf("cross-page exclusions were lost: %+v %v", excluded, err)
	}
	for _, id := range excluded.SessionIDs {
		if id == want[0] || id == want[51] {
			t.Fatal("excluded transcript was selected")
		}
	}
	request := TranscriptExportRequest{SessionIDs: preview.SessionIDs, Format: "markdown", Destination: "zip", IncludeTranscript: true}
	summary := exportTo(t, a, request, filepath.Join(t.TempDir(), "all.zip"))
	if summary.Transcripts != 54 {
		t.Fatalf("export remained page-limited: %+v", summary)
	}
}

func TestTranscriptExportRejectsInvalidOrStaleSelectionsBeforePicker(t *testing.T) {
	a, _, outputs := transcriptExportFixture(t)
	base := TranscriptExportRequest{SessionIDs: []string{"one"}, Format: "markdown", Destination: "zip", IncludeTranscript: true}
	cases := map[string]func(*TranscriptExportRequest){
		"empty selection":   func(r *TranscriptExportRequest) { r.SessionIDs = nil },
		"duplicate session": func(r *TranscriptExportRequest) { r.SessionIDs = []string{"one", "one"} },
		"missing session":   func(r *TranscriptExportRequest) { r.SessionIDs = []string{"missing"} },
		"format":            func(r *TranscriptExportRequest) { r.Format = "pdf" },
		"destination":       func(r *TranscriptExportRequest) { r.Destination = "unknown" },
		"no contents":       func(r *TranscriptExportRequest) { r.IncludeTranscript = false },
		"multiple files":    func(r *TranscriptExportRequest) { r.Destination = "file"; r.IncludeOutputs = true },
		"missing output":    func(r *TranscriptExportRequest) { r.IncludeOutputs = true; r.OutputIDs = []string{"missing"} },
		"wrong session": func(r *TranscriptExportRequest) {
			r.SessionIDs = []string{"two"}
			r.IncludeOutputs = true
			r.OutputIDs = outputs[:1]
		},
		"duplicate output": func(r *TranscriptExportRequest) {
			r.IncludeOutputs = true
			r.OutputIDs = []string{outputs[0], outputs[0]}
		},
		"output without inclusion": func(r *TranscriptExportRequest) { r.OutputIDs = outputs[:1] },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			request := base
			change(&request)
			_, err := a.exportTranscripts(request, func(transcriptExportPlan) (string, error) { t.Fatal("invalid selection opened picker"); return "", nil })
			if err == nil {
				t.Fatal("invalid export accepted")
			}
		})
	}
	if err := a.DeleteSessions([]string{"one"}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.GetTranscriptExportPreview(TranscriptExportSelection{SessionIDs: []string{"one"}}); err == nil {
		t.Fatal("deleted transcript included in preview")
	}
	a.closing = true
	if _, err := a.GetTranscriptExportPreview(TranscriptExportSelection{AllMatching: true}); err == nil {
		t.Fatal("preview allowed during shutdown")
	}
	if _, err := a.exportTranscripts(base, func(transcriptExportPlan) (string, error) { t.Fatal("shutdown opened picker"); return "", nil }); err == nil {
		t.Fatal("export allowed during shutdown")
	}
	a.closing = false
}

func TestTranscriptExportCancellationAndWriteErrors(t *testing.T) {
	a, _, _ := transcriptExportFixture(t)
	request := TranscriptExportRequest{SessionIDs: []string{"one"}, Format: "markdown", Destination: "file", IncludeTranscript: true}
	result, err := a.exportTranscripts(request, func(transcriptExportPlan) (string, error) { return "", nil })
	if result != nil || err != nil {
		t.Fatal("cancelled picker reported success or failure")
	}
	failure := errors.New("picker unavailable")
	if _, err := a.exportTranscripts(request, func(transcriptExportPlan) (string, error) { return "", failure }); !errors.Is(err, failure) {
		t.Fatal("picker failure lost")
	}
	for _, destination := range []string{"file", "zip", "folder"} {
		request.Destination = destination
		result, err := a.exportTranscripts(request, func(transcriptExportPlan) (string, error) {
			return filepath.Join(t.TempDir(), "missing", "export"), nil
		})
		if result != nil || err == nil {
			t.Fatalf("%s write failure reported as success", destination)
		}
	}
}

func TestTranscriptExportNamesStayPortable(t *testing.T) {
	for _, input := range []string{"../\\bad:*?\"<>|", "CON", "NUL.txt", "COM1", "LPT¹", " . ", "é日本語😀", strings.Repeat("界", 200), "a\n\x00b"} {
		name := safeExportName(input, "output")
		if name == "" || name == "." || name == ".." || strings.ContainsAny(name, "<>:\"/\\|?*\n\x00") || len(name) > 200 || strings.HasSuffix(name, ".") {
			t.Fatalf("unsafe filename %q for %q", name, input)
		}
		if strings.HasPrefix(input, "CON") || strings.HasPrefix(input, "NUL") || strings.HasPrefix(input, "COM1") || strings.HasPrefix(input, "LPT") {
			if !strings.HasPrefix(name, "_") {
				t.Fatalf("reserved device name: %s", name)
			}
		}
	}
	used := map[string]bool{}
	if uniqueExportName("Summary", ".md", used) != "Summary.md" || uniqueExportName("summary", ".md", used) != "summary-2.md" {
		t.Fatal("case-insensitive collision was not handled")
	}
}
