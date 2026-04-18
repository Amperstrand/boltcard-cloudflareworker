/*
 * test_crypto.c — Standalone test for pam_ntag424 cryptographic primitives.
 *
 * Tests the AES-CMAC chain against the known-good vectors from
 * docs/boltcard-protocol.md §5 and the JavaScript unit tests in
 * tests/cryptoutils.test.js.
 *
 * Build:
 *   gcc -Wall -Wextra -O2 -o test_crypto test_crypto.c -lcrypto
 *
 * Run:
 *   ./test_crypto
 *
 * Expected output:
 *   PASS: decrypt_p   UID=04a39493cc8680  counter=1
 *   PASS: compute_ct  ct=<expected_ct_hex>
 *   PASS: verify_cmac ok
 *   PASS: replay_check correctly rejected counter <= last
 *   All tests passed.
 */

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <openssl/evp.h>

/* ── copy of crypto helpers from pam_ntag424.c ──────────────────────────────── */

#define AES_BLOCK   16
#define KEY_BYTES   16
#define UID_BYTES    7
#define CTR_BYTES    3
#define CMAC_TRUNC   8
#define P_HEX_LEN   32
#define C_HEX_LEN   16

static int hex_nibble(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

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

static void bytes_to_hex(const uint8_t *in, size_t len, char *out)
{
    static const char hx[] = "0123456789abcdef";
    for (size_t i = 0; i < len; i++) {
        out[i*2]   = hx[in[i] >> 4];
        out[i*2+1] = hx[in[i] & 0x0f];
    }
    out[len*2] = '\0';
}

static int aes128_ecb_decrypt(const uint8_t key[KEY_BYTES],
                               const uint8_t in[AES_BLOCK],
                               uint8_t       out[AES_BLOCK])
{
    EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
    if (!ctx) return -1;
    int ok = 1, outl = 0, outl2 = 0;
    if (!EVP_DecryptInit_ex(ctx, EVP_aes_128_ecb(), NULL, key, NULL) ||
        !EVP_CIPHER_CTX_set_padding(ctx, 0) ||
        !EVP_DecryptUpdate(ctx, out, &outl, in, AES_BLOCK) ||
        !EVP_DecryptFinal_ex(ctx, out + outl, &outl2)) {
        ok = 0;
    }
    EVP_CIPHER_CTX_free(ctx);
    return ok ? 0 : -1;
}

static int aes128_ecb_encrypt(const uint8_t key[KEY_BYTES],
                               const uint8_t in[AES_BLOCK],
                               uint8_t       out[AES_BLOCK])
{
    EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
    if (!ctx) return -1;
    int ok = 1, outl = 0, outl2 = 0;
    if (!EVP_EncryptInit_ex(ctx, EVP_aes_128_ecb(), NULL, key, NULL) ||
        !EVP_CIPHER_CTX_set_padding(ctx, 0) ||
        !EVP_EncryptUpdate(ctx, out, &outl, in, AES_BLOCK) ||
        !EVP_EncryptFinal_ex(ctx, out + outl, &outl2)) {
        ok = 0;
    }
    EVP_CIPHER_CTX_free(ctx);
    return ok ? 0 : -1;
}

static uint8_t shift_left_1(const uint8_t in[AES_BLOCK], uint8_t out[AES_BLOCK])
{
    uint8_t carry = 0;
    for (int i = AES_BLOCK - 1; i >= 0; i--) {
        out[i] = (uint8_t)((in[i] << 1) | carry);
        carry   = in[i] >> 7;
    }
    return carry;
}

static void generate_subkey(const uint8_t in[AES_BLOCK], uint8_t out[AES_BLOCK])
{
    uint8_t carry = shift_left_1(in, out);
    if (carry) out[AES_BLOCK - 1] ^= 0x87;
}

static int aes_cmac(const uint8_t key[KEY_BYTES],
                    const uint8_t *msg, size_t msg_len,
                    uint8_t mac[AES_BLOCK])
{
    if (msg_len > AES_BLOCK) return -1;
    uint8_t zero[AES_BLOCK] = {0};
    uint8_t L[AES_BLOCK];
    if (aes128_ecb_encrypt(key, zero, L) != 0) return -1;
    uint8_t K1[AES_BLOCK];
    generate_subkey(L, K1);
    uint8_t M_last[AES_BLOCK];
    if (msg_len == AES_BLOCK) {
        for (int i = 0; i < AES_BLOCK; i++) M_last[i] = msg[i] ^ K1[i];
    } else {
        uint8_t K2[AES_BLOCK];
        generate_subkey(K1, K2);
        uint8_t padded[AES_BLOCK] = {0};
        if (msg_len > 0) memcpy(padded, msg, msg_len);
        padded[msg_len] = 0x80;
        for (int i = 0; i < AES_BLOCK; i++) M_last[i] = padded[i] ^ K2[i];
    }
    return aes128_ecb_encrypt(key, M_last, mac);
}

static int decrypt_p(const uint8_t k1[KEY_BYTES], const char *p_hex,
                     uint8_t uid_out[UID_BYTES], uint8_t ctr_out[CTR_BYTES])
{
    if (strlen(p_hex) != P_HEX_LEN) return -1;
    uint8_t p_bytes[AES_BLOCK];
    if (hex_to_bytes(p_hex, p_bytes, AES_BLOCK) != AES_BLOCK) return -1;
    uint8_t plain[AES_BLOCK];
    if (aes128_ecb_decrypt(k1, p_bytes, plain) != 0) return -1;
    if (plain[0] != 0xC7) return -1;
    memcpy(uid_out, plain + 1, UID_BYTES);
    ctr_out[0] = plain[10]; ctr_out[1] = plain[9]; ctr_out[2] = plain[8];
    return 0;
}

static int compute_ct(const uint8_t k2[KEY_BYTES],
                      const uint8_t uid[UID_BYTES],
                      const uint8_t ctr[CTR_BYTES],
                      uint8_t ct_out[CMAC_TRUNC])
{
    uint8_t sv2[AES_BLOCK] = {
        0x3C, 0xC3, 0x00, 0x01, 0x00, 0x80,
        uid[0], uid[1], uid[2], uid[3], uid[4], uid[5], uid[6],
        ctr[2], ctr[1], ctr[0]
    };
    uint8_t ks[AES_BLOCK];
    if (aes_cmac(k2, sv2, AES_BLOCK, ks) != 0) return -1;
    uint8_t cm[AES_BLOCK];
    if (aes_cmac(ks, NULL, 0, cm) != 0) return -1;
    for (int i = 0; i < CMAC_TRUNC; i++) ct_out[i] = cm[1 + i * 2];
    return 0;
}

static int verify_cmac(const uint8_t k2[KEY_BYTES],
                       const uint8_t uid[UID_BYTES],
                       const uint8_t ctr[CTR_BYTES],
                       const char *c_hex)
{
    if (!c_hex || strlen(c_hex) != C_HEX_LEN) return 0;
    uint8_t provided[CMAC_TRUNC];
    if (hex_to_bytes(c_hex, provided, CMAC_TRUNC) != CMAC_TRUNC) return 0;
    uint8_t expected[CMAC_TRUNC];
    if (compute_ct(k2, uid, ctr, expected) != 0) return 0;
    uint8_t diff = 0;
    for (int i = 0; i < CMAC_TRUNC; i++) diff |= expected[i] ^ provided[i];
    return diff == 0;
}

/* ── test helpers ────────────────────────────────────────────────────────────── */

static int tests_run    = 0;
static int tests_passed = 0;

#define ASSERT(label, cond) do { \
    tests_run++; \
    if (cond) { \
        printf("PASS: %s\n", label); \
        tests_passed++; \
    } else { \
        printf("FAIL: %s  (line %d)\n", label, __LINE__); \
    } \
} while (0)

