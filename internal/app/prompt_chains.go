package app

import (
	"context"

	"yap/internal/app/textprocessing"
	textmodel "yap/internal/inference/text"
	"yap/internal/storage"
)

// Called without a.mu. Each completed step is committed before its dependents
// start. save runs under a.mu, alongside cancellation/deletion checks.
func (a *App) runTextRecipe(ctx context.Context, config textmodel.Config, recipe textmodel.Chain, session storage.Session, save func(storage.GeneratedOutput) error) (string, error) {
	return textprocessing.RunRecipe(ctx, a.textEngine, config, recipe, session, save, a.textRecipeHooks(ctx))
}

func (a *App) textRecipeHooks(ctx context.Context) textprocessing.RecipeHooks {
	return textprocessing.RecipeHooks{
		Progress: func(message string) error {
			a.mu.Lock()
			defer a.mu.Unlock()
			if a.closing || ctx.Err() != nil {
				return context.Canceled
			}
			a.status.Message = message
			a.emit()
			return nil
		},
		CommitStep: func(commit func() error) error {
			a.mu.Lock()
			defer a.mu.Unlock()
			if a.closing || ctx.Err() != nil {
				return context.Canceled
			}
			if err := commit(); err != nil {
				return err
			}
			a.event("dictation:history")
			a.emit()
			return nil
		},
	}
}
