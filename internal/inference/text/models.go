package text

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// Discovery fetches metadata only; it does not load a model or submit text.
func ListModels(ctx context.Context, endpoint string) ([]string, error) {
	u, err := Endpoint(endpoint)
	if err != nil {
		return nil, err
	}
	u.Path += "/models"
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	client, closeClient := localHTTPClient(10 * time.Second)
	defer closeClient()
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, discoveryContextError(ctx.Err())
		}
		return nil, errors.New("could not reach the local server; start it, check the URL, and refresh models")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		switch resp.StatusCode {
		case http.StatusNotFound, http.StatusMethodNotAllowed, http.StatusNotImplemented:
			return nil, errors.New("this server cannot list models; enter a model ID manually, then test it")
		case http.StatusUnauthorized, http.StatusForbidden:
			return nil, errors.New("local server requires authentication; server API keys are not supported")
		default:
			return nil, fmt.Errorf("local server returned HTTP %d; check the server and refresh models", resp.StatusCode)
		}
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1024*1024+1))
	if err != nil {
		if ctx.Err() != nil {
			return nil, discoveryContextError(ctx.Err())
		}
		return nil, errors.New("could not read the model list; refresh models")
	}
	if len(data) > 1024*1024 {
		return nil, errors.New("model list is too large; enter a model ID manually")
	}
	var result struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if json.Unmarshal(data, &result) != nil || result.Data == nil || len(result.Data) > 256 {
		return nil, errors.New("server returned an invalid model list; enter a model ID manually, then test it")
	}
	ids := make([]string, 0, len(result.Data))
	seen := map[string]bool{}
	for _, model := range result.Data {
		id := model.ID
		if id == "" || id != strings.TrimSpace(id) || !utf8.ValidString(id) || utf8.RuneCountInString(id) > 200 || strings.ContainsAny(id, "\r\n\x00\t") {
			return nil, errors.New("server returned an invalid model identifier; enter a model ID manually")
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids, nil
}

func discoveryContextError(err error) error {
	if errors.Is(err, context.DeadlineExceeded) {
		return fmt.Errorf("model discovery timed out; check the server and refresh models: %w", err)
	}
	return err
}