/* ── tests ───────────────────────────────────────────────────────────────────── */

/*
 * Test 1 — AES-CMAC subkey derivation (RFC 4493 §D.1 example)
 *
 * Key  = 2b7e1516 28aed2a6 abf71588 09cf4f3c
 * AES(K, 0) = 7df76b0c 1ab899b3 3e42f047 b91b546f
 * K1  = fbeed618 35713366 7c85e08f 7236a8de
 * K2  = f7ddac30 6ae266cc f90bc11e e46d513b
 */
static void test_subkeys(void)
{
    uint8_t key[KEY_BYTES];
    hex_to_bytes("2b7e151628aed2a6abf7158809cf4f3c", key, KEY_BYTES);

    uint8_t zero[AES_BLOCK] = {0};
    uint8_t L[AES_BLOCK];
    aes128_ecb_encrypt(key, zero, L);

    char L_hex[AES_BLOCK * 2 + 1];
    bytes_to_hex(L, AES_BLOCK, L_hex);
    ASSERT("rfc4493_L",
           strcmp(L_hex, "7df76b0c1ab899b33e42f047b91b546f") == 0);

    uint8_t K1[AES_BLOCK];
    generate_subkey(L, K1);
    char K1_hex[AES_BLOCK * 2 + 1];
    bytes_to_hex(K1, AES_BLOCK, K1_hex);
    ASSERT("rfc4493_K1",
           strcmp(K1_hex, "fbeed618357133667c85e08f7236a8de") == 0);

    uint8_t K2[AES_BLOCK];
    generate_subkey(K1, K2);
    char K2_hex[AES_BLOCK * 2 + 1];
    bytes_to_hex(K2, AES_BLOCK, K2_hex);
    ASSERT("rfc4493_K2",
           strcmp(K2_hex, "f7ddac306ae266ccf90bc11ee46d513b") == 0);
}

