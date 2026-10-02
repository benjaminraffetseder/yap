package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"
)

func TestModelDiscoveryUsesDraftEndpointWithoutChangingApp(t *testing.T) {
	a := testApp(t)
	config, _ := a.store.TextProcessing()
	status, settings := a.status, a.settings
	a.copyText = func(string) error { t.Error("discovery touched clipboard"); return nil }
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(`{"data":[{"id":"local-model"}]}`)) }))
	defer s.Close()
	models, err := a.ListTextModels("draft", s.URL+"/v1")
	if err != nil || len(models) != 1 || models[0] != "local-model" {
		t.Fatalf("discovery failed: %v %v", models, err)
	}
	stored, _ := a.store.TextProcessing()
	if !reflect.DeepEqual(config, stored) || a.settings != settings || a.status != status || len(a.modelDiscoveryCancels) != 0 || a.textJobID != "" {
		t.Fatal("discovery changed application state")
	}
	a.CancelTextProcessing("early-discovery")
	if _, err = a.ListTextModels("early-discovery", s.URL+"/v1"); !errors.Is(err, context.Canceled) {
		t.Fatal("early cancellation ignored", err)
	}
}

func TestDiscoveryCancelsByIdentityAndOnShutdown(t *testing.T) {
	for _, quit := range []bool{false, true} {
		t.Run(map[bool]string{false: "cancel", true: "quit"}[quit], func(t *testing.T) {
			a := testApp(t)
			started := make(chan struct{})
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { close(started); <-r.Context().Done() }))
			defer s.Close()
			done := make(chan error, 1)
			go func() { _, err := a.ListTextModels("active-discovery", s.URL+"/v1"); done <- err }()
			<-started
			a.CancelTextProcessing("unrelated")
			select {
			case <-done:
				t.Fatal("stale cancellation stopped discovery")
			default:
			}
			if quit {
				a.shutdown(a.ctx)
			} else {
				a.CancelTextProcessing("active-discovery")
			}
			select {
			case err := <-done:
				if !errors.Is(err, context.Canceled) {
					t.Fatal(err)
				}
			case <-time.After(time.Second):
				t.Fatal("discovery did not cancel")
			}
			if len(a.modelDiscoveryCancels) != 0 {
				t.Fatal("discovery ownership leaked")
			}
		})
	}
}
