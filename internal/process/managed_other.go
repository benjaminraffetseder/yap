//go:build !windows

package process

import "os/exec"

func StartManaged(cmd *exec.Cmd) (func(), error) {
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return func() { _ = cmd.Process.Kill() }, nil
}
