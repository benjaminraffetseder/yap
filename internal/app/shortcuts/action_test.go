package shortcuts

import (
	"testing"
	"time"
)

func TestKeyEdgesPreserveSetupHoldToggleAndBusyRules(t *testing.T) {
	var service Service
	for _, test := range []struct {
		name     string
		state    KeyState
		down, up Action
	}{
		{"setup test", KeyState{}, Tested, Ignore},
		{"busy setup", KeyState{Busy: true}, Ignore, Ignore},
		{"idle hold", KeyState{SetupComplete: true, Interaction: "hold", Phase: "idle"}, Start, Ignore},
		{"recording hold", KeyState{SetupComplete: true, Interaction: "hold", Phase: "recording", Busy: true}, Ignore, Stop},
		{"recording toggle", KeyState{SetupComplete: true, Interaction: "toggle", Phase: "recording", Busy: true}, Stop, Ignore},
		{"transcribing toggle", KeyState{SetupComplete: true, Interaction: "toggle", Phase: "transcribing", Busy: true}, Ignore, Ignore},
		{"closing hold", KeyState{Closing: true, SetupComplete: true, Interaction: "hold", Phase: "recording"}, Ignore, Ignore},
	} {
		t.Run(test.name, func(t *testing.T) {
			if service.Down(test.state) != test.down || service.Up(test.state) != test.up {
				t.Fatal("shortcut edge changed recording or setup behavior")
			}
		})
	}
	service.BeginCapture(time.Minute, func(string) {})
	defer service.Shutdown()
	state := KeyState{SetupComplete: true, Interaction: "toggle", Phase: "recording"}
	if service.Down(state) != Ignore || service.Up(state) != Ignore {
		t.Fatal("shortcut capture allowed a recording edge")
	}
}
