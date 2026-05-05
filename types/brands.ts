/**
 * Branded types for domain-specific string/number values.
 * Prevents accidental mixing of semantically different values (e.g., UID where AES key expected) at compile time.
 * Pattern: type Brand<T, B> = T & { readonly __brand: B }
 */

type Brand<T, B extends string> = T & { readonly __brand: B };

/** 7-byte NFC card UID as lowercase hex string (14 chars). */
export type UidHex = Brand<string, "UidHex">;

/** AES-128 key as hex string (32 chars). Used for K0-K4 card keys. */
export type AesKey = Brand<string, "AesKey">;

/** AES-CMAC authentication tag as hex string (16 chars, from NTAG424 SDM). */
export type CmacHex = Brand<string, "CmacHex">;

/** Encrypted PICC data from NTAG424 SDM (variable-length hex string). */
export type EncryptedPicc = Brand<string, "EncryptedPicc">;

/** Rolling counter value from NTAG424 SDM, parsed from hex. */
export type CounterValue = Brand<number, "CounterValue">;

/** BOLT11 lightning invoice string (lnbc...). */
export type Bolt11Invoice = Brand<string, "Bolt11Invoice">;

/** SHA-256 payment hash as hex string (64 chars). */
export type PaymentHash = Brand<string, "PaymentHash">;

/** Millisatoshis — smallest Lightning unit. */
export type MilliSatoshi = Brand<number, "MilliSatoshi">;

/** Amount in minor currency units (cents, pence, or whole tokens). */
export type MinorAmount = Brand<number, "MinorAmount">;

/** Master issuer key as hex string (32 chars) used for deterministic key derivation. */
export type IssuerKeyHex = Brand<string, "IssuerKeyHex">;
