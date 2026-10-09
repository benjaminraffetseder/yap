package main

import "testing"

func TestAutomaticClipboardDelivery(t *testing.T) {
	for _, tc := range []struct {
		name      string
		autoCopy  bool
		external  bool
		processed bool
	}{
		{"button enabled", true, false, false},
		{"button disabled", false, false, false},
		{"shortcut enabled", true, true, false},
		{"shortcut disabled with automatic paste", false, true, false},
		{"processed enabled", true, false, true},
		{"processed disabled", false, true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a := testApp(t)
			a.settings.AutoCopy = tc.autoCopy
			// Disabled copying must prevent paste even if that preference is on.
			a.settings.AutoPaste = !tc.autoCopy
			if tc.processed {
				enableText(t, a, true)
				a.textEngine = &fakeTextEngine{output: "Summary."}
			}
			copied := "existing clipboard"
			a.copyText = func(text string) error { copied = text; return nil }
			a.mu.Lock()
			err := a.start(tc.external)
			target := a.target
			a.mu.Unlock()
			if err != nil {
				t.Fatal(err)
			}
			if target != "" {
				t.Fatal("captured an automatic paste target with copying disabled")
			}
			if err := a.StopRecording(); err != nil {
				t.Fatal(err)
			}
			a.wg.Wait()
			snap, err := a.GetSnapshot()
			if err != nil || snap.Status.Phase != "done" || len(snap.History) != 1 {
				t.Fatalf("dictation was not saved: %+v %v", snap, err)
			}
			if tc.autoCopy {
				if copied != snap.Status.Transcript || snap.Status.Message != "Copied to clipboard" {
					t.Fatalf("automatic copying failed: %q %+v", copied, snap.Status)
				}
			} else if copied != "existing clipboard" || snap.Status.Message != "Saved to History" {
				t.Fatalf("disabled copying changed clipboard or delivery status: %q %+v", copied, snap.Status)
			}
		})
	}
}
