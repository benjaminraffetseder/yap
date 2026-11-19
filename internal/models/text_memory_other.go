//go:build !windows && !linux

package models

func RecommendedTextContext() int { return 4096 }
