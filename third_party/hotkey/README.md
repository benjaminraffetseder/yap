# Yap hotkey patch

Source: golang.design/x/hotkey v0.6.4, under the included MIT license.

Local change: `Event.Sequence` numbers native press/release events before they
enter the separate Keydown/Keyup queues. Yap restores that order before invoking
callbacks, including when a callback is delayed or key repeat events queue up.
Keep the sequence stamping in every platform emitter when updating this
dependency. The macOS implementation also follows the active layout for logical
letter shortcuts and uses a CGEventTap for press/release delivery.

On macOS, registration requests Accessibility trust with
`AXIsProcessTrustedWithOptions` and `kAXTrustedCheckOptionPrompt` once per process
when access is missing. The asynchronous prompt does not count as permission:
registration still fails until macOS reports the process as trusted. Yap retries
when its window regains focus or the user clicks Retry shortcut. Permission
errors are distinct from failures to create an event tap after trust is granted.
