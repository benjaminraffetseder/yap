package models

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"hash"
	"hash/crc32"
	"strings"
)

// Moonshine publishes CRC32C in its pinned native asset manifest; other
// upstreams publish SHA-256. Match the checksum provided by the publisher.
func newDigest(expected string) (hash.Hash, func() string) {
	if strings.HasPrefix(expected, "crc32c:") {
		h := crc32.New(crc32.MakeTable(crc32.Castagnoli))
		return h, func() string {
			var b [4]byte
			binary.BigEndian.PutUint32(b[:], h.Sum32())
			return "crc32c:" + base64.StdEncoding.EncodeToString(b[:])
		}
	}
	h := sha256.New()
	return h, func() string { return hex.EncodeToString(h.Sum(nil)) }
}
