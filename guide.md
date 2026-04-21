# Step 1: Program the Card

## Prerequisites

Install the **Bolt Card NFC Programmer** app:

- [Android (Google Play)](https://play.google.com/store/apps/details?id=com.lightningnfcapp)
- [iOS (App Store)](https://apps.apple.com/us/app/boltcard-nfc-programmer/id6450968873)

This app handles programming your Boltcard.

---

## What You Do

1. Open a browser and go to [https://boltcardpoc.psbt.me/experimental/activate](https://boltcardpoc.psbt.me/experimental/activate).
2. On the page, choose your card type (withdraw, POS, or 2FA) and follow the instructions.
   - You can scan the **QR code** on the page or click the **"Program Card"** link directly.
3. The link will open the **Bolt Card NFC Programmer** app automatically.
4. Follow the instructions in the app:
   - Tap your card to the phone when prompted.

> **Important:**  
> If you get **all green checks except the last one**, the card was programmed successfully.  
> The last check ("card exists on server") is informational only. Your card is fully functional and will work immediately via deterministic key generation.

---

## What Happens

When you click the link:

- The browser redirects into the **Bolt Card NFC Programmer** app.
- The app sends a **POST** request to the backend server with your card's **UID** and **card type**.

Example `cURL` request:

```bash
curl -X POST https://boltcardpoc.psbt.me/api/v1/pull-payments/default/boltcards \
  -H "Content-Type: application/json" \
  -d '{"UID": "YOUR_CARD_UID"}'
```

- The server uses your UID to **deterministically generate** all the necessary keys.
- The server responds with a JSON object containing the keys.

Example server response:

```json
{
  "k0": "11223344556677889900aabbccddeeff",
  "k1": "ffeeddccbbaa00998877665544332211",
  "k2": "aabbccddeeff00112233445566778899",
  "k3": "99887766554433221100ffeeddccbbaa",
  "k4": "00112233445566778899aabbccddeeff",
  "lnurlw_base": "https://boltcardpoc.psbt.me",
  "version": 1,
  "card_type": "withdraw"
}
```

- The app writes these keys into the Boltcard's NFC memory using NFC commands.

### Notes

- Key generation is **deterministic** based on your UID and a hardcoded master key.
- Learn more about deterministic key generation here:  
  [Deterministic Key Generation - Boltcard Docs](https://github.com/boltcard/boltcard/blob/main/docs/DETERMINISTIC.md)
- Cards work **immediately** after programming with the fakewallet payment method via deterministic key generation. No manual backend setup step is needed.

### After Programming

- **Tap your card** on any NFC-enabled phone to use it. The LNURL-withdraw flow will start automatically.
- Visit the **[debug dashboard](https://boltcardpoc.psbt.me/debug)** to view your card's state, tap history, and configuration.
- Cards provisioned with the `POS` card type work with the [POS payment page](https://boltcardpoc.psbt.me/pos).
