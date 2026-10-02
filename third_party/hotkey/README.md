# Yap hotkey patch

Source: golang.design/x/hotkey v0.6.4, under the included MIT license.

Local change: `Event.Sequence` numbers native press/release events before they
enter the separate Keydown/Keyup queues. Yap restores that order before invoking
callbacks, including when a callback is delayed or key repeat events queue up.
Native registration and key mappings are unchanged. Keep the sequence stamping
in every platform emitter when updating this dependency.
