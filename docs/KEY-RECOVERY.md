# Key Recovery — Extracting Boltcard Keys from Decommissioned Services

> **⚠️ DISCLAIMER: This guide is ONLY for recovering cards from services that have been permanently shut down (sunset) with no plans to resume operation. Do NOT extract keys from services that are still active or may be reactivated. Extracting keys from an active service would compromise the security of all cards still in circulation. Only use these techniques on your own decommissioned infrastructure, or with explicit written permission from the service operator.**

This project helps boltcard owners recover and reprogram NTAG424 NFC cards from defunct services. If a card was programmed by a service that no longer exists, and we have the encryption keys, a user can tap their card on [/login](https://boltcardpoc.psbt.me/login) to see their keys and get a link to wipe and reprogram the card.

If you have access to a decommissioned server's database, you can extract the keys and contribute them as a CSV file to the `keys/` directory.

---

## Quick Reference — Copy-Paste Extraction Commands

Already know what you're looking for? Here are the one-liners.

### BTCPayServer — Get the issuer key (Docker)

```bash
docker exec $(docker ps -q --filter "name=postgres" | head -n1) \
  psql -U postgres -Atc "SELECT \"Value\" FROM \"Settings\" WHERE \"Id\" = 'BoltcardSettings';"
```

Expected output: `{"IssuerKey":"32hexcharsHere..."}`

### BTCPayServer — Get the issuer key (bare metal)

```bash
psql -U postgres -Atc "SELECT \"Value\" FROM \"Settings\" WHERE \"Id\" = 'BoltcardSettings';"
```

### BTCPayServer — List registered cards

```bash
docker exec $(docker ps -q --filter "name=postgres" | head -n1) \
  psql -U postgres -c "SELECT id, ppid, version, counter FROM boltcards WHERE ppid IS NOT NULL ORDER BY id;"
```

### LNBits — Extract all card keys (SQLite)

```bash
sqlite3 -header -csv /path/to/ext_boltcards.sqlite3 \
  "SELECT uid, k0, k1, k2, prev_k0, prev_k1, prev_k2, card_name FROM boltcards.cards ORDER BY uid;"
```

### LNBits — Extract all card keys (PostgreSQL)

```bash
psql -U postgres -Atc -F ',' \
  "SELECT uid||','||k0||','||k1||','||k2||','||COALESCE(card_name,'') FROM boltcards.cards ORDER BY uid;"
```

---

## How This Project Uses Keys

This project supports two key formats:

### 1. Issuer Key (Standard Deterministic Derivation)

A single 16-byte issuer key can derive all card keys (K0–K4) from any card UID. This is the approach used by BTCPayServer's core boltcard support and the [boltcard specification](https://github.com/boltcard/boltcard/blob/main/docs/DETERMINISTIC.md).

Derivation (PRF = AES-CMAC):
```
CardKey = PRF(IssuerKey, 0x2d003f75 || UID || LE32(Version))
K0 = PRF(CardKey, 0x2d003f76)
K1 = PRF(IssuerKey, 0x2d003f77)    ← shared across all cards
K2 = PRF(CardKey, 0x2d003f78)
K3 = PRF(CardKey, 0x2d003f79)
K4 = PRF(CardKey, 0x2d003f7a)
ID  = PRF(IssuerKey, 0x2d003f7b || UID)
```

One issuer key in the CSV unlocks ALL cards from that service.

### 2. Per-Card Keys (K0, K1, K2 per card)

Some services (like LNBits) store K0, K1, K2 individually per card rather than deriving them. These go in a per-card CSV file.

---

## CSV File Format

### Issuer Key CSV

Filename: `keys/<domain>.csv` or `keys/_default.csv`

```csv
# Comment lines start with #
issuer_key,label
aabbccdd11223344aabbccdd11223344,my-service-1
eeff001122334455eeff001122334455,my-service-2
```

- `issuer_key`: 32 hex characters (16 bytes), case-insensitive
- `label`: human-readable name for reference (defaults to first 8 chars of key)

Files prefixed with `_percard` are treated as per-card format. All other `.csv` files in `keys/` are treated as issuer key files. The `_default.csv` file's keys are tried for ALL domains.

### Per-Card Key CSV

Filename: `keys/_percard_<source>.csv`

```csv
uid,k0,k1,k2,card_name
04aabbccddeeff,00112233445566778899aabbccddeeff,112233445566778899aabbccddeeff00,22334455667788990011aabbccddeeff01,my-card
```

- `uid`: 14 hex characters (7 bytes, the NFC card UID), case-insensitive
- `k0`, `k1`, `k2`: 32 hex characters each (16 bytes)
- `card_name`: optional label (used for reference, not looked up)

---

## Extraction Guides

### BTCPayServer — Core Boltcard Support (PullPayments.Boltcards)

**Works for**: BTCPayServer v1.10+ with the built-in boltcard/PullPayment integration.

**Key storage**: BTCPayServer uses deterministic key derivation with a **single global issuer key** (one per BTCPayServer instance, shared across all stores) stored in the PostgreSQL `"Settings"` table. Cards are registered in a `boltcards` table.

#### Data Model

```
┌─────────────────────┐       ┌──────────────────────┐
│ Settings             │       │ boltcards             │
├─────────────────────┤       ├──────────────────────┤
│ Id    TEXT PK        │       │ id      VARCHAR(32) PK│  ← CMAC(IssuerKey, 0x2d003f7b || UID)
│ Value JSONB          │       │ counter INT DEFAULT 0 │
│                      │       │ ppid    VARCHAR(30)   │──→ PullPayments.Id
│ Id = 'BoltcardSettings'     │ version INT DEFAULT 0 │
│ Value = {"IssuerKey":"hex"} │                        │
└─────────────────────┘       └──────────────────────┘

The issuer key is GLOBAL — one key per BTCPayServer instance, shared across all stores.
```

#### Important: Pull-Payment Variant Derivation

BTCPayServer uses a **pull-payment variant** of the standard derivation. The `CardKey` is derived as:

```
CardKey = PRF(IssuerKey, 0x2d003f75 || UID || LE32(Version) || UTF8(pullPaymentId))
```

This means the issuer key alone is NOT sufficient to derive per-card K0/K2 — you also need the `pullPaymentId` for each card. The standard boltcard derivation (without `pullPaymentId`) will produce **different** K0/K2 values.

However, **K1 is shared** and derived from only the issuer key (`PRF(IssuerKey, 0x2d003f77)`), so the issuer key alone lets you:
- Decrypt the `p=` parameter from card taps
- Identify cards by UID
- Validate the CMAC of the `p=` parameter

Full CMAC validation (K2) requires re-deriving per-card keys with the correct `pullPaymentId`. **For key recovery, contributing just the issuer key is sufficient** — it allows card identification and decryption, which is what this project needs.

#### What to Extract

1. **Issuer key** from the `Settings` table
2. **Card registrations** from the `boltcards` table (for reference, not strictly required)

#### Complete Extraction Script

Save this as `extract-btcpay-keys.sh` and run it on the decommissioned server:

```bash
#!/bin/bash
# Extract boltcard keys from a decommissioned BTCPayServer instance.
# Works with Docker-based and bare-metal installations.
set -euo pipefail

# --- Detect Docker vs bare metal ---
PSQL_CMD="psql -U postgres -Atc"
if docker ps -q --filter "name=postgres" | grep -q . 2>/dev/null; then
  PG=$(docker ps -q --filter "name=postgres" | head -n1)
  PSQL_CMD="docker exec $PG psql -U postgres -Atc"
  echo "Found PostgreSQL container: $PG"
else
  echo "No Docker postgres found, using bare-metal psql"
fi

echo ""
echo "=== Issuer Key ==="
ISSUER_JSON=$($PSQL_CMD "SELECT \"Value\" FROM \"Settings\" WHERE \"Id\" = 'BoltcardSettings';" 2>/dev/null || echo "NOT FOUND")

if [ "$ISSUER_JSON" = "NOT FOUND" ] || [ -z "$ISSUER_JSON" ]; then
  echo "No BoltcardSettings found. This BTCPayServer instance may not have used boltcards."
  exit 0
fi

echo "$ISSUER_JSON"
echo ""

# Extract just the hex key
ISSUER_KEY=$(echo "$ISSUER_JSON" | grep -oP '"IssuerKey"\s*:\s*"([0-9a-fA-F]+)"' | grep -oP '[0-9a-fA-F]{32}' | head -n1)
if [ -n "$ISSUER_KEY" ]; then
  echo "Extracted issuer key: $ISSUER_KEY"
else
  echo "Could not parse IssuerKey from JSON. Raw value:"
  echo "$ISSUER_JSON"
fi

echo ""
echo "=== Registered Cards ==="
$PSQL_CMD "SELECT id, ppid, version, counter FROM boltcards WHERE ppid IS NOT NULL ORDER BY id;" 2>/dev/null || echo "No boltcards table found"

echo ""
echo "=== Summary ==="
CARD_COUNT=$($PSQL_CMD "SELECT COUNT(*) FROM boltcards WHERE ppid IS NOT NULL;" 2>/dev/null || echo "0")
echo "Issuer key: ${ISSUER_KEY:-NOT FOUND}"
echo "Registered cards: $CARD_COUNT"

if [ -n "$ISSUER_KEY" ]; then
  echo ""
  echo "=== Contribution CSV ==="
  echo "# Add this to keys/<your-domain>.csv"
  echo "issuer_key,label"
  echo "$ISSUER_KEY,btcpay-$(hostname 2>/dev/null || echo 'instance')"
fi
```

#### Manual Steps (if the script doesn't work)

**Step 1**: Find the PostgreSQL container (Docker):

```bash
PG=$(docker ps -q --filter "name=postgres" | head -n1)
```

Or for bare metal, skip to Step 2 and use `psql` directly.

**Step 2**: Extract the issuer key:

```bash
# Docker:
docker exec "$PG" psql -U postgres -Atc \
  "SELECT \"Value\" FROM \"Settings\" WHERE \"Id\" = 'BoltcardSettings';"

# Bare metal:
psql -U postgres -Atc \
  "SELECT \"Value\" FROM \"Settings\" WHERE \"Id\" = 'BoltcardSettings';"
```

Output: `{"IssuerKey":"aabbccdd11223344aabbccdd11223344"}`

**Step 3**: Verify by extracting card registrations:

```bash
# Docker:
docker exec "$PG" psql -U postgres -c \
  "SELECT id, ppid, version, counter FROM boltcards WHERE ppid IS NOT NULL ORDER BY id;"

# Bare metal:
psql -U postgres -c \
  "SELECT id, ppid, version, counter FROM boltcards WHERE ppid IS NOT NULL ORDER BY id;"
```

Output columns:
- `id`: Boltcard ID = `hex(CMAC(IssuerKey, 0x2d003f7b || UID))` — NOT the card UID itself
- `ppid`: Pull payment ID — needed for full key derivation
- `version`: Key version (incremented on re-provisioning, typically 0 or 1)
- `counter`: Last-seen counter value

**Step 4**: Create the contribution CSV:

```csv
# keys/btcpay-myserver.example.com.csv
issuer_key,label
aabbccdd11223344aabbccdd11223344,btcpay-myserver
```

---

### BTCPayServer — LNbank Plugin (Legacy)

**Works for**: BTCPayServer installations that used the [LNbank plugin](https://github.com/dgarage/LNbank) for boltcard management.

**Key storage**: The LNbank plugin has its OWN `"BoltCards"` table in a separate PostgreSQL schema (`"BTCPayServer.Plugins.LNbank"`). This table stores card metadata but **NOT** encryption keys. The actual keys are derived from the same global BTCPayServer issuer key via the pull-payment variant derivation described above.

#### LNbank Data Model

```
┌──────────────────────────────────────────────────┐
│ "BTCPayServer.Plugins.LNbank"."BoltCards"        │
├──────────────────────────────────────────────────┤
│ BoltCardId      TEXT PK       │ UUID             │
│ CardIdentifier  TEXT          │ NFC card UID (nullable) │
│ Index           INTEGER       │ Card index (1-based)    │
│ Counter         BIGINT        │ Last counter (-1 = unused) │
│ Status          INTEGER       │ 0=inactive, 1=active, 2=expired │
│ WithdrawConfigId TEXT  UNIQUE ──→ WithdrawConfigs.WithdrawConfigId │
└──────────────────────────────────────────────────┘
          │
          │ WithdrawConfigId
          ▼
┌──────────────────────────────────────────────────┐
│ "BTCPayServer.Plugins.LNbank"."WithdrawConfigs"  │
├──────────────────────────────────────────────────┤
│ WithdrawConfigId TEXT PK    │ UUID              │
│ ...other columns...         │                   │
│ (contains or links to PullPaymentId)             │
└──────────────────────────────────────────────────┘
```

The LNbank `WithdrawConfigs` table is the bridge between LNbank card registrations and BTCPayServer's pull payment system. The `WithdrawConfigId` from `BoltCards` links to a withdraw configuration, which is associated with a pull payment whose ID feeds into the key derivation.

#### Complete Extraction Script

```bash
#!/bin/bash
# Extract boltcard data from a decommissioned BTCPayServer with LNbank plugin.
set -euo pipefail

PSQL_CMD="psql -U postgres -Atc"
if docker ps -q --filter "name=postgres" | grep -q . 2>/dev/null; then
  PG=$(docker ps -q --filter "name=postgres" | head -n1)
  PSQL_CMD="docker exec $PG psql -U postgres -Atc"
fi

# Find databases with LNbank tables
DBS=$($PSQL_CMD "select datname from pg_database where datistemplate=false;" 2>/dev/null)

for DB in $DBS; do
  HAS_TABLE=$($PSQL_CMD "select to_regclass('\"BTCPayServer.Plugins.LNbank\".\"BoltCards\"');" 2>/dev/null || true)
  [ -z "$HAS_TABLE" ] && continue

  echo "=== LNbank BoltCards in database: $DB ==="

  # Card registrations with UID
  $PSQL_CMD "SELECT \"CardIdentifier\", \"Index\", \"Counter\",
             CASE \"Status\" WHEN 0 THEN 'inactive' WHEN 1 THEN 'active' WHEN 2 THEN 'expired' END,
             \"WithdrawConfigId\"
             FROM \"BTCPayServer.Plugins.LNbank\".\"BoltCards\"
             WHERE \"CardIdentifier\" IS NOT NULL
             ORDER BY \"CardIdentifier\";"

  echo ""
  echo "=== Issuer Key (global) ==="
  ISSUER_JSON=$($PSQL_CMD "SELECT \"Value\" FROM \"Settings\" WHERE \"Id\" = 'BoltcardSettings';" 2>/dev/null || echo "NOT FOUND")
  echo "$ISSUER_JSON"

  echo ""
  echo "=== Core boltcards table (for cross-reference) ==="
  $PSQL_CMD "SELECT id, ppid, version, counter FROM boltcards WHERE ppid IS NOT NULL ORDER BY id;" 2>/dev/null || echo "No core boltcards table"

  # Try to show WithdrawConfigs → PullPayment chain
  echo ""
  echo "=== WithdrawConfigs (LNbank) ==="
  $PSQL_CMD "SELECT \"WithdrawConfigId\"
             FROM \"BTCPayServer.Plugins.LNbank\".\"WithdrawConfigs\"
             ORDER BY \"WithdrawConfigId\";" 2>/dev/null || echo "Could not read WithdrawConfigs"
done
```

#### What the LNbank Dump Tells You

- Which card UIDs were registered (non-null `CardIdentifier`)
- Whether they were active (Status=1), inactive (0), or expired (2)
- Whether they were ever used (Counter ≥ 0; -1 = never used)
- The `WithdrawConfigId` linking to the withdraw configuration

**You still need the issuer key** to derive the actual encryption keys. The LNbank tables only provide metadata.

---

### LNBits — Boltcards Extension

**Works for**: Any LNBits installation using the [boltcards extension](https://github.com/lnbits/boltcards).

**Key storage**: LNBits stores K0, K1, K2 **per card in plaintext** in its database. No derivation needed — the keys are right there.

The data lives in `boltcards.cards` table. For SQLite-based installs, the file is `ext_boltcards.sqlite3`. For PostgreSQL-based installs, the table is in the main LNBits database.

#### Schema (from `lnbits/boltcards` migrations)

```sql
CREATE TABLE boltcards.cards (
    id TEXT PRIMARY KEY,
    wallet TEXT NOT NULL,
    card_name TEXT NOT NULL,
    uid TEXT NOT NULL,
    external_id TEXT NOT NULL,
    counter INT NOT NULL DEFAULT 0,
    tx_limit INT NOT NULL,
    daily_limit INT NOT NULL,
    enable BOOL NOT NULL,
    k0 TEXT NOT NULL DEFAULT '00000000000000000000000000000000',
    k1 TEXT NOT NULL DEFAULT '00000000000000000000000000000000',
    k2 TEXT NOT NULL DEFAULT '00000000000000000000000000000000',
    prev_k0 TEXT NOT NULL DEFAULT '00000000000000000000000000000000',
    prev_k1 TEXT NOT NULL DEFAULT '00000000000000000000000000000000',
    prev_k2 TEXT NOT NULL DEFAULT '00000000000000000000000000000000',
    otp TEXT NOT NULL DEFAULT '',
    time TIMESTAMP NOT NULL DEFAULT ...
);
```

> **Note on `prev_k*` columns**: These store the keys from **before** the last wipe/re-key operation. If a card was wiped and re-keyed, the current `k0/k1/k2` are the NEW keys, and `prev_k0/prev_k1/prev_k2` are the OLD keys. For key recovery, include BOTH the current and previous keys — the card might still be programmed with either set. You can create two per-card CSV entries for the same UID (one with current keys, one with previous keys) using different `card_name` suffixes.

#### Complete Extraction Script

```bash
#!/bin/bash
# Extract boltcard keys from a decommissioned LNBits instance.
# Handles SQLite and PostgreSQL backends.
set -euo pipefail

# --- Try SQLite first ---
find_db() {
  echo "=== Searching for LNBits boltcard databases ==="

  # Check common paths
  for path in \
    "/var/lib/lnbits/data/ext_boltcards.sqlite3" \
    "/opt/lnbits/data/ext_boltcards.sqlite3" \
    "./data/ext_boltcards.sqlite3"; do
    if [ -f "$path" ]; then
      echo "FOUND: $path"
      echo "$path"
      return 0
    fi
  done

  # Search filesystem
  found=$(find / -name 'ext_boltcards.sqlite3' -not -path '*/node_modules/*' 2>/dev/null | head -n1)
  if [ -n "$found" ]; then
    echo "FOUND: $found"
    echo "$found"
    return 0
  fi

  # Search Docker containers
  for c in $(docker ps -aq 2>/dev/null); do
    found=$(docker exec "$c" find / -name 'ext_boltcards.sqlite3' 2>/dev/null | head -n1 || true)
    if [ -n "$found" ]; then
      echo "FOUND in container $(docker inspect --format '{{.Name}}' "$c"): $found"
      # Copy it out
      docker cp "$c:$found" ./ext_boltcards.sqlite3 2>/dev/null || true
      echo "./ext_boltcards.sqlite3"
      return 0
    fi
  done

  return 1
}

SQLITE_DB=$(find_db 2>/dev/null || true)

if [ -n "$SQLITE_DB" ] && [ -f "$SQLITE_DB" ]; then
  echo ""
  echo "=== SQLite extraction: $SQLITE_DB ==="

  # Current keys
  echo ""
  echo "--- Current keys ---"
  sqlite3 -header -csv "$SQLITE_DB" \
    "SELECT uid, k0, k1, k2, card_name FROM boltcards.cards ORDER BY uid;" 2>/dev/null

  # Previous keys (pre-wipe)
  echo ""
  echo "--- Previous keys (before last wipe) ---"
  sqlite3 -header -csv "$SQLITE_DB" \
    "SELECT uid, prev_k0, prev_k1, prev_k2, card_name || ' (prev)' as card_name
     FROM boltcards.cards
     WHERE prev_k0 != '00000000000000000000000000000000'
        OR prev_k1 != '00000000000000000000000000000000'
        OR prev_k2 != '00000000000000000000000000000000'
     ORDER BY uid;" 2>/dev/null

  # Summary
  TOTAL=$(sqlite3 "$SQLITE_DB" "SELECT COUNT(*) FROM boltcards.cards;" 2>/dev/null || echo "?")
  ACTIVE=$(sqlite3 "$SQLITE_DB" "SELECT COUNT(*) FROM boltcards.cards WHERE enable = 1;" 2>/dev/null || echo "?")
  echo ""
  echo "=== Summary ==="
  echo "Total cards: $TOTAL, Active: $ACTIVE"
  exit 0
fi

# --- Try PostgreSQL ---
echo "SQLite database not found, trying PostgreSQL..."
PG=$(docker ps -q --filter "name=postgres" | head -n1 2>/dev/null || true)

if [ -n "$PG" ]; then
  echo "Found PostgreSQL container: $PG"
  PSQL="docker exec $PG psql -U postgres"
else
  PSQL="psql -U postgres"
fi

# Try to find boltcards table
HAS_TABLE=$($PSQL -Atc "select to_regclass('boltcards.cards');" 2>/dev/null || true)
if [ -z "$HAS_TABLE" ]; then
  # Try in all databases
  DBS=$($PSQL -Atc "select datname from pg_database where datistemplate=false;" 2>/dev/null)
  for DB in $DBS; do
    HAS=$($PSQL -d "$DB" -Atc "select to_regclass('boltcards.cards');" 2>/dev/null || true)
    [ -z "$HAS" ] && continue
    echo "Found boltcards.cards in database: $DB"

    $PSQL -d "$DB" -Atc -F ',' \
      "SELECT uid||','||k0||','||k1||','||k2||','||COALESCE(card_name,'')
       FROM boltcards.cards ORDER BY uid;" 2>/dev/null

    # Previous keys
    $PSQL -d "$DB" -Atc -F ',' \
      "SELECT uid||','||prev_k0||','||prev_k1||','||prev_k2||','||COALESCE(card_name||' (prev)','prev')
       FROM boltcards.cards
       WHERE prev_k0 != '00000000000000000000000000000000'
       ORDER BY uid;" 2>/dev/null
    exit 0
  done
  echo "No boltcards.cards table found in any database"
  exit 1
fi

# Direct hit
$PSQL -Atc -F ',' \
  "SELECT uid||','||k0||','||k1||','||k2||','||COALESCE(card_name,'')
   FROM boltcards.cards ORDER BY uid;"
```

#### Manual Steps (if the script doesn't work)

**Step 1**: Locate the LNBits database:

```bash
# SQLite — find the boltcard extension database
find / -name 'ext_boltcards.sqlite3' 2>/dev/null

# Or check inside Docker containers
for c in $(docker ps -aq 2>/dev/null); do
  docker exec "$c" find / -name 'ext_boltcards.sqlite3' 2>/dev/null | \
    while read -r f; do echo "Container $(docker inspect --format '{{.Name}}' "$c"): $f"; done
done
```

**Step 2**: Extract per-card keys:

```bash
# SQLite — current keys:
sqlite3 -header -csv /path/to/ext_boltcards.sqlite3 \
  "SELECT uid, k0, k1, k2, card_name FROM boltcards.cards ORDER BY uid;"

# SQLite — previous keys (before last wipe):
sqlite3 -header -csv /path/to/ext_boltcards.sqlite3 \
  "SELECT uid, prev_k0 AS k0, prev_k1 AS k1, prev_k2 AS k2, card_name || ' (prev)'
   FROM boltcards.cards
   WHERE prev_k0 != '00000000000000000000000000000000' ORDER BY uid;"

# PostgreSQL:
psql -U postgres -Atc -F ',' \
  "SELECT uid||','||k0||','||k1||','||k2||','||COALESCE(card_name,'')
   FROM boltcards.cards ORDER BY uid;"
```

**Step 3**: Create the per-card CSV:

```csv
# keys/_percard_lnbits-myserver.example.com.csv
# Current keys
uid,k0,k1,k2,card_name
04aabbccddeeff,00112233445566778899aabbccddeeff,112233445566778899aabbccddeeff00,22334455667788990011aabbccddeeff01,test-card-1

# Previous keys (from before last wipe — include if non-zero)
04aabbccddeeff,aabbccddeeff00112233445566778899,ccddeeff001122334455667788990011,eeddff00112233445566778899001122,test-card-1 (prev)
```

---

## Verifying Extracted Keys

Before contributing, verify your extracted keys work using the test vectors below.

### Test Vector (Standard Boltcard Derivation)

If you extracted an issuer key, verify it produces the correct K1 for the test UID:

```
Input:
  UID:         04a39493cc8680
  Issuer Key:  00000000000000000000000000000001
  Version:     1

Expected K1:   55da174c9608993dc27bb3f30a4a7314
```

K1 is always `PRF(IssuerKey, 0x2d003f77)` regardless of UID — so the same issuer key always produces the same K1 for every card. This is useful for a quick sanity check.

### Quick Verification with This Project

After adding keys to `keys/` and running `node scripts/build_keys.js`:

1. Start the dev server: `npx wrangler dev --ip 127.0.0.1 --port 8787 --show-interactive-dev-session false`
2. Tap a card (or simulate a tap with the card's `p=` and `c=` parameters)
3. Visit `http://127.0.0.1:8787/login` — if the keys are correct, the card will be identified

### Verifying LNBits Per-Card Keys

For per-card keys, verify by checking that the same K1 appears for cards from the same LNBits instance (LNBits derives K1 from the card's UID using its own issuer key, but all cards on the same instance share the same derivation base). If you see the same K1 across multiple cards, that's expected for cards from the same issuer.

---

## Submitting Keys

1. **Fork** the repository
2. **Add** your CSV file to `keys/`:
   - Issuer keys: `keys/<domain>.csv`
   - Per-card keys: `keys/_percard_<source>.csv`
3. **Regenerate** the bundled key data:
   ```bash
   node scripts/build_keys.js
   ```
4. **Verify** the regenerated `utils/generatedKeyData.js` includes your keys
5. **Commit** both the new CSV and the regenerated `utils/generatedKeyData.js`
6. **Open a pull request** with a description mentioning the decommissioned service

### Naming Conventions

| File | Format | Purpose |
|------|--------|---------|
| `keys/_default.csv` | Issuer key | Tried for ALL domains |
| `keys/<domain>.csv` | Issuer key | Domain-specific issuer keys |
| `keys/_percard_<source>.csv` | Per-card | Individual K0/K1/K2 per card |
| `keys/backups/` | Any | Historical/reference data (not processed) |

### After Adding Keys

Run `node scripts/build_keys.js` to regenerate `utils/generatedKeyData.js`. This is also run automatically during `npm run deploy`.

The script processes all `.csv` files in `keys/`:
- Files matching `*.csv` (not starting with `_percard`) → issuer key files, keyed by filename (minus `.csv`)
- Files matching `_percard_*.csv` → per-card key files, all merged into a single array
- Lines starting with `#` are comments, first line is the header (skipped)
- All hex values are lowercased automatically

---

## Technical Reference: BTCPayServer Key Derivation

BTCPayServer implements the [boltcard deterministic key specification](https://github.com/boltcard/boltcard/blob/main/docs/DETERMINISTIC.md) with a pull-payment extension.

### Standard Derivation (boltcard spec)

This is what this project uses. PRF = AES-CMAC (RFC 4493).

```
CardKey = PRF(IssuerKey, 0x2d003f75 || UID || LE32(Version))
K0 = PRF(CardKey, 0x2d003f76)
K1 = PRF(IssuerKey, 0x2d003f77)     ← depends ONLY on IssuerKey, not UID
K2 = PRF(CardKey, 0x2d003f78)
K3 = PRF(CardKey, 0x2d003f79)
K4 = PRF(CardKey, 0x2d003f7a)
ID  = PRF(IssuerKey, 0x2d003f7b || UID)
```

### BTCPayServer Pull-Payment Variant

BTCPayServer extends `CardKey` derivation to include the pull payment ID:

```csharp
// From BTCPayServer/Extensions.cs (line 204)
public static CardKey CreatePullPaymentCardKey(
    this IssuerKey issuerKey, byte[] uid, int version, string pullPaymentId)
{
    var data = Encoding.UTF8.GetBytes(pullPaymentId);
    return issuerKey.CreateCardKey(uid, version, data);  // extra data appended
}
```

Effective derivation:
```
CardKey = PRF(IssuerKey, 0x2d003f75 || UID || LE32(Version) || UTF8(pullPaymentId))
```

This means:
- **K1** is the same as standard derivation (only uses IssuerKey) — one key identifies ALL cards
- **K0, K2, K3, K4** are different from standard derivation (CardKey includes pullPaymentId)
- To re-derive K2 for CMAC verification: issuer key + UID + version + pullPaymentId
- **For key recovery**: the issuer key alone is sufficient — it lets us decrypt `p=` and identify cards

### Test Vectors (Standard Derivation)

From the boltcard specification:

```
Input:
  UID:         04a39493cc8680
  Issuer Key:  00000000000000000000000000000001
  Version:     1

Expected:
  CardKey: ebff5a4e6da5ee14cbfe720ae06fbed9
  K0:      a29119fcb48e737d1591d3489557e49b
  K1:      55da174c9608993dc27bb3f30a4a7314
  K2:      f4b404be700ab285e333e32348fa3d3b
  K3:      73610ba4afe45b55319691cb9489142f
  K4:      addd03e52964369be7f2967736b7bdb5
  ID:      e07ce1279d980ecb892a81924b67bf18
```

### Default Dev Key

BTCPayServer in development mode uses a fixed key (`0x01` followed by 15 zero bytes):

```csharp
// From SettingsRepositoryExtensions.cs
public static AESKey FixedKey()
{
    byte[] v = new byte[16];
    v[0] = 1;
    return new AESKey(v);  // 01000000000000000000000000000000
}
```

This is already in our `keys/_default.csv` as `dev-01`.

### How This Project Looks Up Keys at Runtime

When a card is tapped, this project resolves keys in this priority order:

1. **Per-card keys** — direct K0/K1/K2 lookup by UID from `_percard_*.csv` files
2. **Environment ISSUER_KEY** — current production key (not in CSV files)
3. **Environment RECOVERY_ISSUER_KEYS** — comma-separated fallback keys
4. **Public issuer keys** — from `generatedKeyData.js` (all CSV files in `keys/`)

For each issuer key candidate, the project tries standard derivation to decrypt the `p=` parameter and validate the CMAC. Per-card keys are tried first because they're an exact match (no derivation needed).
