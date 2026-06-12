/*
 * pam_ntag424.c — Local NTAG424 DNA NFC card PAM authentication module
 *
 * Validates NTAG424 DNA SDM taps using locally stored K1/K2 keys and pcscd.
 * No network required; all verification is done on-device.
 *
 * Cryptographic flow (matching boltcard-protocol.md and cryptoutils.js):
 *   1. PC/SC: read NDEF URL from card via pcscd (first available reader)
 *   2. Parse p= and c= URL parameters from the NDEF URI record
 *   3. AES-128-ECB decrypt p with K1 → assert header 0xC7, extract UID (7 bytes)
 *      and SDMReadCtr (3 bytes, little-endian)
 *   4. Build SV2: [3C C3 00 01 00 80] [UID 7B] [ctr_MSB ctr_mid ctr_LSB]
 *   5. ks  = AES-CMAC(K2, SV2)
 *   6. cm  = AES-CMAC(ks, empty_message)   ← BoltCard empty-message CMAC
 *   7. ct  = [cm[1] cm[3] cm[5] cm[7] cm[9] cm[11] cm[13] cm[15]]  ← odd-byte truncation
 *   8. Timing-safe compare ct == c_param
 *   9. Read last_counter for UID from state_dir; assert counter > last_counter
 *  10. Atomically update last_counter to current counter
 *
 * Configuration file (default: /etc/security/pam_ntag424.conf):
 *   k1        = <32 hex chars, AES-128>   # PICCData decryption key
 *   k2        = <32 hex chars, AES-128>   # SDM MAC verification key
 *   state_dir = /var/lib/pam_ntag424      # per-UID counter state files
 *   reader    = <substring match>         # optional: select reader by name
 *   timeout   = 15                        # seconds to wait for card (default 15)
 *
 * Build:
 *   gcc -shared -fPIC -o pam_ntag424.so pam_ntag424.c \
 *       -lpcsclite -lcrypto -lpam -Wall -Wextra -O2
 *
 * Install:
 *   cp pam_ntag424.so /lib/security/
 *   cp pam_ntag424.conf.example /etc/security/pam_ntag424.conf
 *
 * sshd_config (AuthenticationMethods keyboard-interactive):
 *   /etc/pam.d/sshd:
 *     auth required pam_ntag424.so
 *
 * References:
 *   NXP AN12196 Rev. 2.0  — NTAG 424 DNA SDM features
 *   RFC 4493              — The AES-CMAC Algorithm
 *   docs/boltcard-protocol.md — Key/CMAC derivation details
 */

#define _GNU_SOURCE  /* for getline(3), asprintf(3) */

#include <errno.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <syslog.h>
#include <time.h>
#include <unistd.h>
#include <sys/stat.h>

/* PAM */
#define PAM_SM_AUTH
#include <security/pam_modules.h>
#include <security/pam_ext.h>

/* PC/SC */
#include <PCSC/winscard.h>
#include <PCSC/wintypes.h>

/* OpenSSL AES (EVP) */
#include <openssl/evp.h>
#include <openssl/err.h>

/* ── constants ─────────────────────────────────────────────────────────────── */

#define AES_BLOCK   16              /* AES-128 block size in bytes */
#define KEY_BYTES   16              /* AES-128 key length */
#define UID_BYTES    7              /* NTAG424 UID length */
#define CTR_BYTES    3              /* SDMReadCtr length */
#define CMAC_TRUNC   8              /* BoltCard truncated CMAC length */
#define P_HEX_LEN   32              /* p= parameter: 16 bytes hex */
#define C_HEX_LEN   16              /* c= parameter:  8 bytes hex */

#define DEFAULT_CONFIG   "/etc/security/pam_ntag424.conf"
#define DEFAULT_STATEDIR "/var/lib/pam_ntag424"
#define DEFAULT_TIMEOUT  15         /* seconds to wait for card */

/* NTAG424 NDEF Application AID: D2 76 00 00 85 01 01 */
static const BYTE NDEF_AID[]  = { 0xD2,0x76,0x00,0x00,0x85,0x01,0x01 };
/* NDEF CC file id */
static const BYTE CC_FILE_ID[] = { 0xE1, 0x03 };
/* NDEF data file id */
static const BYTE NDEF_FILE_ID[] = { 0xE1, 0x04 };

/* ── config ─────────────────────────────────────────────────────────────────── */

typedef struct {
    uint8_t  k1[KEY_BYTES];
    uint8_t  k2[KEY_BYTES];
    char     state_dir[512];
    char     reader[256];       /* substring to match reader name; "" = any */
    int      timeout;           /* seconds */
} ntag424_config_t;

/* ── helpers ────────────────────────────────────────────────────────────────── */

static void pam_log(pam_handle_t *pamh, int priority, const char *fmt, ...)
{
    va_list ap;
    va_start(ap, fmt);
    pam_vsyslog(pamh, priority, fmt, ap);
    va_end(ap);
}

