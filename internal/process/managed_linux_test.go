package process

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func managedHelper(mode string) *exec.Cmd {
	cmd := exec.Command(os.Args[0], "-test.run=^TestManagedProcessHelper$")
	cmd.Env = append(os.Environ(), "YAP_MANAGED_PROCESS_HELPER="+mode)
	return cmd
}

func TestManagedProcessHelper(t *testing.T) {
	switch os.Getenv("YAP_MANAGED_PROCESS_HELPER") {
	case "worker":
		for {
			time.Sleep(time.Hour)
		}
	case "parent":
		child := managedHelper("worker")
		cleanup, err := StartManaged(child)
		if err != nil {
			os.Exit(2)
		}
		defer cleanup()
		fmt.Println(child.Process.Pid)
		for {
			time.Sleep(time.Hour)
		}
	}
}

func waitManagedExit(t *testing.T, pid int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
		if os.IsNotExist(err) || err == nil && strings.HasPrefix(strings.SplitN(string(data), ") ", 2)[1], "Z ") {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("managed worker %d still running", pid)
}

func TestManagedWorkerDiesWhenParentIsKilled(t *testing.T) {
	parent := managedHelper("parent")
	output, err := parent.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := parent.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = parent.Process.Kill(); _ = parent.Wait() })
	scanner := bufio.NewScanner(output)
	if !scanner.Scan() {
		t.Fatal("parent did not start its worker")
	}
	pid, err := strconv.Atoi(scanner.Text())
	if err != nil || pid <= 0 {
		t.Fatalf("invalid worker pid: %s", scanner.Text())
	}
	t.Cleanup(func() { _ = syscall.Kill(pid, syscall.SIGKILL) })
	if err := parent.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	waitManagedExit(t, pid)
}

func TestManagedCleanupTerminatesWorkerAndIsRepeatable(t *testing.T) {
	cmd := managedHelper("worker")
	cleanup, err := StartManaged(cmd)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(cleanup)
	cleanup()
	cleanup()
	if err := cmd.Wait(); err == nil {
		t.Fatal("worker exited successfully after forced cleanup")
	}
	if state := cmd.ProcessState.Sys().(syscall.WaitStatus); !state.Signaled() || state.Signal() != syscall.SIGKILL {
		t.Fatalf("worker not killed: %v", state)
	}
}
