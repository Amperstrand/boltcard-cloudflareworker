# Key Recovery — Extracting Boltcard Keys from Decommissioned Services

> **⚠️ DISCLAIMER: This guide is ONLY for recovering cards from services that have been permanently shut down (sunset) with no plans to resume operation. Do NOT extract keys from services that are still active or may be reactivated. Extracting keys from an active service would compromise the security of all cards still in circulation. Only use these techniques on your own decommissioned infrastructure, or with explicit written permission from the service operator.**

This project helps boltcard owners recover and reprogram NTAG424 NFC cards from defunct services. If a card was programmed by a service that no longer exists, and we have the encryption keys, a user can tap their card on [/login](https://boltcardpoc.psbt.me/login) to see their keys and get a link to wipe and reprogram the card.

If you have access to a decommissioned server's database, you can extract the keys and contribute them as a CSV file to the `keys/` directory.

---

## How This Project Uses Keys

This project supports two key formats:

### 1. Issuer Key (Standard Deterministic Derivation)

A single 16-byte issuer key can derive all card keys (K0–K4) from any card UID. This is the approach used by BTCPayServer's core boltcard support and the [boltcard specification](https://github.com/boltcard/boltcard/blob/main/docs/DETERMINISTIC.md).

Derivation (PRF = AES-CMAC):
```
CardKey = PRF(IssuerKey, 0x2d003f75 || UID || Version)
K0 = PRF(CardKey, 0x2d003f76)
K1 = PRF(IssuerKey, 0x2d003f77)    ← shared across all cards
K2 = PRF(CardKey, 0x2d003f78)
K3 = PRF(CardKey, 0x2d003f79)
K4 = PRF(CardKey, 0x2d003f7a)
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

- `issuer_key`: 32 hex characters (16 bytes)
- `label`: human-readable name for reference

Files prefixed with `_percard` are treated as per-card format. All other `.csv` files in `keys/` are treated as issuer key files. The `_default.csv` file's keys are tried for ALL domains.

### Per-Card Key CSV

Filename: `keys/_percard_<source>.csv`

```csv
uid,k0,k1,k2,card_name
04aabbccddeeff,00112233445566778899aabbccddeeff,112233445566778899aabbccddeeff00,22334455667788990011aabbccddeeff01,my-card
```

- `uid`: 14 hex characters (7 bytes, the NFC card UID)
- `k0`, `k1`, `k2`: 32 hex characters each (16 bytes)
- `card_name`: optional label (used for reference, not looked up)

---

## Extraction Guides

### BTCPayServer — Core Boltcard Support (PullPayments.Boltcards)

**Works for**: BTCPayServer v1.10+ with the built-in boltcard/PullPayment integration.

**Key storage**: BTCPayServer uses deterministic key derivation with a single issuer key stored in the PostgreSQL `"Settings"` table. Cards are registered in a `boltcards` table.

> **Important**: BTCPayServer uses a **pull-payment variant** of the standard derivation. The `CardKey` is derived as:
> ```
> CardKey = PRF(IssuerKey, 0x2d003f75 || UID || Version || UTF8(pullPaymentId))
> ```
> This means the issuer key alone is NOT sufficient to derive card keys — you also need the `pullPaymentId` for each card. The standard boltcard derivation (without `pullPaymentId`) will produce **different** K0/K2 values.
>
> However, **K1 is shared** and derived from only the issuer key (`PRF(IssuerKey, 0x2d003f77)`), so the issuer key alone lets you decrypt the `p=` parameter and identify cards. Full card validation (CMAC via K2) requires re-deriving per-card keys with the correct `pullPaymentId`.

#### What to extract

1. **Issuer key** from the `Settings` table
2. **Card registrations** from the `boltcards` table (core schema, not LNbank plugin)

#### Step 1: Find the PostgreSQL container

```bash
PG=$(docker ps -q --filter "name=postgres" | head -n1)
if [ -z "$PG" ]; then
  echo "No postgres container found"
  exit 1
fi
```

#### Step 2: Extract the issuer key

The issuer key is stored as JSON in the `"Settings"` table:

```bash
docker exec "$PG" psql -U postgres -Atc \
  "SELECT \"Value\" FROM \"Settings\" WHERE \"Id\" = 'BoltcardSettings';"
```

Output looks like:
```json
{"IssuerKey":"aabbccdd11223344aabbccdd11223344"}
```

The `IssuerKey` field is a hex-encoded 16-byte key.

#### Step 3: Extract card registrations

```bash
docker exec "$PG" psql -U postgres -Atc \
  "SELECT id, ppid, version, counter FROM boltcards WHERE ppid IS NOT NULL ORDER BY id;"
```

Output columns:
- `id`: The boltcard ID (derived from `PRF(IssuerKey, 0x2d003f7b || UID)`) — this is NOT the card UID
- `ppid`: Pull payment ID — needed for full key derivation
- `version`: Key version (incremented on re-provisioning)
- `counter`: Last-seen counter value

#### Step 4: Contribute the issuer key

If you only have the issuer key (no per-card derivation needed for basic identification), add it to `keys/`:

```csv
# keys/btcpay-myserver.example.com.csv
issuer_key,label
aabbccdd11223344aabbccdd11223344,btcpay-myserver
```

This allows the service to decrypt `p=` and identify cards from that BTCPayServer instance. Full CMAC validation (K2) requires additional pull-payment-aware key derivation not yet supported by this project.

---

### BTCPayServer — LNbank Plugin (Legacy)

**Works for**: BTCPayServer installations that used the [LNbank plugin](https://github.com/dgarage/LNbank) for boltcard management.

**Key storage**: The LNbank plugin has its OWN `"BoltCards"` table in a separate PostgreSQL schema (`"BTCPayServer.Plugins.LNbank"`). This table stores card metadata but **NOT** encryption keys. The actual keys are derived from the same BTCPayServer issuer key via the pull-payment variant derivation described above.

#### What you get from the LNbank tables

The LNbank `BoltCards` table has:
- `CardIdentifier` — the NFC card UID (nullable if card was never fully set up)
- `Counter` — last counter value (-1 if never used)
- `Status` — 0=inactive, 1=active, 2=expired
- `WithdrawConfigId` — links to `WithdrawConfigs` table

This data **does not contain encryption keys**. It tells you which UIDs were registered and their states. To get the actual keys, you still need the issuer key from the `Settings` table (see above).

#### Extraction script

```bash
#!/bin/bash
set -euo pipefail

PG=$(docker ps -q --filter "name=postgres" | head -n1)
if [ -z "$PG" ]; then
  echo "No postgres container found"
  exit 1
fi

# Find databases with LNbank BoltCards
DBS=$(docker exec "$PG" psql -U postgres -Atc \
  "select datname from pg_database where datistemplate=false;")

for DB in $DBS; do
  HAS_TABLE=$(docker exec "$PG" psql -U postgres -d "$DB" -Atc \
    "select to_regclass('\"BTCPayServer.Plugins.LNbank\".\"BoltCards\"');" 2>/dev/null || true)

  if [ -n "$HAS_TABLE" ]; then
    echo "=== LNbank BoltCards in database: $DB ==="

    # Card registrations
    docker exec "$PG" psql -U postgres -d "$DB" -c \
      "SELECT \"BoltCardId\", \"CardIdentifier\", \"Index\", \"Counter\", \"Status\", \"WithdrawConfigId\"
       FROM \"BTCPayServer.Plugins.LNbank\".\"BoltCards\"
       ORDER BY \"CardIdentifier\" NULLS LAST;"

    # The issuer key (from main settings)
    echo ""
    echo "=== Issuer Key ==="
    docker exec "$PG" psql -U postgres -d "$DB" -Atc \
      "SELECT \"Value\" FROM \"Settings\" WHERE \"Id\" = 'BoltcardSettings';"
  fi
done
```

#### What the LNbank dump tells you

- Which card UIDs were registered (non-null `CardIdentifier`)
- Whether they were active (Status=1), inactive (0), or expired (2)
- Whether they were ever used (Counter > 0)

**You still need the issuer key** to derive the actual encryption keys.

---

### LNBits — Boltcards Extension

**Works for**: Any LNBits installation using the [boltcards extension](https://github.com/lnbits/boltcards).

**Key storage**: LNBits stores K0, K1, K2 **per card in plaintext** in its database. No derivation needed — the keys are right there.

The data lives in `boltcards.cards` table (namespaced as `boltcards.cards` in the LNBits database). For SQLite-based installs, the file is `ext_boltcards.sqlite3`. For PostgreSQL-based installs, the table is in the main LNBits database.

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

Note: `prev_k0`/`prev_k1`/`prev_k2` store the keys from before the last wipe/re-key operation.

#### Step 1: Locate the LNBits database

LNBits can use SQLite or PostgreSQL. For SQLite, the boltcard extension has its own database file. Use the finder script below:

```bash
#!/bin/bash
set -euo pipefail

echo "=== [1] Host filesystem ==="
find / -name 'ext_boltcards.sqlite3' 2>/dev/null | while read -r f; do
  echo "FOUND: $f ($(stat -c%s "$f") bytes)"
done

echo ""
echo "=== [2] Docker volumes ==="
docker volume ls -q 2>/dev/null | while read -r vol; do
  found=$(docker run --rm -v "$vol":/vol alpine sh -c 'find /vol -name "ext_boltcards.sqlite3" 2>/dev/null' || true)
  [ -n "$found" ] && echo "FOUND in volume $vol: $found"
done

echo ""
echo "=== [3] Docker containers ==="
for c in $(docker ps -aq 2>/dev/null); do
  found=$(docker exec "$c" find / -name 'ext_boltcards.sqlite3' 2>/dev/null || true)
  [ -n "$found" ] && echo "FOUND in container $(docker inspect --format '{{.Name}}' "$c"): $found"
done

echo ""
echo "=== [4] LNBits data dirs (via main database) ==="
find / -name 'database.sqlite3' -not -path '*/node_modules/*' -not -path '*/.local/*' 2>/dev/null | while read -r f; do
  dir=$(dirname "$f")
  echo "LNBits data dir: $dir"
  ls -la "$dir"/ext_boltcards.sqlite3 2>/dev/null || echo "  no boltcard db here"
done

echo ""
echo "=== [5] LNBits processes ==="
ps aux | grep -i lnbits | grep -v grep || echo "none running"

echo ""
echo "=== Done ==="
```

#### Step 2: Extract per-card keys (SQLite)

```bash
sqlite3 /path/to/ext_boltcards.sqlite3 \
  "SELECT uid, k0, k1, k2, card_name FROM boltcards.cards ORDER BY uid;" \
  -separator ','
```

Or as a proper CSV with header:

```bash
sqlite3 -header -csv /path/to/ext_boltcards.sqlite3 \
  "SELECT uid, k0, k1, k2, card_name FROM boltcards.cards ORDER BY uid;"
```

#### Step 2 (alternative): Extract per-card keys (PostgreSQL)

If LNBits is configured to use PostgreSQL:

```bash
PG=$(docker ps -q --filter "name=postgres" | head -n1)

docker exec "$PG" psql -U postgres -Atc \
  "SELECT uid || ',' || k0 || ',' || k1 || ',' || k2 || ',' || COALESCE(card_name,'')
   FROM boltcards.cards
   ORDER BY uid;" -A -F ''
```

#### Step 3: Create the per-card CSV

Save the output as `keys/_percard_<source>.csv` with the proper header:

```csv
# Boltcard key recovery — LNBits at myserver.example.com
# Per-card keys from decommissioned LNBits instance
uid,k0,k1,k2,card_name
04aabbccddeeff,00112233445566778899aabbccddeeff,112233445566778899aabbccddeeff00,22334455667788990011aabbccddeeff01,test-card-1
04112233445566,deadbeefdeadbeefdeadbeefdeadbeef,cafebabecafebabecafebabecafebabe,0102030405060708090a0b0c0d0e0f00,test-card-2
```

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
4. **Commit** both the new CSV and the regenerated `utils/generatedKeyData.js`
5. **Open a pull request** with a description mentioning the decommissioned service

### Naming Conventions

| File | Format | Purpose |
|------|--------|---------|
| `keys/_default.csv` | Issuer key | Tried for ALL domains |
| `keys/<domain>.csv` | Issuer key | Domain-specific issuer keys |
| `keys/_percard_<source>.csv` | Per-card | Individual K0/K1/K2 per card |
| `keys/backups/` | Any | Historical/reference data (not processed) |

### After Adding Keys

Run `node scripts/build_keys.js` to regenerate `utils/generatedKeyData.js`. This is also run automatically during `npm run deploy`.

---

## Technical Reference: BTCPayServer Key Derivation

BTCPayServer implements the [boltcard deterministic key specification](https://github.com/boltcard/boltcard/blob/main/docs/DETERMINISTIC.md) with a pull-payment extension.

### Standard Derivation (boltcard spec)

```
CardKey = PRF(IssuerKey, 0x2d003f75 || UID || LE32(Version))
K0 = PRF(CardKey, 0x2d003f76)
K1 = PRF(IssuerKey, 0x2d003f77)
K2 = PRF(CardKey, 0x2d003f78)
K3 = PRF(CardKey, 0x2d003f79)
K4 = PRF(CardKey, 0x2d003f7a)
ID  = PRF(IssuerKey, 0x2d003f7b || UID)
```

### BTCPayServer Pull-Payment Variant

BTCPayServer extends `CardKey` derivation to include the pull payment ID:

```csharp
// From BTCPayServer/Extensions.cs
public static CardKey CreatePullPaymentCardKey(this IssuerKey issuerKey, byte[] uid, int version, string pullPaymentId)
{
    var data = Encoding.UTF8.GetBytes(pullPaymentId);
    return issuerKey.CreateCardKey(uid, version, data);  // extra data appended
}
```

This means:
- **K1** is the same as standard derivation (only uses IssuerKey)
- **K0, K2, K3, K4** are different from standard derivation (CardKey includes pullPaymentId)
- To re-derive K2 for CMAC verification, you need: issuer key + UID + version + pullPaymentId

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
