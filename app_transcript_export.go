package main

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode"

	"yap/internal/fileutil"
	"yap/internal/storage"
)

type TranscriptExportSelection struct {
	SessionIDs         []string `json:"sessionIds"`
	AllMatching        bool     `json:"allMatching"`
	Query              string   `json:"query"`
	ExcludedSessionIDs []string `json:"excludedSessionIds"`
}

type TranscriptExportOutput struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt string `json:"createdAt"`
	ChainName string `json:"chainName"`
	Step      int    `json:"step"`
	Total     int    `json:"total"`
}

type TranscriptExportPreview struct {
	SessionIDs  []string                 `json:"sessionIds"`
	OutputCount int                      `json:"outputCount"`
	Outputs     []TranscriptExportOutput `json:"outputs"`
}

type TranscriptExportRequest struct {
	SessionIDs        []string `json:"sessionIds"`
	Format            string   `json:"format"`
	Destination       string   `json:"destination"`
	IncludeTranscript bool     `json:"includeTranscript"`
	IncludeOutputs    bool     `json:"includeOutputs"`
	// Empty means all saved outputs; explicit IDs are used by the single-entry picker.
	OutputIDs []string `json:"outputIds"`
}

type TranscriptExportSummary struct {
	Path        string `json:"path"`
	Files       int    `json:"files"`
	Transcripts int    `json:"transcripts"`
	Outputs     int    `json:"outputs"`
}

func (a *App) GetTranscriptExportPreview(selection TranscriptExportSelection) (TranscriptExportPreview, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	preview := TranscriptExportPreview{Outputs: []TranscriptExportOutput{}}
	if err := a.historyAvailableLocked(); err != nil {
		return preview, err
	}
	ids := selection.SessionIDs
	if selection.AllMatching {
		if len(ids) != 0 {
			return preview, errors.New("choose selected transcripts or all matching transcripts")
		}
		var err error
		ids, err = a.store.MatchingHistoryIDs(selection.Query)
		if err != nil {
			return preview, err
		}
		excluded := map[string]bool{}
		for _, id := range selection.ExcludedSessionIDs {
			excluded[id] = true
		}
		included := make([]string, 0, len(ids))
		for _, id := range ids {
			if !excluded[id] {
				included = append(included, id)
			}
		}
		ids = included
	} else if len(selection.ExcludedSessionIDs) != 0 {
		return preview, errors.New("exclude transcripts only when selecting all search matches")
	}
	entries, err := a.store.SelectedSessions(ids)
	if err != nil {
		return preview, err
	}
	preview.SessionIDs = ids
	for _, entry := range entries {
		outputs, err := a.store.GeneratedOutputs(entry.ID)
		if err != nil {
			return preview, err
		}
		preview.OutputCount += len(outputs)
		if len(entries) == 1 {
			for _, output := range outputs {
				preview.Outputs = append(preview.Outputs, TranscriptExportOutput{
					ID: output.ID, Name: output.Prompt.Name, CreatedAt: output.CreatedAt,
					ChainName: output.Chain.Name, Step: output.Chain.Step, Total: output.Chain.Total,
				})
			}
		}
	}
	return preview, nil
}

type transcriptExportFile struct {
	name string
	text string
	at   time.Time
}

type transcriptExportPlan struct {
	files    []transcriptExportFile
	filename string
	summary  TranscriptExportSummary
}

func (a *App) ExportTranscripts(request TranscriptExportRequest) (*TranscriptExportSummary, error) {
	return a.exportTranscripts(request, func(plan transcriptExportPlan) (string, error) {
		switch request.Destination {
		case "folder":
			return a.desktop.Dialog.OpenFile().SetTitle("Choose export folder").
				CanChooseDirectories(true).CanChooseFiles(false).AttachToWindow(a.window).PromptForSingleSelection()
		case "zip":
			return a.saveFile("Export transcripts", "yap-transcripts.zip", "ZIP archive", "*.zip")
		default:
			label := "Markdown"
			if request.Format == "text" {
				label = "Text"
			}
			title := "Export transcript"
			if !request.IncludeTranscript {
				title = "Export output"
			}
			return a.saveFile(title, plan.filename, label, "*"+path.Ext(plan.filename))
		}
	})
}

