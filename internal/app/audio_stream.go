package app

import (
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
	"yap/internal/audio"

	"github.com/google/uuid"
)

const audioURLPrefix = "/__yap/audio/"
const audioLinkLimit = 32
const audioLinkLifetime = 2 * time.Hour

type audioLink struct {
	id, path string
	used     time.Time
	expires  time.Time
}

// GetAudioURL grants a short-lived loopback playback URL. This uses a real HTTP
// transport: Windows' Wails asset response writer buffers bodies before delivery.
// Files are opened anew for each request and never cross the Wails bridge.
func (a *App) GetAudioURL(id string) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.historyAvailableLocked(); err != nil {
		return "", err
	}
	entry, err := a.store.Session(id)
	if err != nil {
		return "", err
	}
	file, err := a.store.OpenAudio(entry.AudioPath)
	if err != nil {
		return "", err
	}
	file.Close()
	if err := a.startAudioServerLocked(); err != nil {
		return "", err
	}
	now := time.Now()
	var oldest string
	for token, link := range a.audioLinks {
		if !now.Before(link.expires) {
			delete(a.audioLinks, token)
			continue
		}
		if link.id == id && link.path == entry.AudioPath {
			link.used = now
			a.audioLinks[token] = link
			return a.audioOrigin + audioURLPrefix + token, nil
		}
		if oldest == "" || link.used.Before(a.audioLinks[oldest].used) {
			oldest = token
		}
	}
	if a.audioLinks == nil {
		a.audioLinks = make(map[string]audioLink)
	}
	if len(a.audioLinks) >= audioLinkLimit {
		delete(a.audioLinks, oldest)
	}
	token := uuid.NewString()
	a.audioLinks[token] = audioLink{id: id, path: entry.AudioPath, used: now, expires: now.Add(audioLinkLifetime)}
	return a.audioOrigin + audioURLPrefix + token, nil
}

func (a *App) startAudioServerLocked() error {
	if a.audioServer != nil {
		return nil
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return errors.New("could not start recording playback")
	}
	server := &http.Server{
		Handler: http.HandlerFunc(a.serveAudio), ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout: time.Minute, MaxHeaderBytes: 16 << 10,
	}
	a.audioServer = server
	a.audioOrigin = "http://" + listener.Addr().String()
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		_ = server.Serve(listener)
	}()
	return nil
}

func (a *App) serveAudio(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !strings.HasPrefix(r.URL.Path, audioURLPrefix) {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	token := strings.TrimPrefix(r.URL.Path, audioURLPrefix)
	a.mu.Lock()
	link, ok := a.audioLinks[token]
	if !ok || !time.Now().Before(link.expires) {
		delete(a.audioLinks, token)
		a.mu.Unlock()
		http.NotFound(w, r)
		return
	}
	if err := a.historyAvailableLocked(); err != nil {
		a.mu.Unlock()
		http.Error(w, "audio unavailable", http.StatusServiceUnavailable)
		return
	}
	entry, err := a.store.Session(link.id)
	if err == nil && entry.AudioPath != link.path {
		err = errors.New("audio changed")
	}
	if err != nil {
		delete(a.audioLinks, token)
		a.mu.Unlock()
		http.NotFound(w, r)
		return
	}
	file, err := a.store.OpenAudio(link.path)
	if err != nil {
		a.mu.Unlock()
		http.NotFound(w, r)
		return
	}
	link.used = time.Now()
	a.audioLinks[token] = link
	// Shutdown closes connections before draining requests; no stream owns the
	// database or holds mu while sending bytes to a slow media consumer.
	a.wg.Add(1)
	a.mu.Unlock()
	defer a.wg.Done()
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.Size() > audio.MaxNormalizedImportBytes {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "audio/wav")
	// ServeContent streams from the seekable handle and implements HEAD, Range
	// and unsatisfiable-range responses. No App lock is held while bytes flow.
	http.ServeContent(w, r, "recording.wav", info.ModTime(), io.NewSectionReader(file, 0, info.Size()))
}
