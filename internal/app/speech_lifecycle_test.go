package app

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"yap/internal/storage"
)

type managedSpeechProbe struct {
	fakeSpeech
	release func()
	close   func()
}

// The queue callback sees the first active import under App.mu, before decoding.
func checkImportDuringRelease(t *testing.T, a *App, change func() error, wantError bool, checkStart func()) {
	t.Helper()
	entered, resume := make(chan struct{}), make(chan struct{})
	unblock := sync.OnceFunc(func() { close(resume) })
	defer unblock()
	a.engine = &managedSpeechProbe{release: func() {
		close(entered)
		<-resume
	}}
	startChecked := false
	a.notify = func(topic string, _ ...interface{}) {
		if topic == "import:queue" && a.imports.ActiveID() != "" && !startChecked {
			startChecked = true
			if a.speechMaintenance {
				t.Error("import started during release")
			}
			checkStart()
		}
	}
	finished := make(chan error, 1)
	go func() { finished <- change() }()
	select {
	case <-entered:
	case err := <-finished:
		t.Fatalf("change returned before release: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("release did not start")
	}
	if err := a.ImportDroppedAudio([]string{importedWAV(t)}); err != nil {
		t.Fatal(err)
	}
	a.mu.Lock()
	jobs := a.importSnapshotLocked()
	pending := a.imports.Pending()
	a.mu.Unlock()
	if len(jobs) != 1 || jobs[0].State != "queued" || pending {
		t.Fatalf("import did not wait during release: jobs=%+v pending=%v", jobs, pending)
	}
	unblock()
	if err := <-finished; (err != nil) != wantError {
		t.Fatalf("change returned %v, want error=%v", err, wantError)
	}
	a.wg.Wait()
	if jobs := a.importSnapshotLocked(); !startChecked || len(jobs) != 1 || jobs[0].State != "done" {
		t.Fatalf("import did not finish after release: %+v", jobs)
	}
}

func TestProfileResumesImportAfterPublication(t *testing.T) {
	a := testApp(t)
	path := filepath.Join(a.store.Dir, "models", "second.bin")
	if err := os.WriteFile(path, []byte("model"), 0600); err != nil {
		t.Fatal(err)
	}
	profile, err := a.SaveDictationProfile(storage.DictationProfile{Name: "Second", ModelPath: path, Language: "de"})
	if err != nil {
		t.Fatal(err)
	}
	a.diagnostic = DiagnosticResult{Phase: "done"}
	checkImportDuringRelease(t, a, func() error { return a.ApplyDictationProfile(profile.ID) }, false, func() {
		if a.recordSettings.ModelPath != path || a.status.ProfileID != profile.ID || a.diagnostic != (DiagnosticResult{}) {
			t.Error("import started before the profile was fully published")
		}
	})
}

func TestRemoveModelResumesImportAfterRemovalAttempt(t *testing.T) {
	for _, active := range []bool{false, true} {
		t.Run(map[bool]string{false: "removed", true: "active"}[active], func(t *testing.T) {
			a := testApp(t)
			path := filepath.Join(a.store.Dir, "models", "ggml-tiny.bin")
			if err := os.WriteFile(path, []byte("model"), 0600); err != nil {
				t.Fatal(err)
			}
			if active {
				a.settings.ModelPath = path
			}
			checkImportDuringRelease(t, a, func() error { return a.RemoveModel("tiny") }, active, func() {
				_, err := os.Stat(path)
				if (active && err != nil) || (!active && !os.IsNotExist(err)) {
					t.Errorf("unexpected model state at import start: %v", err)
				}
			})
		})
	}
}

func TestProfilePublicationRefreshesTrayReadiness(t *testing.T) {
	a := testApp(t)
	profile, err := a.SaveDictationProfile(storage.DictationProfile{Name: "Working", ModelPath: a.settings.ModelPath, Language: "en"})
	if err != nil {
		t.Fatal(err)
	}
	a.settings.ModelPath = filepath.Join(a.store.Dir, "missing.bin")
	tray := &fakeTray{}
	a.tray = tray
	a.updateTrayLocked()
	if err := a.ApplyDictationProfile(profile.ID); err != nil {
		t.Fatal(err)
	}
	if len(tray.states) != 2 || tray.states[0].Ready || !tray.states[1].Ready || tray.states[1].Busy {
		t.Fatalf("expected one ready update after fixing profile: %+v", tray.states)
	}
}

func (p *managedSpeechProbe) Release() {
	if p.release != nil {
		p.release()
	}
}
func (p *managedSpeechProbe) Close() {
	if p.close != nil {
		p.close()
	}
}

func TestSpeechRetirementReservesAdmissionWithoutHoldingAppMutex(t *testing.T) {
	a := testApp(t)
	entered, release, closed := make(chan struct{}), make(chan struct{}), make(chan struct{})
	a.engine = &managedSpeechProbe{
		release: func() {
			if !a.mu.TryLock() {
				t.Error("Release held app mutex")
			} else {
				a.mu.Unlock()
			}
			close(entered)
			<-release
		},
		close: func() {
			if !a.mu.TryLock() {
				t.Error("Close held app mutex")
			} else {
				a.mu.Unlock()
			}
			close(closed)
		},
	}
	settings := a.settings
	settings.ModelPath = filepath.Join(a.store.Dir, "models", "replacement.bin")
	if err := os.WriteFile(settings.ModelPath, []byte("model"), 0600); err != nil {
		t.Fatal(err)
	}
	finished := make(chan error, 1)
	go func() { finished <- a.SaveSettings(settings) }()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("retirement did not start")
	}
	// These calls need App.mu. State must be coherent and admission must remain
	// blocked while the old child releases its native model/file handles.
	config, err := a.GetConfiguration()
	if err != nil || config.Settings.ModelPath != settings.ModelPath || config.ProfileModified {
		close(release)
		<-finished
		t.Fatalf("partial configuration during retirement: %+v %v", config, err)
	}
	if err := a.StartRecording(); err == nil {
		close(release)
		<-finished
		t.Fatal("recording entered maintenance interval")
	}
	shutdown := make(chan struct{})
	go func() { a.shutdown(a.ctx); close(shutdown) }()
	select {
	case <-closed:
		close(release)
		t.Fatal("shutdown closed engine before maintenance drained")
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("retirement did not drain")
	}
	select {
	case <-shutdown:
	case <-time.After(time.Second):
		t.Fatal("shutdown did not drain")
	}
	select {
	case <-closed:
	default:
		t.Fatal("shutdown did not close engine")
	}
}
