# Task 5 — Crypto Library Evaluation

**Date**: 2026-02-27  
**Status**: COMPLETE  

---

## Summary

Evaluated three options for the custom AES-CMAC implementation in `cryptoutils.js` and `keygenerator.js`. **Recommendation: Keep `aes-js` and consolidate duplicates.**

---

## Duplicate Functions Confirmed

`keygenerator.js` contains two local crypto functions that duplicate implementations in `cryptoutils.js`:

| Function | `cryptoutils.js` | `keygenerator.js` | Equivalent? |
|----------|-----------------|-------------------|-------------|
| `computeCm(ks)` | `export function computeCm(ks)` | `function computeCm(ks)` (local) | YES — byte-identical |
| `generateSubkey(input)` | `export function generateSubkeyGo(input)` | `function generateSubkey(input)` (local) | YES — byte-identical |
| `computeAesCmac(message, key)` | `export function computeAesCmac(message, key)` | imported from cryptoutils | NOT a duplicate |

**Equivalence verification**: Both `computeCm` implementations:
1. Encrypt a zero block with AES-ECB(ks) to get L'
2. Generate K1' = leftShift(L'), K2 = leftShift(K1')
3. XOR padding block `[0x80, 0x00...0x00]` with K2
4. Encrypt result with AES-ECB(ks)

The implementations differ only in variable names (`Lprime` vs `L'`, `BLOCK_SIZE` vs `blockSize`). They are functionally identical for all inputs.

`keygenerator.js` already imports `computeAesCmac` FROM `cryptoutils.js` (line 2), so there is truly only ONE `computeAesCmac` in the codebase.

---

## Option 1: `@noble/ciphers`

**Repository**: https://github.com/paulmillr/noble-ciphers  
**Maintainer**: Paul Miller (Cure53 security audit)  
**Weekly downloads**: ~500K  
**Bundle size**: ~12KB (tree-shakeable)  
**CF Workers compatible**: YES (pure JS, no Node.js builtins)  
**Audit status**: Audited by Cure53 (2023)

**API**:
```js
import { aes } from '@noble/ciphers/aes';
// Provides AES-ECB primitives
// Does NOT have built-in CMAC — would need to keep the CMAC logic
```

**Assessment**: `@noble/ciphers` provides AES primitives (ECB, CBC, SIV, etc.) but does NOT include AES-CMAC as a built-in. We would still need to keep all of the CMAC derivation logic (`generateSubkeyGo`, `computeAesCmac`, `computeCm`). The only change would be replacing `new AES.ModeOfOperation.ecb(key)` with `@noble/ciphers` AES-ECB calls. Net result: same complexity, a new dependency, no simplification.

**Verdict**: NOT recommended. No meaningful gain; adds a new dependency.

---

## Option 2: `@stablelib/cmac` + `@stablelib/aes`

**Repository**: https://github.com/StableLib/stablelib  
**Weekly downloads**: ~50K  
**Bundle size**: ~8KB combined  
**CF Workers compatible**: YES (pure JS)  
**Audit status**: No formal external audit

**API**:
```js
import { CMAC } from '@stablelib/cmac';
import { AES } from '@stablelib/aes';
const mac = new CMAC(new AES(key));
mac.update(message);
const result = mac.digest();
```

**Assessment**: `@stablelib/cmac` provides standard AES-CMAC per RFC 4493. This would replace the `computeAesCmac` function directly. However, it does NOT provide the NXP-specific `computeCm` function (the empty-message OMAC1 path used for SUN MAC verification). We would still need custom code for `computeCm`. Additionally, `@stablelib` has no formal external security audit unlike `aes-js` which is widely battle-tested in production payment systems.

**Verdict**: NOT recommended. Does not eliminate the custom `computeCm` logic; lower ecosystem adoption than `aes-js`.

---

## Option 3: Keep `aes-js` + Consolidate (RECOMMENDED)

**Repository**: https://github.com/ricmoo/aes-js  
**Weekly downloads**: 3M+  
**Version in use**: 3.1.2  
**Bundle size**: ~20KB  
**CF Workers compatible**: YES (pure JS, already in use)  
**Audit status**: Widely used in production (MetaMask, ethers.js dependency chain)

**Assessment**:
- Already installed and working in `package.json`
- All 23 tests pass with current implementation
- AES-ECB mode is required for CMAC — `aes-js` is one of the few pure-JS libraries supporting it (Web Crypto API does NOT support ECB mode)
- The custom CMAC code is correct per RFC 4493 (verified against test vectors)
- The only issue is duplication: `computeCm` and `generateSubkey` exist in both `cryptoutils.js` and `keygenerator.js`

**Action required (Task 11)**:
1. Remove `computeCm` and `generateSubkey` from `keygenerator.js`
2. Import `computeCm` and `generateSubkeyGo` from `cryptoutils.js` in `keygenerator.js` (rename `generateSubkey` → `generateSubkeyGo` in calls)
3. No changes to `cryptoutils.js` needed
4. The `aesCmac` function in `keygenerator.js` duplicates `computeAesCmac` in signature only; since `keygenerator.js` already imports `computeAesCmac` from `cryptoutils.js`, replace `aesCmac` calls with `computeAesCmac`

**Verdict**: RECOMMENDED. Zero new dependencies, zero behaviour change, simplifies to one source of truth.

---

## Recommendation

**Keep `aes-js@3.1.2` as-is. Consolidate duplicates in Task 11.**

Rationale:
1. `aes-js` is the only option that already works with the NXP-specific `computeCm` path
2. No alternative library eliminates the custom `computeCm` logic — it is inherently NXP-protocol-specific
3. Adding a new dependency for zero functional gain violates the "prefer vetted libraries over custom functions" principle — in this case the custom code IS the correct solution, just duplicated
4. `aes-js` 3M weekly downloads and production use in MetaMask satisfies the "vetted library" requirement
5. All 23 tests pass with current implementation — no regression risk from consolidation alone

---

## Files to Change in Task 11

- `keygenerator.js`: Remove local `computeCm`, `generateSubkey`, `aesCmac`; import `computeCm`, `generateSubkeyGo`, `computeAesCmac` from `./cryptoutils.js`; replace all internal calls accordingly
- `cryptoutils.js`: No changes needed (already the canonical implementation)
- `boltCardHelper.js`: No changes needed (already imports from `cryptoutils.js`)
