package text

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"
)

type Prompt struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Instruction string `json:"instruction"`
}

type ChainStep struct {
	ID       string `json:"id"`
	PromptID string `json:"promptId"`
	// original, transcript, or step:<ID> referencing an earlier step.
	Input string `json:"input"`
}

type Chain struct {
	ID    string      `json:"id"`
	Name  string      `json:"name"`
	Steps []ChainStep `json:"steps"`
}

type Config struct {
	Enabled      bool     `json:"enabled"`
	Endpoint     string   `json:"endpoint"`
	Model        string   `json:"model"`
	AutoPromptID string   `json:"autoPromptId"` // Saved prompt or chain ID.
	Prompts      []Prompt `json:"prompts"`
	Chains       []Chain  `json:"chains"`
}

func Defaults() Config {
	return Config{Endpoint: "http://127.0.0.1:11434/v1", Chains: []Chain{}, Prompts: []Prompt{
		{ID: "cleanup", Name: "Cleanup", Instruction: "Fix punctuation, capitalization, and obvious grammar mistakes. Remove filler words and accidental repetitions. Preserve meaning, names, technical terms, and the original language. Return only the cleaned text."},
		{ID: "summary", Name: "Summary", Instruction: "Summarize the transcript concisely in its original language. Preserve key facts, names, decisions, and action items. Do not invent details. Return only the summary."},
	}}
}

func ValidateText(value string) error {
	if strings.TrimSpace(value) == "" || !utf8.ValidString(value) || strings.ContainsRune(value, 0) || utf8.RuneCountInString(value) > 100000 {
		return errors.New("text must contain between 1 and 100,000 characters without null bytes")
	}
	return nil
}

func ValidateInstruction(value string) error {
	if strings.TrimSpace(value) == "" || !utf8.ValidString(value) || utf8.RuneCountInString(value) > 8000 || strings.ContainsRune(value, 0) {
		return errors.New("instructions must contain between 1 and 8,000 characters without null bytes")
	}
	return nil
}

// Only literal loopback addresses and localhost are accepted. localhost is
// pinned to 127.0.0.1 so DNS/hosts changes cannot send text to a remote address.
func Endpoint(value string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(value))
	if err != nil || u == nil {
		return nil, errors.New("enter a local server URL, such as http://127.0.0.1:11434/v1")
	}
	host := strings.ToLower(u.Hostname())
	ip := net.ParseIP(host)
	if (u.Scheme != "http" && u.Scheme != "https") || (host != "localhost" && (ip == nil || !ip.IsLoopback())) || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.RawPath != "" || strings.TrimRight(u.Path, "/") != "/v1" {
		return nil, errors.New("use an HTTP(S) loopback URL ending in /v1; remote servers, credentials, and query parameters are unsupported")
	}
	port := u.Port()
	if port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 {
			return nil, errors.New("enter a valid server port")
		}
	}
	if host == "localhost" {
		if port == "" {
			u.Host = "127.0.0.1"
		} else {
			u.Host = net.JoinHostPort("127.0.0.1", port)
		}
	}
	u.Path = "/v1"
	return u, nil
}

