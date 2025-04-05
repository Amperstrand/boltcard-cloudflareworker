# Step 1: Program the Card

## Prerequisites

Install the **Bolt Card NFC Programmer** app:

- [Android (Google Play)](https://play.google.com/store/apps/details?id=com.lightningnfcapp)
- [iOS (App Store)](https://apps.apple.com/us/app/boltcard-nfc-programmer/id6450968873)

This app handles programming your Boltcard.

---

## What You Do

1. Open a browser and go to [https://boltcardpoc.psbt.me/status](https://boltcardpoc.psbt.me/status).
2. On the page, you will see links and QR codes:
   - **Ignore the QR codes** (they are currently broken).
   - **Click the "Program Card" link** instead.
3. The link will open the **Bolt Card NFC Programmer** app automatically.
4. Follow the instructions in the app:
   - Tap your card to the phone when prompted.

> **Important:**  
> If you get **all green checks except the last one**, the card was programmed successfully.  
>
> ⚠️ **Why is the last check not green?**  
> The backend currently does not automatically add newly programmed cards.  
> (This is on the TODO list.)  
> Because of this, the "card exists" check fails, even though the card was written correctly.

---

## What Happens

When you click the link:

- The browser redirects into the **Bolt Card NFC Programmer app**.
- The app sends a **POST** request to the backend server with your card’s **UID**.

Example `cURL` request:

```bash
curl -X POST https://boltcardpoc.psbt.me/program \
  -H "Content-Type: application/json" \
  -d '{"uid": "YOUR_CARD_UID"}'
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
  "lnurlw_base": "https://your-lnurl-server.com/lnurlw"
}
```

- The app writes these keys into the Boltcard’s NFC memory using NFC commands.

### Notes

- Key generation is **deterministic** based on your UID and a hardcoded master key.
- Learn more about deterministic key generation here:  
  [Deterministic Key Generation – Boltcard Docs](https://github.com/boltcard/boltcard/blob/main/docs/DETERMINISTIC.md)

After programming, your card is ready to interact with Lightning wallets and services.


