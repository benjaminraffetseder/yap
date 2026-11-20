package app

import (
	"path"

	"yap/internal/app/transcriptexport"
	"yap/internal/storage"
)

type TranscriptExportSelection = transcriptexport.TranscriptExportSelection
type TranscriptExportOutput = transcriptexport.TranscriptExportOutput
type TranscriptExportPreview = transcriptexport.TranscriptExportPreview
type TranscriptExportRequest = transcriptexport.TranscriptExportRequest
type TranscriptExportSummary = transcriptexport.TranscriptExportSummary
type transcriptExportPlan = transcriptexport.Plan

func (a *App) GetTranscriptExportPreview(selection TranscriptExportSelection) (TranscriptExportPreview, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return TranscriptExportPreview{Outputs: []TranscriptExportOutput{}}, err
	}
	return transcriptexport.Preview(a.store, selection)
}

func (a *App) selectedHistoryLocked(selection TranscriptExportSelection) ([]storage.Session, error) {
	return transcriptexport.Select(a.store, selection)
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
			return a.saveFile(title, plan.Filename(), label, "*"+path.Ext(plan.Filename()))
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
	return plan.Write(destination)
}

func (a *App) transcriptExportPlanLocked(request TranscriptExportRequest) (transcriptExportPlan, error) {
	if err := a.historyAvailableLocked(); err != nil {
		return transcriptExportPlan{}, err
	}
	return transcriptexport.Prepare(a.store, request)
}
