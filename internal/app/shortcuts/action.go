package shortcuts

type Action uint8

const (
	Ignore Action = iota
	Tested
	Start
	Stop
)

// KeyState is an immutable projection of the operation reservation needed to
// decide what a shortcut edge does. The caller performs recording and UI effects.
type KeyState struct {
	Closing, SetupComplete, Busy bool
	Interaction, Phase           string
}

func (s *Service) Down(state KeyState) Action {
	if s.closed || state.Closing || s.Capturing() {
		return Ignore
	}
	if !state.SetupComplete {
		if !state.Busy {
			return Tested
		}
		return Ignore
	}
	if state.Interaction == "toggle" && state.Phase == "recording" {
		return Stop
	}
	if state.Busy {
		return Ignore
	}
	return Start
}

func (s *Service) Up(state KeyState) Action {
	if !s.closed && !state.Closing && !s.Capturing() && state.Interaction == "hold" && state.Phase == "recording" {
		return Stop
	}
	return Ignore
}
