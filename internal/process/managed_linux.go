package process

import (
	"os/exec"
	"runtime"
	"sync"
	"syscall"
)

// A dedicated thread retains Linux's parent-death relationship for the worker's
// lifetime. Unlocking after Start could kill it when a Go thread is retired.
func StartManaged(cmd *exec.Cmd) (func(), error) {
	attributes := syscall.SysProcAttr{}
	if cmd.SysProcAttr != nil {
		attributes = *cmd.SysProcAttr
	}
	attributes.Pdeathsig = syscall.SIGKILL
	attributes.Setpgid, attributes.Pgid = true, 0
	cmd.SysProcAttr = &attributes
	started := make(chan error, 1)
	released := make(chan struct{})
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		if err := cmd.Start(); err != nil {
			started <- err
			return
		}
		started <- nil
		<-released
	}()
	if err := <-started; err != nil {
		return nil, err
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			// Include subprocesses owned by the model server during normal cleanup.
			_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
			_ = cmd.Process.Kill()
			close(released)
		})
	}, nil
}
