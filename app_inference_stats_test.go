package main

import (
	"reflect"
	"testing"
)

func TestTranscriptionStatsFollowTemporaryAndSavedResults(t *testing.T) {
	for _, save := range []bool{false, true} {
		t.Run(map[bool]string{false: "temporary", true: "saved"}[save], func(t *testing.T) {
			a := testApp(t)
			a.SetSaveHistory(save)
			enableText(t, a, true)
			a.textEngine = &fakeTextEngine{output: "Summary"}
			recordTemporary(t, a)
			result := homeResult(t, a)
			if result.Session.Stats == nil || !result.Session.Stats.Valid() || result.Session.Stats.Engine != "whisper" || len(result.Outputs) != 1 || result.Outputs[0].Stats == nil {
				t.Fatal("inference metadata missing", result)
			}
			if !save {
				if err := a.HomeResultAction(result.Session.ID, result.Revision, "save", ""); err != nil {
					t.Fatal(err)
				}
			}
			saved := homeResult(t, a)
			if !reflect.DeepEqual(result.Session.Stats, saved.Session.Stats) || !reflect.DeepEqual(result.Outputs[0].Stats, saved.Outputs[0].Stats) {
				t.Fatal("saving changed inference stats")
			}
			// Manual generations use the same measured path as automatic chains.
			if _, err := a.GenerateSessionOutput("manual-stats", result.Session.ID, "cleanup"); err != nil {
				t.Fatal(err)
			}
			outputs, err := a.GetSessionOutputs(result.Session.ID)
			if err != nil || len(outputs) != 2 || outputs[0].Stats == nil {
				t.Fatal("manual output missing stats", outputs, err)
			}
			if _, err := a.RegenerateSessionOutput("regenerate-stats", result.Session.ID, outputs[0].ID); err != nil {
				t.Fatal(err)
			}
			outputs, _ = a.GetSessionOutputs(result.Session.ID)
			if len(outputs) != 3 || outputs[0].Stats == nil {
				t.Fatal("regenerated output missing stats")
			}
		})
	}
}
