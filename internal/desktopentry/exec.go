// Package desktopentry contains desktop-entry encoding shared by Linux integrations.
package desktopentry

import "strings"

// QuoteExec encodes a single literal argument for a desktop entry's Exec key.
// Command quoting precedes string escaping; percent signs cannot become field codes.
func QuoteExec(argument string) string {
	quoted := strings.NewReplacer("\\", "\\\\", "\"", "\\\"", "`", "\\`", "$", "\\$", "%", "%%").Replace(argument)
	return strings.NewReplacer("\\", "\\\\", "\n", "\\n", "\r", "\\r", "\t", "\\t").Replace("\"" + quoted + "\"")
}
