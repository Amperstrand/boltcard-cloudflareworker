# Troublesome Cards

Cards that are stuck, half-wiped, or have unknown keys. Documented for future recovery attempts.

## Card 1: 043365FA967380

| Property | Value |
|----------|-------|
| UID | `043365FA967380` |
| Chip | NTAG424 DNA (vendor=04, type=04, subtype=02, v30.00) |
| Batch | 3475920457, CW19 21 |
| State | HALF-WIPED (SDM active, NDEF content invalid) |
| Location | ai-legion-small, ACS ACR1252 reader slot 0 |
| Date found | 2026-07-03 |

### File Settings
- NDEF file: 256 bytes, comm=Plain
- Access: read=Free, write=Key0, read_write=Key0, change=Key0
- SDM: Encrypted PICC data (Key1, offset 92), MAC read (Key2, window offset 127)

### NDEF Content (256 bytes, mostly zeros)
Non-zero region at offset 94-145 contains what appear to be hex-encoded key fingerprints:
- `3ED6EDB23DC4B9E4FAF3175E468F696A` (32 hex chars = 16 bytes)
- `95F4230C39A45D1E` (16 hex chars = 8 bytes)

These were tried as K0 and K1 — both rejected.

### Keys Tried (ALL REJECTED)
| Key | Source | Result |
|-----|--------|--------|
| 00000000000000000000000000000000 | Factory default | Rejected |
| 00000000000000000000000000000001 | Dev issuer key | Rejected |
| 4057766867304a7610bbf7c31ed93ce1 | Derived K0 v1 (issuer 0000...01) | Rejected |
| 68c3abc1d72e8a4f49cf294a9a2813c3 | Derived K0 v0 (issuer 0000...01) | Rejected |
| 88bc4209841b547ed0ab18c2b16356b3 | Derived K0 v1 (issuer boltpoc-1: b07339...) | Rejected |
| 372113cd18d16b14fe8f782ad806bbe2 | Derived K0 v0 (issuer boltpoc-1) | Rejected |
| 8398fc112a0da6fedafc7bfa525d85de | Derived K0 v1 (issuer boltpoc-2: 0a2762...) | Rejected |
| 4eafcb56a6c635c26e82f46ab032bda | Derived K0 v0 (issuer boltpoc-2) | Rejected |
| d7984c1cfd070e853d8f4268487dd8b8 | Derived K0 v1 (issuer boltpoc-3: 557345...) | Rejected |
| 20e5122384d4920c0a6155ad6fb26a47 | Derived K0 v0 (issuer boltpoc-3) | Rejected |
| 55da174c9608993dc27bb3f30a4a7314 | Derived K1 (shared across versions) as K0 | Rejected |
| 3db8852a71d11fa0adb6babaf274af89 | Shared per-card K1 (k.psbt.me batch) as K0 | Rejected |
| 3ed6edb23dc4b9e4faf3175e468f696a | NDEF-stored value as K0 | Rejected |
| 3ed6edb23dc4b9e4faf3175e468f696a | NDEF-stored value as K1 | Rejected |
| 95f4230c39a45d1e0000000000000000 | NDEF-stored value (padded) as K0 | Rejected |
| 11111111111111111111111111111111 | Common test key | Rejected |
| 0123456789ABCDEF0123456789ABCDEF | Common test key | Rejected |
| DEADBEEFDEADBEEFDEADBEEFDEADBEEF | Common test key | Rejected |

### Investigation Results (2026-07-03)
- **OpenCode sessions on ai-legion-small**: No matches for this UID (344K messages searched)
- **Bash history**: No burn/wipe commands for this UID
- **bolty-rs git log**: No commits referencing this card
- **Conclusion**: Card was burned by an unknown process, possibly manual CLI or another machine. Not from any known boltcardpoc/bolty-rs workflow.

### Card is from the FA967380 batch
The per-card CSV (`keys/_percard_k.psbt.me.csv`) contains cards from the same batch:
- `040A69FA967380`, `040C66FA967380`, `040E5FFA967380`, etc.
Our card `043365FA967380` shares the same batch suffix but is NOT in the CSV.
This means it was either:
- From the same batch of NTAG424 chips but burned with a different/unknown issuer key
- Or burned with a custom key via direct bolty-cli (not through the standard derivation)

### Warning
**Do not attempt more key guesses.** The TotFailCtr is permanent and accumulating.
Too many failed authentications will permanently lock the card.

### Next Steps for Recovery
1. **Search Cloudflare logs** for this UID (`043365FA967380`) to find when it was last used and with which issuer key
2. **Search OpenCode sessions** for any card burning/wiping commands that targeted this card
3. **Check git log** in bolty-rs repo on ai-legion-small for any burn/wipe commands
4. **Wait for auth delay to clear** (may take hours — TotFailCtr is accumulating)
5. If a fresh key candidate is found, use `try-key` to authenticate, then `wipe` to factory reset
6. Once wiped, `burn` with the correct issuer key for boltcardpoc.psbt.me

### Open Questions
- Which issuer key was this card burned with? (None of the 5 known keys match)
- Was this card burned by bolty-rs directly (bypassing the key derivation)?
- Is the card's TotFailCtr nearing lockout? (We made ~15 failed auth attempts)
- The NDEF contained `3ED6EDB23DC4B9E4FAF3175E468F696A` and `95F4230C39A45D1E` — what are these? They look like truncated keys or fingerprints, not standard boltcard data

### How to Investigate
```bash
# Search Cloudflare logs for this UID
npx wrangler tail boltcard-poc --format=json | grep "043365fa967380"

# Search KV for this card
wrangler kv key list --binding UID_CONFIG | grep "043365"

# Check bolty-rs git log for burn commands
ssh ubuntu@ai-legion-small "cd /home/ubuntu/src/bolty-rs && git log --oneline --all | head -20"

# Search bash history for this UID
ssh ubuntu@ai-legion-small "grep -r '043365' ~/.bash_history /home/ubuntu/.local/ 2>/dev/null"
```

### bolty-cli Commands Used
```bash
# Inspect
cargo run --bin bolty-cli -- inspect
# Diagnose
cargo run --bin bolty-cli -- diagnose --issuer-key 00000000000000000000000000000001
# Scan keys
cargo run --bin bolty-cli -- scan-keys --issuer-key 00000000000000000000000000000001
# Try specific key
cargo run --bin bolty-cli -- try-key --key <KEY_HEX> --key-no 0
# Reset auth delay
cargo run --bin bolty-cli -- reset-card
```