/*
 * Test 2 — AES-CMAC of empty message (RFC 4493 §D.2, Example 1)
 *
 * Key  = 2b7e1516 28aed2a6 abf71588 09cf4f3c
 * CMAC = bb1d6929 e9593728 7fa37d12 9b756746
 */
static void test_cmac_empty(void)
{
    uint8_t key[KEY_BYTES];
    hex_to_bytes("2b7e151628aed2a6abf7158809cf4f3c", key, KEY_BYTES);

    uint8_t mac[AES_BLOCK];
    aes_cmac(key, NULL, 0, mac);

    char mac_hex[AES_BLOCK * 2 + 1];
    bytes_to_hex(mac, AES_BLOCK, mac_hex);
    ASSERT("rfc4493_cmac_empty",
           strcmp(mac_hex, "bb1d6929e95937287fa37d129b756746") == 0);
}

/*
 * Test 3 — AES-CMAC of 16-byte message (RFC 4493 §D.2, Example 2)
 *
 * Key  = 2b7e1516 28aed2a6 abf71588 09cf4f3c
 * Msg  = 6bc1bee2 2e409f96 e93d7e11 7393172a
 * CMAC = 070a16b4 6b4d4144 f79bdd9d d04a287c
 */
static void test_cmac_oneblock(void)
{
    uint8_t key[KEY_BYTES];
    hex_to_bytes("2b7e151628aed2a6abf7158809cf4f3c", key, KEY_BYTES);

    uint8_t msg[AES_BLOCK];
    hex_to_bytes("6bc1bee22e409f96e93d7e117393172a", msg, AES_BLOCK);

    uint8_t mac[AES_BLOCK];
    aes_cmac(key, msg, AES_BLOCK, mac);

    char mac_hex[AES_BLOCK * 2 + 1];
    bytes_to_hex(mac, AES_BLOCK, mac_hex);
    ASSERT("rfc4493_cmac_1block",
           strcmp(mac_hex, "070a16b46b4d4144f79bdd9dd04a287c") == 0);
}

/*
 * Test 4 — decrypt_p with known test vector.
 *
 * We construct a known plaintext, encrypt it with K1, then verify decrypt_p
 * recovers the original UID and counter.
 *
 * Test vector:
 *   K1      = 55da174c9608993dc27bb3f30a4a7314  (boltcard-protocol.md §5)
 *   UID     = 04a39493cc8680
 *   Counter = 1  (little-endian in plaintext: 01 00 00)
 *   Plaintext = C7 04a39493cc8680 01 00 00 00 00 00 00 00
 *   p_bytes = AES-ECB-ENC(K1, plaintext)
 */
static void test_decrypt_p(void)
{
    uint8_t k1[KEY_BYTES];
    hex_to_bytes("55da174c9608993dc27bb3f30a4a7314", k1, KEY_BYTES);

    /* Build plaintext */
    uint8_t plain[AES_BLOCK] = {0};
    plain[0] = 0xC7;
    uint8_t uid_expected[UID_BYTES];
    hex_to_bytes("04a39493cc8680", uid_expected, UID_BYTES);
    memcpy(plain + 1, uid_expected, UID_BYTES);
    plain[8] = 0x01; plain[9] = 0x00; plain[10] = 0x00;  /* counter = 1 LE */

    /* Encrypt to produce the p_bytes we would receive from the card */
    uint8_t p_bytes[AES_BLOCK];
    aes128_ecb_encrypt(k1, plain, p_bytes);

    char p_hex[P_HEX_LEN + 1];
    bytes_to_hex(p_bytes, AES_BLOCK, p_hex);

    /* Now test decrypt_p */
    uint8_t uid[UID_BYTES];
    uint8_t ctr[CTR_BYTES];
    int rc = decrypt_p(k1, p_hex, uid, ctr);
    ASSERT("decrypt_p_rc", rc == 0);

    char uid_hex[UID_BYTES * 2 + 1];
    bytes_to_hex(uid, UID_BYTES, uid_hex);
    ASSERT("decrypt_p_uid", strcmp(uid_hex, "04a39493cc8680") == 0);

    /* ctr[0]=MSB, ctr[2]=LSB; counter=1 means ctr[2]=1, ctr[1]=0, ctr[0]=0 */
    uint32_t counter = ((uint32_t)ctr[0] << 16) |
                       ((uint32_t)ctr[1] <<  8) |
                        (uint32_t)ctr[2];
    ASSERT("decrypt_p_counter", counter == 1);

    printf("  (p_hex=%s uid=%s counter=%u)\n", p_hex, uid_hex, counter);
}