/* Convert lower-case hex char to nibble, returns -1 on invalid char. */
static int hex_nibble(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

/*
 * hex_to_bytes — decode a hex string into `out` (at most `max_bytes` bytes).
 * Returns number of bytes written, or -1 on error.
 */
static int hex_to_bytes(const char *hex, uint8_t *out, size_t max_bytes)
{
    size_t len = strlen(hex);
    if (len % 2 != 0 || len / 2 > max_bytes) return -1;
    for (size_t i = 0; i < len; i += 2) {
        int hi = hex_nibble(hex[i]);
        int lo = hex_nibble(hex[i+1]);
        if (hi < 0 || lo < 0) return -1;
        out[i/2] = (uint8_t)((hi << 4) | lo);
    }
    return (int)(len / 2);
}

/*
 * bytes_to_hex — encode `len` bytes into a NUL-terminated lower-case hex
 * string.  `out` must have space for 2*len+1 bytes.
 */
static void bytes_to_hex(const uint8_t *in, size_t len, char *out)
{
    static const char hx[] = "0123456789abcdef";
    for (size_t i = 0; i < len; i++) {
        out[i*2]   = hx[in[i] >> 4];
        out[i*2+1] = hx[in[i] & 0x0f];
    }
    out[len*2] = '\0';
}

/* Trim leading + trailing whitespace; modifies string in-place. */
static char *trim(char *s)
{
    while (*s == ' ' || *s == '\t') s++;
    char *e = s + strlen(s);
    while (e > s && (e[-1] == ' ' || e[-1] == '\t' ||
                     e[-1] == '\n' || e[-1] == '\r'))
        *--e = '\0';
    return s;
}

/* ── config parsing ──────────────────────────────────────────────────────────── */

/*
 * load_config — parse /etc/security/pam_ntag424.conf (or path from PAM args).
 *
 * File format (lines starting with '#' are comments):
 *   k1        = <32 hex chars>
 *   k2        = <32 hex chars>
 *   state_dir = /var/lib/pam_ntag424
 *   reader    = ACS ACR122U
 *   timeout   = 15
 */
static int load_config(pam_handle_t *pamh, const char *path,
                        ntag424_config_t *cfg)
{
    memset(cfg, 0, sizeof(*cfg));
    strncpy(cfg->state_dir, DEFAULT_STATEDIR, sizeof(cfg->state_dir) - 1);
    cfg->timeout = DEFAULT_TIMEOUT;

    FILE *f = fopen(path, "r");
    if (!f) {
        pam_log(pamh, LOG_ERR, "pam_ntag424: cannot open config %s: %s",
                path, strerror(errno));
        return -1;
    }

    char *line = NULL;
    size_t cap = 0;
    ssize_t n;
    int has_k1 = 0, has_k2 = 0;

    while ((n = getline(&line, &cap, f)) >= 0) {
        char *s = trim(line);
        if (*s == '#' || *s == '\0') continue;

        char *eq = strchr(s, '=');
        if (!eq) continue;
        *eq = '\0';
        char *key = trim(s);
        char *val = trim(eq + 1);

        if (strcmp(key, "k1") == 0) {
            if (hex_to_bytes(val, cfg->k1, KEY_BYTES) != KEY_BYTES) {
                pam_log(pamh, LOG_ERR, "pam_ntag424: invalid k1 in %s", path);
                goto fail;
            }
            has_k1 = 1;
        } else if (strcmp(key, "k2") == 0) {
            if (hex_to_bytes(val, cfg->k2, KEY_BYTES) != KEY_BYTES) {
                pam_log(pamh, LOG_ERR, "pam_ntag424: invalid k2 in %s", path);
                goto fail;
            }
            has_k2 = 1;
        } else if (strcmp(key, "state_dir") == 0) {
            strncpy(cfg->state_dir, val, sizeof(cfg->state_dir) - 1);
        } else if (strcmp(key, "reader") == 0) {
            strncpy(cfg->reader, val, sizeof(cfg->reader) - 1);
        } else if (strcmp(key, "timeout") == 0) {
            cfg->timeout = atoi(val);
            if (cfg->timeout <= 0) cfg->timeout = DEFAULT_TIMEOUT;
        }
    }
    free(line);
    fclose(f);

    if (!has_k1 || !has_k2) {
        pam_log(pamh, LOG_ERR,
                "pam_ntag424: config %s must define k1 and k2", path);
        return -1;
    }
    return 0;

fail:
    free(line);
    fclose(f);
    return -1;
}

/* ── AES-128-ECB decrypt (single block) ────────────────────────────────────── */

/*
 * aes128_ecb_decrypt — decrypt exactly one AES block (16 bytes).
 * Returns 0 on success, -1 on error.
 */
static int aes128_ecb_decrypt(const uint8_t key[KEY_BYTES],
                               const uint8_t in[AES_BLOCK],
                               uint8_t       out[AES_BLOCK])
{
    EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
    if (!ctx) return -1;

    int ok = 1;
    int outl = 0, outl2 = 0;

    /* Disable padding so we handle exactly one block. */
    if (!EVP_DecryptInit_ex(ctx, EVP_aes_128_ecb(), NULL, key, NULL) ||
        !EVP_CIPHER_CTX_set_padding(ctx, 0) ||
        !EVP_DecryptUpdate(ctx, out, &outl, in, AES_BLOCK) ||
        !EVP_DecryptFinal_ex(ctx, out + outl, &outl2)) {
        ok = 0;
    }

    EVP_CIPHER_CTX_free(ctx);
    return ok ? 0 : -1;
}

/* ── AES-128-ECB encrypt (single block, for CMAC) ───────────────────────────── */

static int aes128_ecb_encrypt(const uint8_t key[KEY_BYTES],
                               const uint8_t in[AES_BLOCK],
                               uint8_t       out[AES_BLOCK])
{
    EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
    if (!ctx) return -1;

    int ok = 1;
    int outl = 0, outl2 = 0;

    if (!EVP_EncryptInit_ex(ctx, EVP_aes_128_ecb(), NULL, key, NULL) ||
        !EVP_CIPHER_CTX_set_padding(ctx, 0) ||
        !EVP_EncryptUpdate(ctx, out, &outl, in, AES_BLOCK) ||
        !EVP_EncryptFinal_ex(ctx, out + outl, &outl2)) {
        ok = 0;
    }

    EVP_CIPHER_CTX_free(ctx);
    return ok ? 0 : -1;
}

/* ── AES-CMAC (RFC 4493, single-block or empty message) ─────────────────────── */

/* Left-shift a 16-byte array one bit; returns the carry-out (old MSB). */
static uint8_t shift_left_1(const uint8_t in[AES_BLOCK], uint8_t out[AES_BLOCK])
{
    uint8_t carry = 0;
    for (int i = AES_BLOCK - 1; i >= 0; i--) {
        out[i] = (uint8_t)((in[i] << 1) | carry);
        carry   = in[i] >> 7;
    }
    return carry;
}

/*
 * generate_subkey — RFC 4493 §2.3 Generate_Subkey.
 * Derives one CMAC subkey (K1 or K2) from its predecessor.
 */
static void generate_subkey(const uint8_t in[AES_BLOCK], uint8_t out[AES_BLOCK])
{
    uint8_t carry = shift_left_1(in, out);
    if (carry)
        out[AES_BLOCK - 1] ^= 0x87;   /* GF(2^128) reduction polynomial */
}

/*
 * aes_cmac — RFC 4493 AES-CMAC for 0 or 16-byte messages.
 *
 * This intentionally mirrors the JavaScript computeAesCmac() in cryptoutils.js.
 * Multi-block messages are not needed for the BoltCard protocol.
 *
 * Returns 0 on success, -1 on error.
 */
static int aes_cmac(const uint8_t key[KEY_BYTES],
                    const uint8_t *msg, size_t msg_len,
                    uint8_t mac[AES_BLOCK])
{
    if (msg_len > AES_BLOCK) return -1; /* only 0 or 1-block supported */

    /* Step 1: L = AES(key, 0x00…) */
    uint8_t zero[AES_BLOCK] = {0};
    uint8_t L[AES_BLOCK];
    if (aes128_ecb_encrypt(key, zero, L) != 0) return -1;

    /* Step 2: K1 = generate_subkey(L) */
    uint8_t K1[AES_BLOCK];
    generate_subkey(L, K1);

    uint8_t M_last[AES_BLOCK];

    if (msg_len == AES_BLOCK) {
        /* Complete block: M_last = M XOR K1 */
        for (int i = 0; i < AES_BLOCK; i++)
            M_last[i] = msg[i] ^ K1[i];
    } else {
        /* Incomplete/empty block: pad with 0x80 00…, XOR with K2 */
        uint8_t K2[AES_BLOCK];
        generate_subkey(K1, K2);

        uint8_t padded[AES_BLOCK] = {0};
        if (msg_len > 0)
            memcpy(padded, msg, msg_len);
        padded[msg_len] = 0x80;

        for (int i = 0; i < AES_BLOCK; i++)
            M_last[i] = padded[i] ^ K2[i];
    }

    /* Step 4: T = AES(key, M_last) */
    return aes128_ecb_encrypt(key, M_last, mac);
}

/* ── NTAG424 crypto ─────────────────────────────────────────────────────────── */

/*
 * decrypt_p — AES-128-ECB decrypt the p= parameter with K1.
 *
 * On success:
 *   uid_out  ← 7 bytes (plaintext[1..7])
 *   ctr_out  ← 3 bytes big-endian: [plaintext[10], [9], [8]]
 *              (little-endian in chip, reversed here for SV2 building)
 * Returns 0 on success, -1 on error (wrong key or bad header byte).
 */
static int decrypt_p(const uint8_t k1[KEY_BYTES],
                     const char    *p_hex,
                     uint8_t        uid_out[UID_BYTES],
                     uint8_t        ctr_out[CTR_BYTES])
{
    if (strlen(p_hex) != P_HEX_LEN) return -1;

    uint8_t p_bytes[AES_BLOCK];
    if (hex_to_bytes(p_hex, p_bytes, AES_BLOCK) != AES_BLOCK) return -1;

    uint8_t plain[AES_BLOCK];
    if (aes128_ecb_decrypt(k1, p_bytes, plain) != 0) return -1;

    /* NXP AN12196 §5.5: PICCDataTag 0xC7 indicates UID+counter mirroring */
    if (plain[0] != 0xC7) return -1;

    memcpy(uid_out, plain + 1, UID_BYTES);

    /* Counter is little-endian in chip; reverse for SV2 (see boltcard-protocol.md §4) */
    ctr_out[0] = plain[10];   /* MSB */
    ctr_out[1] = plain[9];
    ctr_out[2] = plain[8];    /* LSB */

    return 0;
}

/*
 * compute_ct — derive the expected BoltCard truncated CMAC (ct) from
 * UID + counter using K2.
 *
 * Chain (matches buildVerificationData / computeAesCmacForVerification in
 * cryptoutils.js):
 *   SV2 = [3C C3 00 01 00 80] [uid 7B] [ctr[2] ctr[1] ctr[0]]
 *   ks  = AES-CMAC(K2, SV2)
 *   cm  = AES-CMAC(ks, empty)
 *   ct  = [cm[1] cm[3] cm[5] cm[7] cm[9] cm[11] cm[13] cm[15]]
 *
 * Returns 0 on success, -1 on error.
 */
static int compute_ct(const uint8_t k2[KEY_BYTES],
                      const uint8_t uid[UID_BYTES],
                      const uint8_t ctr[CTR_BYTES],  /* [MSB mid LSB] */
                      uint8_t       ct_out[CMAC_TRUNC])
{
    /* Build SV2 (16 bytes) */
    uint8_t sv2[AES_BLOCK] = {
        0x3C, 0xC3, 0x00, 0x01, 0x00, 0x80,
        uid[0], uid[1], uid[2], uid[3], uid[4], uid[5], uid[6],
        ctr[2],   /* SV2[13] = counter LSB  (ctr[2] after reversal above) */
        ctr[1],   /* SV2[14] = counter mid  */
        ctr[0]    /* SV2[15] = counter MSB  */
    };

    /* ks = AES-CMAC(K2, SV2) */
    uint8_t ks[AES_BLOCK];
    if (aes_cmac(k2, sv2, AES_BLOCK, ks) != 0) return -1;

    /* cm = AES-CMAC(ks, empty_message) */
    uint8_t cm[AES_BLOCK];
    if (aes_cmac(ks, NULL, 0, cm) != 0) return -1;

    /* BoltCard odd-byte truncation: ct = cm[1,3,5,7,9,11,13,15] */
    for (int i = 0; i < CMAC_TRUNC; i++)
        ct_out[i] = cm[1 + i * 2];

    return 0;
}

/*
 * verify_cmac — timing-safe comparison of computed ct vs c_hex parameter.
 * Returns 1 if valid, 0 if invalid.
 */
static int verify_cmac(const uint8_t k2[KEY_BYTES],
                       const uint8_t uid[UID_BYTES],
                       const uint8_t ctr[CTR_BYTES],
                       const char   *c_hex)
{
    if (!c_hex || strlen(c_hex) != C_HEX_LEN) return 0;

    uint8_t provided[CMAC_TRUNC];
    if (hex_to_bytes(c_hex, provided, CMAC_TRUNC) != CMAC_TRUNC) return 0;

    uint8_t expected[CMAC_TRUNC];
    if (compute_ct(k2, uid, ctr, expected) != 0) return 0;

    /* Timing-safe XOR accumulate (avoids short-circuit on first mismatch) */
    uint8_t diff = 0;
    for (int i = 0; i < CMAC_TRUNC; i++)
        diff |= expected[i] ^ provided[i];

    return diff == 0;
}

/* ── counter state (replay protection) ─────────────────────────────────────── */

/*
 * counter_path — build the path for the per-UID counter file.
 * Caller must free the returned string.
 */
static char *counter_path(const char *state_dir, const uint8_t uid[UID_BYTES])
{
    char uid_hex[UID_BYTES * 2 + 1];
    bytes_to_hex(uid, UID_BYTES, uid_hex);
    char *path = NULL;
    if (asprintf(&path, "%s/%s.ctr", state_dir, uid_hex) < 0) return NULL;
    return path;
}

/*
 * read_last_counter — returns the last accepted counter for `uid`, or 0 if
 * no state file exists yet (first tap).
 */
static uint32_t read_last_counter(const char *state_dir,
                                   const uint8_t uid[UID_BYTES])
{
    char *path = counter_path(state_dir, uid);
    if (!path) return 0;

    FILE *f = fopen(path, "r");
    free(path);
    if (!f) return 0;  /* first tap */

    uint32_t val = 0;
    fscanf(f, "%u", &val);
    fclose(f);
    return val;
}

/*
 * write_counter — atomically (rename) update the counter file.
 * Returns 0 on success, -1 on error.
 */
static int write_counter(pam_handle_t *pamh,
                          const char *state_dir,
                          const uint8_t uid[UID_BYTES],
                          uint32_t counter)
{
    /* Ensure state_dir exists */
    if (mkdir(state_dir, 0700) != 0 && errno != EEXIST) {
        pam_log(pamh, LOG_ERR, "pam_ntag424: mkdir %s: %s",
                state_dir, strerror(errno));
        return -1;
    }

    char *path = counter_path(state_dir, uid);
    if (!path) return -1;

    /* Write to a temp file then rename for atomicity */
    char *tmp_path = NULL;
    if (asprintf(&tmp_path, "%s.tmp", path) < 0) { free(path); return -1; }

    FILE *f = fopen(tmp_path, "w");
    if (!f) {
        pam_log(pamh, LOG_ERR, "pam_ntag424: open %s: %s",
                tmp_path, strerror(errno));
        free(path); free(tmp_path);
        return -1;
    }
    fprintf(f, "%u\n", counter);
    fclose(f);

    if (rename(tmp_path, path) != 0) {
        pam_log(pamh, LOG_ERR, "pam_ntag424: rename %s → %s: %s",
                tmp_path, path, strerror(errno));
        unlink(tmp_path);
        free(path); free(tmp_path);
        return -1;
    }

    free(path); free(tmp_path);
    return 0;
}

/* ── PC/SC card reading ──────────────────────────────────────────────────────── */

/* Minimal APDU helper: sends cmd (cmd_len bytes) and receives up to buf_sz
 * bytes into buf; sets *recv_len to actual received length.
 * Returns SCARD_S_SUCCESS or a PC/SC error code. */
static LONG pcsc_transmit(SCARDHANDLE card,
                           const BYTE *cmd,   DWORD cmd_len,
                           BYTE       *buf,   DWORD buf_sz,
                           DWORD      *recv_len)
{
    SCARD_IO_REQUEST ior = { SCARD_PROTOCOL_T1, sizeof(SCARD_IO_REQUEST) };
    *recv_len = buf_sz;
    return SCardTransmit(card, &ior, cmd, cmd_len, NULL, buf, recv_len);
}

/* Return 1 if the last two bytes of a response are 90 00 (ISO success). */
static int sw_ok(const BYTE *resp, DWORD len)
{
    return len >= 2 && resp[len-2] == 0x90 && resp[len-1] == 0x00;
}

/*
 * pcsc_read_ndef_url — connects to the first reader whose name contains
 * `reader_substr` (or any reader if empty), waits up to `timeout_sec` for
 * a card, then reads the NDEF URI and returns it in `url_out` (caller frees).
 *
 * Returns 0 on success, -1 on error or timeout.
 *
 * APDU sequence (ISO 7816-4 / Type 4 Tag):
 *   1. SELECT NDEF Application AID (D2 76 00 00 85 01 01)
 *   2. SELECT CC file (E1 03) and read it to get NDEF file id + size
 *   3. SELECT NDEF file (E1 04)
 *   4. READ BINARY first 2 bytes → NDEF message length
 *   5. READ BINARY full NDEF message
 *   6. Parse NDEF URI record → URL string
 */
static int pcsc_read_ndef_url(pam_handle_t *pamh,
                               const char   *reader_substr,
                               int           timeout_sec,
                               char        **url_out)
{
    SCARDCONTEXT ctx = 0;
    SCARDHANDLE  card = 0;
    LONG rv;
    char *chosen_reader = NULL;
    int  ret = -1;

    rv = SCardEstablishContext(SCARD_SCOPE_SYSTEM, NULL, NULL, &ctx);
    if (rv != SCARD_S_SUCCESS) {
        pam_log(pamh, LOG_ERR, "pam_ntag424: SCardEstablishContext: %s",
                pcsc_stringify_error(rv));
        return -1;
    }

    /* ── Enumerate readers and pick one ── */
    DWORD readers_len = SCARD_AUTOALLOCATE;
    char *readers_buf = NULL;
    rv = SCardListReaders(ctx, NULL, (LPSTR)&readers_buf, &readers_len);
    if (rv != SCARD_S_SUCCESS || !readers_buf) {
        pam_log(pamh, LOG_ERR, "pam_ntag424: SCardListReaders: %s",
                pcsc_stringify_error(rv));
        goto cleanup;
    }

    /* The readers_buf is a multi-string (NUL-separated, double-NUL terminated) */
    for (const char *p = readers_buf; *p; p += strlen(p) + 1) {
        if (!reader_substr || reader_substr[0] == '\0' ||
            strstr(p, reader_substr)) {
            chosen_reader = strdup(p);
            break;
        }
    }
    SCardFreeMemory(ctx, readers_buf);

    if (!chosen_reader) {
        pam_log(pamh, LOG_ERR, "pam_ntag424: no matching reader found "
                "(wanted: \"%s\")", reader_substr ? reader_substr : "any");
        goto cleanup;
    }

    pam_log(pamh, LOG_INFO, "pam_ntag424: using reader: %s", chosen_reader);

    /* ── Wait for card ── */
    {
        SCARD_READERSTATE rs;
        memset(&rs, 0, sizeof(rs));
        rs.szReader     = chosen_reader;
        rs.dwCurrentState = SCARD_STATE_EMPTY;

        time_t deadline = time(NULL) + timeout_sec;
        int got_card = 0;

        while (time(NULL) < deadline) {
            DWORD remaining_ms = (DWORD)((deadline - time(NULL)) * 1000);
            if (remaining_ms == 0) remaining_ms = 1;

            rv = SCardGetStatusChange(ctx, remaining_ms, &rs, 1);
            if (rv == SCARD_E_TIMEOUT) break;
            if (rv != SCARD_S_SUCCESS) {
                pam_log(pamh, LOG_ERR,
                        "pam_ntag424: SCardGetStatusChange: %s",
                        pcsc_stringify_error(rv));
                goto cleanup;
            }
            if (rs.dwEventState & SCARD_STATE_PRESENT) {
                got_card = 1;
                break;
            }
            rs.dwCurrentState = rs.dwEventState;
        }

        if (!got_card) {
            pam_log(pamh, LOG_NOTICE,
                    "pam_ntag424: no card presented within %d seconds",
                    timeout_sec);
            goto cleanup;
        }
    }

    /* ── Connect to card ── */
    {
        DWORD active_proto = 0;
        rv = SCardConnect(ctx, chosen_reader,
                          SCARD_SHARE_SHARED,
                          SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1,
                          &card, &active_proto);
        if (rv != SCARD_S_SUCCESS) {
            pam_log(pamh, LOG_ERR, "pam_ntag424: SCardConnect: %s",
                    pcsc_stringify_error(rv));
            goto cleanup;
        }
    }

    /* ── APDU 1: SELECT NDEF Application ── */
    {
        BYTE cmd[5 + sizeof(NDEF_AID) + 1];
        DWORD clen = 0;
        cmd[clen++] = 0x00; /* CLA */
        cmd[clen++] = 0xA4; /* INS: SELECT */
        cmd[clen++] = 0x04; /* P1: select by AID */
        cmd[clen++] = 0x00; /* P2 */
        cmd[clen++] = (BYTE)sizeof(NDEF_AID);
        memcpy(cmd + clen, NDEF_AID, sizeof(NDEF_AID));
        clen += sizeof(NDEF_AID);
        cmd[clen++] = 0x00; /* Le */

        BYTE resp[256]; DWORD rlen;
        rv = pcsc_transmit(card, cmd, clen, resp, sizeof(resp), &rlen);
        if (rv != SCARD_S_SUCCESS || !sw_ok(resp, rlen)) {
            pam_log(pamh, LOG_ERR,
                    "pam_ntag424: SELECT NDEF AID failed (rv=%ld SW=%02X%02X)",
                    rv, rlen >= 2 ? resp[rlen-2] : 0xFF,
                         rlen >= 1 ? resp[rlen-1] : 0xFF);
            goto cleanup;
        }
    }

    /* ── APDU 2: SELECT CC file ── */
    {
        BYTE cmd[] = {
            0x00, 0xA4, 0x00, 0x0C,
            0x02, CC_FILE_ID[0], CC_FILE_ID[1]
        };
        BYTE resp[256]; DWORD rlen;
        rv = pcsc_transmit(card, cmd, sizeof(cmd), resp, sizeof(resp), &rlen);
        if (rv != SCARD_S_SUCCESS || !sw_ok(resp, rlen)) {
            pam_log(pamh, LOG_ERR,
                    "pam_ntag424: SELECT CC file failed");
            goto cleanup;
        }
    }

    /* ── APDU 3: READ CC (15 bytes — standard T4T CC length) ── */
    /* We read it to confirm NDEF file id; for NTAG424 it's always E104. */
    {
        BYTE cmd[] = { 0x00, 0xB0, 0x00, 0x00, 0x0F };
        BYTE resp[256]; DWORD rlen;
        rv = pcsc_transmit(card, cmd, sizeof(cmd), resp, sizeof(resp), &rlen);
        if (rv != SCARD_S_SUCCESS || !sw_ok(resp, rlen)) {
            pam_log(pamh, LOG_WARNING,
                    "pam_ntag424: READ CC failed, continuing with default E104");
        }
        /* Could parse resp to extract NDEF file ID; we use the default. */
    }

    /* ── APDU 4: SELECT NDEF Data file ── */
    {
        BYTE cmd[] = {
            0x00, 0xA4, 0x00, 0x0C,
            0x02, NDEF_FILE_ID[0], NDEF_FILE_ID[1]
        };
        BYTE resp[256]; DWORD rlen;
        rv = pcsc_transmit(card, cmd, sizeof(cmd), resp, sizeof(resp), &rlen);
        if (rv != SCARD_S_SUCCESS || !sw_ok(resp, rlen)) {
            pam_log(pamh, LOG_ERR,
                    "pam_ntag424: SELECT NDEF file failed");
            goto cleanup;
        }
    }

    /* ── APDU 5: READ BINARY first 2 bytes → NDEF message length ── */
    DWORD ndef_len = 0;
    {
        BYTE cmd[] = { 0x00, 0xB0, 0x00, 0x00, 0x02 };
        BYTE resp[256]; DWORD rlen;
        rv = pcsc_transmit(card, cmd, sizeof(cmd), resp, sizeof(resp), &rlen);
        if (rv != SCARD_S_SUCCESS || !sw_ok(resp, rlen) || rlen < 4) {
            pam_log(pamh, LOG_ERR,
                    "pam_ntag424: READ BINARY (NDEF length) failed");
            goto cleanup;
        }
        ndef_len = ((DWORD)resp[0] << 8) | resp[1];
        if (ndef_len == 0 || ndef_len > 900) {
            pam_log(pamh, LOG_ERR,
                    "pam_ntag424: unexpected NDEF length %u", (unsigned)ndef_len);
            goto cleanup;
        }
    }

    /* ── APDU 6: READ BINARY full NDEF message (offset 2, length ndef_len) ── */
    BYTE *ndef_data = malloc(ndef_len + 4);
    if (!ndef_data) goto cleanup;

    {
        BYTE cmd[5];
        cmd[0] = 0x00; cmd[1] = 0xB0;
        cmd[2] = (BYTE)((2 >> 8) & 0xFF);  /* offset hi */
        cmd[3] = (BYTE)(2 & 0xFF);          /* offset lo = 2 (skip length field) */
        cmd[4] = (BYTE)(ndef_len > 255 ? 0 : ndef_len);  /* Le */

        DWORD buf_sz = ndef_len + 4;
        DWORD rlen;
        rv = pcsc_transmit(card, cmd, 5, ndef_data, buf_sz, &rlen);
        if (rv != SCARD_S_SUCCESS || !sw_ok(ndef_data, rlen) ||
            rlen < 2) {
            pam_log(pamh, LOG_ERR, "pam_ntag424: READ BINARY (NDEF data) failed");
            free(ndef_data);
            goto cleanup;
        }

        /*
         * ── Parse NDEF URI record ──────────────────────────────────────────
         *
         * Minimal NDEF Record format (Short Record, TNF=0x01 URI):
         *   Byte 0: Header  = 0xD1 (MB=1 ME=1 SR=1 TNF=001)
         *   Byte 1: Type Length = 0x01
         *   Byte 2: Payload Length
         *   Byte 3: Type = 0x55 ('U')
         *   Byte 4: URI Identifier Code (0x03=http:// 0x04=https://)
         *   Bytes 5…: URI (ASCII, no NUL)
         *
         * We only parse the first record.  rlen includes the 2-byte SW trailer.
         */
        DWORD data_len = rlen - 2;  /* strip SW 90 00 */
        if (data_len < 5) {
            pam_log(pamh, LOG_ERR, "pam_ntag424: NDEF data too short");
            free(ndef_data);
            goto cleanup;
        }

        /* Locate NDEF record start: skip any T4T length wrapper bytes */
        BYTE *rec = ndef_data;

        /* Header sanity: accept TNF=001 (URI) or TNF=001 without MB/ME flags */
        if ((rec[0] & 0x07) != 0x01) {
            pam_log(pamh, LOG_ERR,
                    "pam_ntag424: NDEF TNF is not URI (0x01), got 0x%02X",
                    rec[0] & 0x07);
            free(ndef_data);
            goto cleanup;
        }

        BYTE type_len    = rec[1];
        BYTE payload_len = rec[2];    /* valid for Short Record (SR=1) */

        /* Check this is a 'U' record */
        if (type_len != 1 || rec[3] != 0x55) {
            pam_log(pamh, LOG_ERR, "pam_ntag424: not a URI NDEF record");
            free(ndef_data);
            goto cleanup;
        }

        BYTE uri_code = rec[4];
        const char *prefix = "";
        switch (uri_code) {
            case 0x00: prefix = "";          break;
            case 0x01: prefix = "http://www."; break;
            case 0x02: prefix = "https://www."; break;
            case 0x03: prefix = "http://";   break;
            case 0x04: prefix = "https://";  break;
            default:   prefix = "";          break;
        }

        /* URI body starts at rec[5], length = payload_len - 1 (excludes code byte) */
        if (payload_len < 1) {
            pam_log(pamh, LOG_ERR, "pam_ntag424: empty URI payload");
            free(ndef_data);
            goto cleanup;
        }
        size_t uri_body_len = (size_t)(payload_len - 1);
        char *uri_body = malloc(uri_body_len + 1);
        if (!uri_body) { free(ndef_data); goto cleanup; }
        memcpy(uri_body, rec + 5, uri_body_len);
        uri_body[uri_body_len] = '\0';

        if (asprintf(url_out, "%s%s", prefix, uri_body) < 0) {
            free(uri_body); free(ndef_data); goto cleanup;
        }
        free(uri_body);
        free(ndef_data);
        ret = 0;
        goto cleanup;
    }

cleanup:
    if (card)           SCardDisconnect(card, SCARD_LEAVE_CARD);
    if (ctx)            SCardReleaseContext(ctx);
    free(chosen_reader);
    return ret;
}

/* ── URL parameter parsing ──────────────────────────────────────────────────── */

/*
 * extract_param — find ?param= or &param= in url and copy up to `maxlen`
 * chars into `out` (NUL-terminated).  Returns 0 on success, -1 if not found.
 */
static int extract_param(const char *url, const char *name,
                          char *out, size_t maxlen)
{
    /* Build search string "?name=" and "&name=" */
    char needle[64];

    for (int prefix = 0; prefix < 2; prefix++) {
        snprintf(needle, sizeof(needle), "%c%s=",
                 prefix == 0 ? '?' : '&', name);
        const char *p = strstr(url, needle);
        if (!p) continue;

        p += strlen(needle);
        const char *end = p;
        while (*end && *end != '&' && *end != '#') end++;

        size_t vlen = (size_t)(end - p);
        if (vlen >= maxlen) return -1;
        memcpy(out, p, vlen);
        out[vlen] = '\0';
        return 0;
    }
    return -1;
}

/* ── PAM entry points ───────────────────────────────────────────────────────── */

PAM_EXTERN int pam_sm_authenticate(pam_handle_t *pamh, int flags,
                                    int argc, const char **argv)
{
    (void)flags;

    /* Determine config file path (first "conf=" argument wins) */
    const char *config_path = DEFAULT_CONFIG;
    for (int i = 0; i < argc; i++) {
        if (strncmp(argv[i], "conf=", 5) == 0) {
            config_path = argv[i] + 5;
            break;
        }
    }

    ntag424_config_t cfg;
    if (load_config(pamh, config_path, &cfg) != 0)
        return PAM_AUTH_ERR;

    /* Prompt user to tap card */
    pam_info(pamh, "Please tap your NTAG424 NFC card...");

    /* Read NDEF URL via PC/SC */
    char *url = NULL;
    if (pcsc_read_ndef_url(pamh, cfg.reader, cfg.timeout, &url) != 0) {
        pam_log(pamh, LOG_ERR,
                "pam_ntag424: failed to read NDEF URL from card");
        return PAM_AUTH_ERR;
    }

    pam_log(pamh, LOG_DEBUG, "pam_ntag424: NDEF URL: %s", url);

    /* Extract p= and c= parameters */
    char p_hex[P_HEX_LEN + 1];
    char c_hex[C_HEX_LEN + 1];

    if (extract_param(url, "p", p_hex, sizeof(p_hex)) != 0) {
        pam_log(pamh, LOG_ERR, "pam_ntag424: no p= parameter in URL");
        free(url); return PAM_AUTH_ERR;
    }
    if (extract_param(url, "c", c_hex, sizeof(c_hex)) != 0) {
        pam_log(pamh, LOG_ERR, "pam_ntag424: no c= parameter in URL");
        free(url); return PAM_AUTH_ERR;
    }
    free(url);

    /* Decrypt p with K1 → UID + counter */
    uint8_t uid[UID_BYTES];
    uint8_t ctr[CTR_BYTES];  /* [MSB mid LSB] */

    if (decrypt_p(cfg.k1, p_hex, uid, ctr) != 0) {
        pam_log(pamh, LOG_ERR,
                "pam_ntag424: failed to decrypt p= (wrong K1 or bad tag)");
        return PAM_AUTH_ERR;
    }

    char uid_hex[UID_BYTES * 2 + 1];
    bytes_to_hex(uid, UID_BYTES, uid_hex);

    /* Reconstruct 24-bit counter value (big-endian from ctr[0..2]) */
    uint32_t counter = ((uint32_t)ctr[0] << 16) |
                       ((uint32_t)ctr[1] <<  8) |
                        (uint32_t)ctr[2];

    pam_log(pamh, LOG_INFO,
            "pam_ntag424: card UID=%s counter=%u", uid_hex, counter);

    /* Verify CMAC */
    if (!verify_cmac(cfg.k2, uid, ctr, c_hex)) {
        pam_log(pamh, LOG_WARNING,
                "pam_ntag424: CMAC verification failed for UID %s", uid_hex);
        return PAM_AUTH_ERR;
    }

    /* Replay protection: counter must be strictly greater than last seen */
    uint32_t last = read_last_counter(cfg.state_dir, uid);
    if (counter <= last) {
        pam_log(pamh, LOG_WARNING,
                "pam_ntag424: replay detected for UID %s "
                "(counter=%u last=%u)", uid_hex, counter, last);
        return PAM_AUTH_ERR;
    }

    /* Update stored counter */
    if (write_counter(pamh, cfg.state_dir, uid, counter) != 0) {
        pam_log(pamh, LOG_ERR,
                "pam_ntag424: failed to update counter state for UID %s",
                uid_hex);
        return PAM_AUTH_ERR;
    }

    pam_log(pamh, LOG_INFO,
            "pam_ntag424: authentication SUCCESS for UID %s counter=%u",
            uid_hex, counter);

    return PAM_SUCCESS;
}

PAM_EXTERN int pam_sm_setcred(pam_handle_t *pamh, int flags,
                               int argc, const char **argv)
{
    (void)pamh; (void)flags; (void)argc; (void)argv;
    return PAM_SUCCESS;
}

PAM_EXTERN int pam_sm_acct_mgmt(pam_handle_t *pamh, int flags,
                                  int argc, const char **argv)
{
    (void)pamh; (void)flags; (void)argc; (void)argv;
    return PAM_SUCCESS;
}
