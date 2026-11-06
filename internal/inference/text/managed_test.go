package text

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"yap/internal/models"
)

// A real child process exercises readiness, arguments, authentication,
// cancellation, and Windows job cleanup without downloading model weights.
func init() {
	if os.Getenv("YAP_TEXT_WORKER_HELPER") != "1" || len(os.Args) < 2 || os.Args[1] != "--model" {
		return
	}
	args := map[string]string{}
	for i := 1; i < len(os.Args); i++ {
		if strings.HasPrefix(os.Args[i], "--") && i+1 < len(os.Args) && !strings.HasPrefix(os.Args[i+1], "--") {
			args[os.Args[i]] = os.Args[i+1]
			i++
		}
	}
	if args["--n-gpu-layers"] != "0" {
		os.Exit(1)
	} // Force CPU fallback.
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, `{"status":"ok"}`) })
	mux.HandleFunc("/v1/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+args["--api-key"] {
			w.WriteHeader(401)
			return
		}
		var request struct {
			Stream bool `json:"stream"`
		}
		json.NewDecoder(r.Body).Decode(&request)
		out := args["--ctx-size"]
		if request.Stream {
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":%q},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n", out)
		} else {
			fmt.Fprintf(w, `{"choices":[{"message":{"content":%q},"finish_reason":"stop"}]}`, out)
		}
	})
	if err := http.ListenAndServe("127.0.0.1:"+args["--port"], mux); err != nil {
		os.Exit(2)
	}
	os.Exit(0)
}

func TestBuiltInContextValidationAndLegacyConfig(t *testing.T) {
	legacy := Config{Endpoint: "http://127.0.0.1:1234/v1", Model: "external-model"}
	got, err := Normalize(legacy)
	if err != nil || got.Provider != "" || got.Endpoint != legacy.Endpoint {
		t.Fatal("changed legacy connection", got, err)
	}
	for _, id := range []string{"gemma-4-e2b", "gemma-4-e4b", "gemma-4-12b"} {
		model, _ := models.FindTextModel(id)
		for _, length := range []int{0, 2048, 8192, model.MaxContext} {
			_, err := Normalize(Config{Provider: "builtin", Model: id, ContextLength: length, Endpoint: "unused"})
			if err != nil {
				t.Fatalf("rejected %s %d: %v", id, length, err)
			}
		}
		for _, length := range []int{-1, 1024, 2049, model.MaxContext + 1024} {
			if _, err := Normalize(Config{Provider: "builtin", Model: id, ContextLength: length}); err == nil {
				t.Fatalf("accepted %s context %d", id, length)
			}
		}
	}
	c := Defaults()
	c.Provider = "builtin"
	c.Model = "gemma-4-e2b"
	c.APIKey = "ephemeral"
	data, _ := json.Marshal(c)
	if strings.Contains(string(data), "ephemeral") {
		t.Fatal("worker key was exposed")
	}
}

func TestManagedWorkerReuseContextReloadFallbackAndClose(t *testing.T) {
	if !models.TextRuntimeAvailable() {
		t.Skip("Windows x64 worker")
	}
	t.Setenv("YAP_TEXT_WORKER_HELPER", "1")
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "models"), 0700); err != nil {
		t.Fatal(err)
	}
	fixture := []byte("GGUF")
	hash := sha256.Sum256(fixture)
	original := models.TextCatalog
	models.TextCatalog = append([]models.TextModel{}, original...)
	models.TextCatalog[0].Size = int64(len(fixture))
	models.TextCatalog[0].SHA = hex.EncodeToString(hash[:])
	t.Cleanup(func() { models.TextCatalog = original })
	if err := os.WriteFile(filepath.Join(dir, "models", original[0].Filename), fixture, 0600); err != nil {
		t.Fatal(err)
	}
	exe, _ := os.Executable()
	for _, backend := range []string{"cpu", "vulkan"} {
		path := models.TextRuntimePath(dir, backend)
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		src, err := os.Open(exe)
		if err != nil {
			t.Fatal(err)
		}
		dst, err := os.Create(path)
		if err != nil {
			src.Close()
			t.Fatal(err)
		}
		_, err = io.Copy(dst, src)
		src.Close()
		dst.Close()
		if err != nil {
			t.Fatal(err)
		}
	}
	m := &Managed{Dir: dir}
	defer m.Close()
	c := Config{Provider: "builtin", Enabled: true, Model: original[0].ID, ContextLength: 2048}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	out, err := m.Process(ctx, c, Prompt{Instruction: "test"}, "input")
	if err != nil || out != "2048" {
		t.Fatalf("process: %q %v", out, err)
	}
	first := m.worker
	_, err = m.Refine(ctx, c, "Rewrite these instructions")
	if err != nil || m.worker != first {
		t.Fatal("did not reuse worker", err)
	}
	c.ContextLength = 4096
	var streamed string
	out, err = m.Chat(ctx, c, []Message{{Role: "user", Content: "test"}}, func(s string) { streamed = s })
	if err != nil || out != "4096" || streamed != out || m.worker == first {
		t.Fatalf("context reload/chat: %q %q %v", out, streamed, err)
	}
	select {
	case <-first.done:
	default:
		t.Fatal("previous worker was orphaned")
	}
	current := m.worker
	m.Release()
	select {
	case <-current.done:
	default:
		t.Fatal("release left worker running")
	}
	cancelled, stop := context.WithCancel(ctx)
	stop()
	if _, err = m.Process(cancelled, c, Prompt{}, "test"); !errors.Is(err, context.Canceled) {
		t.Fatal("ignored cancellation", err)
	}
	m.Close()
	if _, err = m.Process(ctx, c, Prompt{}, "test"); err == nil {
		t.Fatal("restarted closed engine")
	}
}

func TestManagedGemmaIntegration(t *testing.T) {
	id := os.Getenv("YAP_GEMMA_INTEGRATION")
	if id == "" {
		t.Skip("set YAP_GEMMA_INTEGRATION=gemma-4-e2b (or another catalog ID) to download and run the real runtime/model")
	}
	dir := t.TempDir()
	for _, name := range []string{"models", "runtime"} {
		if err := os.MkdirAll(filepath.Join(dir, name), 0700); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	progress := func(int64, int64) {}
	t.Log("Installing pinned CPU/Vulkan runtimes")
	if err := models.EnsureTextRuntime(ctx, dir, progress); err != nil {
		t.Fatal(err)
	}
	t.Log("Downloading and verifying", id)
	if err := models.InstallTextModel(ctx, dir, id, progress); err != nil {
		t.Fatal(err)
	}
	m := &Managed{Dir: dir}
	defer m.Close()
	c := Config{Enabled: true, Provider: "builtin", Model: id, ContextLength: 2048}
	out, err := m.Process(ctx, c, Prompt{Instruction: "Reply with only OK."}, "Connection test.")
	if err != nil || !strings.Contains(out, "OK") {
		t.Fatalf("completion: %q %v", out, err)
	}
	first := m.worker
	c.ContextLength = 4096
	out, err = m.Chat(ctx, c, []Message{{Role: "user", Content: "Reply with only OK."}}, func(string) {})
	if err != nil || !strings.Contains(out, "OK") || m.worker == first {
		t.Fatalf("chat/context reload: %q %v", out, err)
	}
	t.Log("Verified real completion, streamed chat, and context reload at", strconv.Itoa(c.ContextLength), "tokens")
}
