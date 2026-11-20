package models_test

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"

	"yap/internal/inference/speech"
	"yap/internal/models"
	"yap/internal/process"
)

// NeMo 0.2.0 aborts with GGML_ASSERT(ctx->mem_buffer != NULL) under this
// budget, even for 11 seconds of audio. Exercise Local in a child so the job
// limit applies to its real native runtime without limiting the test runner.
func TestRealParakeetMemoryBudget(t *testing.T) {
	dir := os.Getenv("YAP_NATIVE_INTEGRATION_DIR")
	if os.Getenv("YAP_PARAKEET_MEMORY_WORKER") == "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		text, err := (speech.Local{}).Transcribe(ctx, filepath.Join(dir, "sample.wav"), speech.Options{
			Model: filepath.Join(dir, "models", "parakeet-tdt-0.6b-v3.q8_0.gguf"), Language: "en",
		})
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(strings.ToLower(text), "country") {
			t.Fatalf("unexpected transcript: %s", text)
		}
		t.Log(text)
		return
	}
	if os.Getenv("YAP_NATIVE_INTEGRATION") != "1" {
		t.Skip("set YAP_NATIVE_INTEGRATION=1 to test Parakeet under a Windows memory limit")
	}
	if dir == "" {
		dir = t.TempDir()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	report := func(int64, int64) {}
	if _, err := models.EnsureModelRuntime(ctx, dir, "parakeet-tdt-0.6b-v3", "", report); err != nil {
		t.Fatal(err)
	}
	if _, err := models.Install(ctx, dir, "parakeet-tdt-0.6b-v3", report); err != nil {
		t.Fatal(err)
	}
	downloadNativeSample(t, ctx, dir)
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(job)
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_PROCESS_MEMORY | windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	info.ProcessMemoryLimit = 13 << 28 // 3.25 GiB per process
	if _, err := windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	childCtx, stop := context.WithTimeout(ctx, time.Minute)
	defer stop()
	cmd := exec.CommandContext(childCtx, executable, "-test.run=^TestRealParakeetMemoryBudget$", "-test.v")
	cmd.Env = append(os.Environ(), "YAP_PARAKEET_MEMORY_WORKER=1", "YAP_NATIVE_INTEGRATION_DIR="+dir)
	var log bytes.Buffer
	cmd.Stdout, cmd.Stderr = &log, &log
	process.Hide(cmd)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	handle, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid))
	if err == nil {
		err = windows.AssignProcessToJobObject(job, handle)
		windows.CloseHandle(handle)
	}
	if err != nil {
		cmd.Process.Kill()
		cmd.Wait()
		t.Fatal(err)
	}
	if err := cmd.Wait(); err != nil {
		t.Fatalf("Parakeet failed within the memory budget: %v\n%s", err, &log)
	}
	t.Log(log.String())
}