// Build a complete snapshot before opening a native picker. No app lock is held
// while the picker or filesystem writes run; concurrent edits cannot mix versions.
func (a *App) exportTranscripts(request TranscriptExportRequest, choose func(transcriptExportPlan) (string, error)) (*TranscriptExportSummary, error) {
	a.mu.Lock()
	plan, err := a.transcriptExportPlanLocked(request)
	a.mu.Unlock()
	if err != nil {
		return nil, err
	}
	destination, err := choose(plan)
	if err != nil || destination == "" {
		return nil, err
	}
	switch request.Destination {
	case "file":
		err = fileutil.WriteAtomic(destination, []byte(plan.files[0].text))
	case "zip":
		err = fileutil.WriteAtomicStream(destination, func(w io.Writer) error {
			archive := zip.NewWriter(w)
			for _, file := range plan.files {
				header := &zip.FileHeader{Name: file.name, Method: zip.Deflate}
				if !file.at.IsZero() {
					header.SetModTime(file.at)
				}
				header.SetMode(0600)
				writer, writeErr := archive.CreateHeader(header)
				if writeErr == nil {
					_, writeErr = io.WriteString(writer, file.text)
				}
				if writeErr != nil {
					_ = archive.Close()
					return writeErr
				}
			}
			return archive.Close()
		})
	case "folder":
		// A new directory prevents overwriting existing exports or unrelated files.
		var root string
		root, err = os.MkdirTemp(destination, "yap-export-"+time.Now().Format("2006-01-02")+"-")
		if err == nil {
			for _, file := range plan.files {
				target := filepath.Join(root, filepath.FromSlash(file.name))
				if err = os.MkdirAll(filepath.Dir(target), 0700); err == nil {
					err = os.WriteFile(target, []byte(file.text), 0600)
				}
				if err != nil {
					break
				}
			}
			if err != nil {
				// root is exclusively owned by this export and lies inside destination.
				if cleanupErr := os.RemoveAll(root); cleanupErr != nil {
					err = fmt.Errorf("%w; incomplete export remains at %s: %v", err, root, cleanupErr)
				}
			} else {
				destination = root
			}
		}
	}
	if err != nil {
		return nil, err
	}
	plan.summary.Path = destination
	return &plan.summary, nil
}

func (a *App) transcriptExportPlanLocked(request TranscriptExportRequest) (transcriptExportPlan, error) {
	plan := transcriptExportPlan{}
	if err := a.historyAvailableLocked(); err != nil {
		return plan, err
	}
	if request.Format != "markdown" && request.Format != "text" {
		return plan, errors.New("choose Markdown or plain text")
	}
	if request.Destination != "file" && request.Destination != "zip" && request.Destination != "folder" {
		return plan, errors.New("choose a file, ZIP archive, or folder")
	}
	if !request.IncludeTranscript && !request.IncludeOutputs {
		return plan, errors.New("select a transcript or generated output to export")
	}
	if len(request.OutputIDs) != 0 && (!request.IncludeOutputs || len(request.SessionIDs) != 1) {
		return plan, errors.New("choose specific outputs for one transcript at a time")
	}
	entries, err := a.store.SelectedSessions(request.SessionIDs)
	if err != nil {
		return plan, err
	}
	selectedOutputs := map[string]bool{}
	for _, id := range request.OutputIDs {
		if id == "" || selectedOutputs[id] {
			return plan, errors.New("select unique generated outputs")
		}
		selectedOutputs[id] = true
	}
	extension := ".md"
	if request.Format == "text" {
		extension = ".txt"
	}
	folders := map[string]bool{}
	for _, entry := range entries {
		at, _ := time.Parse(time.RFC3339Nano, entry.CreatedAt)
		date := "undated"
		if !at.IsZero() {
			date = at.Format("2006-01-02")
		}
		folder := uniqueExportName(date+"-"+safeExportName(entry.Title, "transcript"), "", folders)
		if request.IncludeTranscript {
			plan.files = append(plan.files, transcriptExportFile{
				name: folder + "/transcript" + extension, text: exportTranscriptText(entry, request.Format), at: at,
			})
			plan.summary.Transcripts++
			plan.filename = folder + extension
		}
		if !request.IncludeOutputs {
			continue
		}
		outputs, err := a.store.GeneratedOutputs(entry.ID)
		if err != nil {
			return plan, err
		}
		// Oldest first gives repeated names deterministic suffixes.
		sort.SliceStable(outputs, func(i, j int) bool {
			a, _ := time.Parse(time.RFC3339Nano, outputs[i].CreatedAt)
			b, _ := time.Parse(time.RFC3339Nano, outputs[j].CreatedAt)
			if a.Equal(b) {
				return outputs[i].ID < outputs[j].ID
			}
			return a.Before(b)
		})
		names := map[string]bool{}
		for _, output := range outputs {
			if len(request.OutputIDs) != 0 && !selectedOutputs[output.ID] {
				continue
			}
			delete(selectedOutputs, output.ID)
			at, _ := time.Parse(time.RFC3339Nano, output.CreatedAt)
			name := output.Prompt.Name
			if output.Chain.Name != "" {
				name = fmt.Sprintf("%s-step-%02d-%s", output.Chain.Name, output.Chain.Step, name)
			}
			name = safeExportName(name, "output")
			if !at.IsZero() {
				name += "-" + at.Format("2006-01-02-150405")
			}
			name = uniqueExportName(name, extension, names)
			plan.files = append(plan.files, transcriptExportFile{
				name: folder + "/outputs/" + name, text: exportOutputText(entry, output, request.Format), at: at,
			})
			plan.summary.Outputs++
			if !request.IncludeTranscript {
				plan.filename = name
			}
		}
	}
	if len(selectedOutputs) != 0 {
		return plan, errors.New("a selected output no longer exists; reopen the export dialog")
	}
	plan.summary.Files = len(plan.files)
	if len(plan.files) == 0 {
		return plan, errors.New("no saved outputs to export")
	}
	if request.Destination == "file" && len(plan.files) != 1 {
		return plan, errors.New("choose a ZIP archive or folder for multiple files")
	}
	return plan, nil
}