func Normalize(v Config) (Config, error) {
	u, err := Endpoint(v.Endpoint)
	if err != nil {
		return Config{}, err
	}
	v.Endpoint = u.String()
	v.Model = strings.TrimSpace(v.Model)
	if !utf8.ValidString(v.Model) || utf8.RuneCountInString(v.Model) > 200 || strings.ContainsAny(v.Model, "\r\n\x00") {
		return Config{}, errors.New("enter a valid model identifier (up to 200 characters)")
	}
	if v.Enabled && v.Model == "" {
		return Config{}, errors.New("enter the local model identifier before enabling processing")
	}
	if len(v.Prompts) > 30 {
		return Config{}, errors.New("save up to 30 prompts")
	}
	v.Prompts = append([]Prompt{}, v.Prompts...)
	ids := map[string]bool{}
	for i, p := range v.Prompts {
		p.Name, p.Instruction = strings.TrimSpace(p.Name), strings.TrimSpace(p.Instruction)
		if p.ID == "" || !utf8.ValidString(p.ID) || len(p.ID) > 80 || ids[p.ID] || strings.ContainsAny(p.ID, "\r\n\x00") {
			return Config{}, errors.New("prompt identifiers must be unique and nonempty")
		}
		if !utf8.ValidString(p.Name) || p.Name == "" || utf8.RuneCountInString(p.Name) > 80 || strings.ContainsAny(p.Name, "\r\n\x00") {
			return Config{}, errors.New("give each prompt a name of up to 80 characters")
		}
		if ValidateInstruction(p.Instruction) != nil {
			return Config{}, fmt.Errorf("%s needs instructions of up to 8,000 characters", p.Name)
		}
		ids[p.ID] = true
		v.Prompts[i] = p
	}
	if len(v.Chains) > 30 {
		return Config{}, errors.New("save up to 30 prompt chains")
	}
	v.Chains = append([]Chain{}, v.Chains...)
	for i, chain := range v.Chains {
		chain.Name = strings.TrimSpace(chain.Name)
		if !validIdentifier(chain.ID) || ids[chain.ID] {
			return Config{}, errors.New("prompt and chain identifiers must be unique and nonempty")
		}
		if chain.Name == "" || !utf8.ValidString(chain.Name) || utf8.RuneCountInString(chain.Name) > 80 || strings.ContainsAny(chain.Name, "\r\n\x00") {
			return Config{}, errors.New("give each chain a name of up to 80 characters")
		}
		if len(chain.Steps) == 0 || len(chain.Steps) > 10 {
			return Config{}, fmt.Errorf("%s needs between 1 and 10 steps", chain.Name)
		}
		chain.Steps = append([]ChainStep{}, chain.Steps...)
		steps := map[string]bool{}
		for j, step := range chain.Steps {
			if !validIdentifier(step.ID) || steps[step.ID] {
				return Config{}, fmt.Errorf("%s needs unique step identifiers", chain.Name)
			}
			if _, err := v.Prompt(step.PromptID); err != nil {
				return Config{}, fmt.Errorf("%s step %d needs an existing prompt; update chains before deleting their prompts", chain.Name, j+1)
			}
			if step.Input != "original" && step.Input != "transcript" && (!strings.HasPrefix(step.Input, "step:") || !steps[strings.TrimPrefix(step.Input, "step:")]) {
				return Config{}, fmt.Errorf("%s step %d must use the original, saved transcript, or an earlier step", chain.Name, j+1)
			}
			steps[step.ID] = true
		}
		ids[chain.ID] = true
		v.Chains[i] = chain
	}
	if v.AutoPromptID != "" && (!v.Enabled || !ids[v.AutoPromptID]) {
		return Config{}, errors.New("enable a model and select a saved prompt or chain for automatic processing")
	}
	return v, nil
}

func validIdentifier(id string) bool {
	return id != "" && len(id) <= 80 && utf8.ValidString(id) && !strings.ContainsAny(id, "\r\n\x00")
}

// Recipe resolves both existing single prompts and saved chains. Profiles keep
// their existing selection field, so older single-prompt settings still work.
func (v Config) Recipe(id string) (Chain, error) {
	for _, chain := range v.Chains {
		if chain.ID == id {
			return chain, nil
		}
	}
	prompt, err := v.Prompt(id)
	if err != nil {
		return Chain{}, errors.New("choose a saved prompt or chain")
	}
	return Chain{Steps: []ChainStep{{ID: prompt.ID, PromptID: prompt.ID, Input: "transcript"}}}, nil
}

func (v Config) Prompt(id string) (Prompt, error) {
	for _, p := range v.Prompts {
		if p.ID == id {
			return p, nil
		}
	}
	return Prompt{}, errors.New("choose a saved prompt")
}
