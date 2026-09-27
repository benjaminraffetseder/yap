// Package startup manages the current user's launch-at-login registration.
// Platform references:
// https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys
// https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html
package startup

// Controller reports registration, which the OS may still disable separately.
// Enabling takes effect at the next login; it never launches another process.
type Controller interface {
	Enabled() (bool, error)
	SetEnabled(bool) error
}
