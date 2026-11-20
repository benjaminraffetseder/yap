package shortcuts

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"
)

type handle struct {
	closed int
	done   chan struct{}
	err    error
}

func (h *handle) Close()                { h.closed++ }
func (h *handle) Done() <-chan struct{} { return h.done }
func (h *handle) Err() error            { return h.err }

func install(t *testing.T, service *Service, kind Kind, registration Registration) (Attempt, *Loss) {
	t.Helper()
	var attempt Attempt
	loss, err := service.Register(kind, "Ctrl+Alt+Space", func(candidate Attempt) (Registration, error) {
		attempt = candidate
		return registration, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return attempt, loss
}

func TestCaptureRetiresBothRegistrationsAndConsumesOnlyCurrentLease(t *testing.T) {
	var service Service
	recording, profile := &handle{}, &handle{}
	recordingAttempt, _ := install(t, &service, Recording, recording)
	profileAttempt, _ := install(t, &service, Profile, profile)
	token := service.BeginCapture(time.Minute, func(string) { t.Error("unexpected lease expiry") })
	if !service.Capturing() || token == "" || recording.closed != 1 || profile.closed != 1 {
		t.Fatal("capture retained a native handle or omitted the lease")
	}
	if service.Current(recordingAttempt) || service.Current(profileAttempt) || service.Ready("Ctrl+Alt+P") {
		t.Fatal("capture retained callbacks from the previous registrations")
	}
	if service.EndCapture("stale") || !service.Capturing() || service.captureTimer == nil {
		t.Fatal("stale capture ended the current lease")
	}
	if !service.EndCapture(token) || service.EndCapture(token) || service.Capturing() || service.captureTimer != nil {
		t.Fatal("current lease was not consumed exactly once")
	}
}

func TestCaptureExpiryIdentifiesItsLease(t *testing.T) {
	var service Service
	expired := make(chan string, 1)
	token := service.BeginCapture(0, func(token string) { expired <- token })
	defer service.Shutdown()
	select {
	case got := <-expired:
		if got != token || !service.EndCapture(got) {
			t.Fatal("expiry did not identify the active lease")
		}
	case <-time.After(time.Second):
		t.Fatal("capture lease did not expire")
	}
}

func TestRegisterMissingStopsPromptSequenceOnlyForCancellation(t *testing.T) {
	for _, failure := range []error{context.Canceled, fmt.Errorf("permission: %w", context.DeadlineExceeded), errors.New("occupied")} {
		t.Run(failure.Error(), func(t *testing.T) {
			var service Service
			var calls []Kind
			service.RegisterMissing("recording", "profile", func(kind Kind, value string) error {
				calls = append(calls, kind)
				if kind == Recording {
					if value != "recording" {
						t.Fatal("recording candidate changed")
					}
					return failure
				}
				if value != "profile" {
					t.Fatal("profile candidate changed")
				}
				return nil
			})
			want := []Kind{Recording}
			if !Cancelled(failure) {
				want = append(want, Profile)
			}
			if !reflect.DeepEqual(calls, want) {
				t.Fatalf("permission requests = %v, want %v", calls, want)
			}
		})
	}
	var service Service
	recording := &handle{}
	install(t, &service, Recording, recording)
	if !service.Ready("") || service.Ready("profile") {
		t.Fatal("disabled profile shortcut changed retry readiness")
	}
	service.RegisterMissing("recording", "profile", func(kind Kind, _ string) error {
		if kind != Profile {
			t.Fatal("retry disturbed a working recording registration")
		}
		install(t, &service, kind, &handle{})
		return nil
	})
	service.RegisterMissing("recording", "profile", func(Kind, string) error {
		t.Fatal("retry duplicated working registrations")
		return nil
	})
	if !service.Ready("profile") || recording.closed != 0 {
		t.Fatal("retry did not preserve the existing recording handle")
	}
}

func TestPermissionCancellationClosesLateHandleAndReleasesReservation(t *testing.T) {
	var service Service
	permission, err := service.BeginRegistration(nil)
	if err != nil || !service.Registering() {
		t.Fatal("permission wait was not reserved", err)
	}
	if _, err := service.BeginRegistration(nil); !errors.Is(err, context.Canceled) {
		t.Fatal("overlapping permission request was allowed", err)
	}
	service.CancelRegistration()
	late := &handle{}
	if registration, err := service.FinishRegistration(permission, late, nil); registration != nil || !errors.Is(err, context.Canceled) || late.closed != 1 || service.Registering() {
		t.Fatal("cancelled native success leaked a handle or reservation", err)
	}
	second, err := service.BeginRegistration(nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.FinishRegistration(permission, nil, nil); !errors.Is(err, context.Canceled) || !service.Registering() {
		t.Fatal("stale completion cleared a newer permission request", err)
	}
	registration, err := service.FinishRegistration(second, late, nil)
	if registration != late || err != nil || service.Registering() {
		t.Fatal("next permission request did not complete", err)
	}
}

func TestRetiredAttemptRejectsLateRegistration(t *testing.T) {
	var service Service
	late := &handle{}
	_, err := service.Register(Recording, "shortcut", func(attempt Attempt) (Registration, error) {
		service.Close(Recording)
		if service.Current(attempt) {
			t.Fatal("close kept an in-flight registration current")
		}
		return late, nil
	})
	if !errors.Is(err, context.Canceled) || late.closed != 1 || service.Registration(Recording) != nil {
		t.Fatal("late handle was published after its attempt was retired", err)
	}
	if _, err := service.Register(Profile, "", func(Attempt) (Registration, error) {
		t.Fatal("disabled profile shortcut requested native registration")
		return nil, nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestLossIgnoresReplacedRegistrationAndRetirementUnblocksObserver(t *testing.T) {
	var service Service
	old := &handle{done: make(chan struct{}), err: errors.New("old session lost")}
	_, oldLoss := install(t, &service, Recording, old)
	current := &handle{done: make(chan struct{}), err: errors.New("current session lost")}
	_, currentLoss := install(t, &service, Recording, current)
	if service.Lost(oldLoss, old.err) || service.Registration(Recording) != current {
		t.Fatal("old loss removed the replacement handle")
	}
	if err := oldLoss.Wait(); err != nil {
		t.Fatal("retired observer remained blocked on native Done", err)
	}
	close(current.done)
	err := currentLoss.Wait()
	if !service.Lost(currentLoss, err) || service.Lost(currentLoss, err) || service.Registration(Recording) != nil {
		t.Fatal("current registration loss was not consumed exactly once")
	}
}

func TestShutdownTransfersHandlesAndRetiresPermissionCaptureAndObservers(t *testing.T) {
	var service Service
	recording, profile := &handle{done: make(chan struct{})}, &handle{}
	attempt, loss := install(t, &service, Recording, recording)
	install(t, &service, Profile, profile)
	permission, err := service.BeginRegistration(nil)
	if err != nil {
		t.Fatal(err)
	}
	registrations := service.Shutdown()
	if len(registrations) != 2 || registrations[0] != recording || registrations[1] != profile || recording.closed != 0 || profile.closed != 0 {
		t.Fatal("shutdown did not transfer native handle ownership")
	}
	if service.Current(attempt) || permission.Context().Err() == nil || service.Ready("profile") || loss.Wait() != nil {
		t.Fatal("shutdown left callbacks, observers or permission requests alive")
	}
	late := &handle{}
	if _, err := service.FinishRegistration(permission, late, nil); !errors.Is(err, context.Canceled) || late.closed != 1 {
		t.Fatal("shutdown accepted a late permission result", err)
	}
	if _, err := service.BeginRegistration(nil); !errors.Is(err, context.Canceled) {
		t.Fatal("shutdown allowed a new permission request")
	}
	if _, err := service.Register(Recording, "shortcut", func(Attempt) (Registration, error) {
		t.Fatal("shutdown invoked native registration")
		return nil, nil
	}); !errors.Is(err, context.Canceled) {
		t.Fatal("shutdown allowed a new registration")
	}
	if len(service.Shutdown()) != 0 {
		t.Fatal("repeated shutdown transferred handles twice")
	}
	for _, registration := range registrations {
		registration.Close()
	}
	if recording.closed != 1 || profile.closed != 1 {
		t.Fatal("transferred handles were not closed exactly once")
	}
	var capturing Service
	token := capturing.BeginCapture(time.Minute, func(string) { t.Error("shutdown lease fired") })
	capturing.Shutdown()
	if capturing.Capturing() || capturing.captureTimer != nil || capturing.EndCapture(token) {
		t.Fatal("shutdown retained capture restoration")
	}
	if capturing.BeginCapture(0, func(string) { t.Error("shutdown started a capture lease") }) != "" || capturing.captureTimer != nil {
		t.Fatal("shutdown allowed a new capture lease")
	}
}
