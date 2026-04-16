2026-04-16
- Counter replay protection can reuse the existing UID_CONFIG KV binding with a separate `counter:{uidHex}` key, so LNURLw replay state fits the current worker storage pattern without changing function signatures.
- The decrypted `ctr` value from `extractUIDAndCounter()` is a 3-byte big-endian hex string and must be parsed with base 16 before comparing against the persisted decimal counter string.
