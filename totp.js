export async function generateTOTP(secret, epoch = 59000) {
    const step = 30; // TOTP standard step time in seconds
    const T0 = 0; // Unix epoch
    const timeCounter = Math.floor((epoch - T0) / step); // Counter for TOTP

    // Convert secret from ASCII to Uint8Array
    const keyData = new TextEncoder().encode(secret);

    // Convert counter to 8-byte big-endian buffer
    const counterBuffer = new ArrayBuffer(8);
    const counterView = new DataView(counterBuffer);
    counterView.setUint32(4, timeCounter, false);

    // Import key for HMAC operation
    const key = await crypto.subtle.importKey(
        "raw", keyData, { name: "HMAC", hash: { name: "SHA-1" } }, false, ["sign"]
    );

    // Generate HMAC digest
    const hmacBuffer = await crypto.subtle.sign("HMAC", key, counterBuffer);
    const hmac = new Uint8Array(hmacBuffer);

    // Dynamic Truncation: extract a 6-digit OTP
    const offset = hmac[hmac.length - 1] & 0xf;
    const binaryCode = ((hmac[offset] & 0x7f) << 24) |
                       ((hmac[offset + 1] & 0xff) << 16) |
                       ((hmac[offset + 2] & 0xff) << 8) |
                       (hmac[offset + 3] & 0xff);
    
    // Extract 6-digit TOTP code
    const totpCode = (binaryCode % 1000000).toString().padStart(6, '0');

    return totpCode;
}