func exportTranscriptText(entry storage.Session, format string) string {
	title := exportLine(entry.Title)
	if title == "" {
		title = "Transcript"
	}
	heading := title + "\n"
	if format == "markdown" {
		heading = "# " + title + "\n"
	}
	return fmt.Sprintf("%s\nRecorded: %s\nDuration: %s\n\n%s", heading, entry.CreatedAt,
		(time.Duration(entry.DurationMS) * time.Millisecond).String(), exportBody(entry.FinalTranscript))
}

func exportOutputText(entry storage.Session, output storage.GeneratedOutput, format string) string {
	title := exportLine(output.Prompt.Name)
	if title == "" {
		title = "Generated output"
	}
	if format == "markdown" {
		title = "# " + title
	}
	metadata := fmt.Sprintf("%s\n\nRecording: %s\nRecorded: %s\nGenerated: %s\n", title, exportLine(entry.Title), entry.CreatedAt, output.CreatedAt)
	if output.Chain.Name != "" {
		metadata += fmt.Sprintf("Chain: %s (step %d/%d)\n", exportLine(output.Chain.Name), output.Chain.Step, output.Chain.Total)
	}
	return metadata + "\n" + exportBody(output.Text)
}

func exportLine(value string) string { return strings.Join(strings.Fields(value), " ") }

func exportBody(value string) string {
	if strings.HasSuffix(value, "\n") {
		return value
	}
	return value + "\n"
}

func safeExportName(value, fallback string) string {
	var name strings.Builder
	count := 0
	for _, r := range strings.TrimSpace(value) {
		if unicode.IsControl(r) || strings.ContainsRune("<>:\"/\\|?*", r) {
			r = '-'
		}
		if unicode.IsSpace(r) {
			r = '-'
		}
		name.WriteRune(r)
		count++
		if count == 48 {
			break
		}
	}
	result := strings.Trim(name.String(), ".- ")
	if result == "" {
		result = fallback
	}
	// Windows device names are reserved even when followed by an extension.
	base := strings.ToUpper(strings.SplitN(result, ".", 2)[0])
	runes := []rune(base)
	if base == "CON" || base == "PRN" || base == "AUX" || base == "NUL" ||
		(len(runes) == 4 && (strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT")) && strings.ContainsRune("123456789¹²³", runes[3])) {
		result = "_" + result
	}
	return result
}

func uniqueExportName(base, extension string, used map[string]bool) string {
	name := base + extension
	for index := 2; used[strings.ToLower(name)]; index++ {
		name = fmt.Sprintf("%s-%d%s", base, index, extension)
	}
	used[strings.ToLower(name)] = true
	return name
}