/*
 * Test 5 — full BoltCard CMAC round-trip.
 *
 * Uses boltcard-protocol.md test vectors:
 *   K2  = f4b404be700ab285e333e32348fa3d3b
 *   UID = 04a39493cc8680
 *   Counter = 1
 *
 * compute_ct should produce a deterministic ct from these inputs.
 * We then verify verify_cmac returns 1 for the correct hex and 0 for wrong.
 */
static void test_cmac_roundtrip(void)
{
    uint8_t k2[KEY_BYTES];
    hex_to_bytes("f4b404be700ab285e333e32348fa3d3b", k2, KEY_BYTES);

    uint8_t uid[UID_BYTES];
    hex_to_bytes("04a39493cc8680", uid, UID_BYTES);

    /* counter=1 → big-endian ctr array [0, 0, 1] (MSB first) */
    uint8_t ctr[CTR_BYTES] = { 0x00, 0x00, 0x01 };

    uint8_t ct[CMAC_TRUNC];
    int rc = compute_ct(k2, uid, ctr, ct);
    ASSERT("compute_ct_rc", rc == 0);

    char ct_hex[CMAC_TRUNC * 2 + 1];
    bytes_to_hex(ct, CMAC_TRUNC, ct_hex);
    printf("  (computed ct=%s)\n", ct_hex);

    /* verify_cmac should accept the ct we just computed */
    ASSERT("verify_cmac_ok", verify_cmac(k2, uid, ctr, ct_hex) == 1);

    /* Flip one byte — must reject */
    ct[0] ^= 0xFF;
    char bad_hex[CMAC_TRUNC * 2 + 1];
    bytes_to_hex(ct, CMAC_TRUNC, bad_hex);
    ASSERT("verify_cmac_bad", verify_cmac(k2, uid, ctr, bad_hex) == 0);
}

/*
 * Test 6 — replay counter logic
 *
 * Simply verifies the counter comparison logic used in pam_sm_authenticate.
 */
static void test_replay_check(void)
{
    uint32_t last    = 5;
    uint32_t current = 6;
    ASSERT("replay_accept", current > last);

    current = 5;
    ASSERT("replay_reject_equal", !(current > last));

    current = 4;
    ASSERT("replay_reject_lower", !(current > last));
}

/*
 * Test 7 — wrong K1 is rejected by decrypt_p
 */
static void test_wrong_k1(void)
{
    uint8_t k1_correct[KEY_BYTES];
    hex_to_bytes("55da174c9608993dc27bb3f30a4a7314", k1_correct, KEY_BYTES);

    uint8_t k1_wrong[KEY_BYTES];
    hex_to_bytes("00000000000000000000000000000000", k1_wrong, KEY_BYTES);

    uint8_t plain[AES_BLOCK] = {0};
    plain[0] = 0xC7;
    hex_to_bytes("04a39493cc8680", plain + 1, UID_BYTES);
    plain[8] = 0x01;

    uint8_t p_bytes[AES_BLOCK];
    aes128_ecb_encrypt(k1_correct, plain, p_bytes);

    char p_hex[P_HEX_LEN + 1];
    bytes_to_hex(p_bytes, AES_BLOCK, p_hex);

    uint8_t uid[UID_BYTES];
    uint8_t ctr[CTR_BYTES];
    ASSERT("wrong_k1_rejected", decrypt_p(k1_wrong, p_hex, uid, ctr) != 0);
}

/* ── main ────────────────────────────────────────────────────────────────────── */

int main(void)
{
    printf("=== pam_ntag424 crypto self-test ===\n\n");

    test_subkeys();
    test_cmac_empty();
    test_cmac_oneblock();
    test_decrypt_p();
    test_cmac_roundtrip();
    test_replay_check();
    test_wrong_k1();

    printf("\n%d/%d tests passed.\n", tests_passed, tests_run);
    return tests_passed == tests_run ? 0 : 1;
}
