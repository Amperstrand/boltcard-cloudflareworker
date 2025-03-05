# Boltcard POC Cloudflare Worker

This project implements a Cloudflare Worker for handling LNURL/boltcard payment requests. It supports two methods for managing UID configurations:

1. **Static Configuration (`uidConfig.js`)**  
   A JavaScript file that exports a UID configuration object. This is useful for development or smaller deployments.

2. **Dynamic Configuration via Cloudflare KV**  
   Each UID is stored as an individual key in a Cloudflare KV namespace. This method scales well, allowing on-demand lookups without having to load an entire JSON configuration.

The worker code first attempts to fetch the UID configuration from KV. If no entry is found (or if the KV binding is not set up), it falls back to the static configuration from `uidConfig.js`.

---

## How It Works

1. **Request Routing**  
   The worker routes incoming requests based on URL paths (e.g., `/nfc`, `/status`, `/api/v1/pull-payments/...`, `/boltcards/api/v1/lnurl/cb`, etc.).

2. **UID Lookup**  
   - The worker extracts the UID from the LNURL parameters.
   - It then checks for a KV entry with the key format: `uid:<UID>`.
   - If a KV entry exists, it parses and uses it; otherwise, it falls back to using the static configuration.

3. **Payment Method Handling**  
   Depending on the UID configuration’s `payment_method` (e.g., `clnrest`, `proxy`, or `fakewallet`), the worker processes the request accordingly by performing CMAC validation, proxying the request, or handling a fake wallet.

---

## Deployment Instructions

### 1. Setup Your Cloudflare Worker Project

- **Install Wrangler:**  
  Follow the [Cloudflare Workers Quick Start Guide](https://developers.cloudflare.com/workers/get-started/guide/) to install Wrangler.

- **Initialize the Project:**  
  ```sh
  wrangler generate boltcard-poc
  cd boltcard-poc
  ```

### 2. Create a KV Namespace

You need to create a KV namespace for storing UID entries.

#### **Via the Cloudflare Dashboard:**

1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Navigate to **Workers & Pages** > **KV**.
3. Click **Create Namespace**.
4. Name it (for example, `boltcard-poc-kv`) and note the generated Namespace ID.

#### **Via Wrangler CLI:**

1. **List existing KV namespaces:**
   ```sh
   wrangler kv:namespace list
   wrangler kv:namespace list | jq -r '.[] | select(.title == "boltcard-poc-boltcard-poc-kv") | .id'

   ```

2. **Create a new KV namespace:**
   ```sh
   wrangler kv:namespace create "boltcard-poc-kv"
   ```
   Take note of the generated namespace ID.


### 3. Configure `wrangler.toml`

Edit your `wrangler.toml` file to bind the KV namespace and set your worker name:
```toml
name = "boltcard-poc"
type = "javascript"

kv_namespaces = [
  { binding = "UID_CONFIG", id = "boltcard-poc-kv" }
]
```
Replace `boltcard-poc-kv` with your actual KV namespace ID if it differs.

### 4. Deploy the Worker

Not really used any more

```sh
export DEBUG=false
```
Then deploy your worker:
```sh

npm test

wrangler deploy
```

---

## DNS Setup (Manual)

To route traffic from your custom domain, manually add a DNS record in the Cloudflare Dashboard:

1. **Select Your Domain:**  
   Log in to the Cloudflare Dashboard and select your domain (e.g., `psbt.me`).

2. **DNS Settings:**  
   Navigate to **DNS**.

3. **Add Record:**  
   - **Type:** CNAME  
   - **Name:** `boltcardpoc`  
   - **Target:** `workers.dev`  
   - **TTL:** Auto  
   - **Proxy Status:** Proxied (Orange Cloud)  
   
4. Click **Save**.

Now, requests to `https://boltcardpoc.psbt.me` will be routed to your worker.

---


## Test Vectors ([Source](https://github.com/boltcard/boltcard/blob/main/docs/TEST_VECTORS.md))

```sh
curl 'https://boltcardpoc.psbt.me/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE'
curl 'https://boltcardpoc.psbt.me/?p=00F48C4F8E386DED06BCDC78FA92E2FE&c=66B4826EA4C155B4'
curl 'https://boltcardpoc.psbt.me/?p=0DBF3C59B59B0638D60B5842A997D4D1&c=CC61660C020B4D96'
curl 'https://boltcardpoc.psbt.me/?p=3736A84681238418D4B9B7210C13DC39&c=1549E9D901188F77'
```

```sh
curl -X POST "https://boltcardpoc.psbt.me/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=UpdateVersion"      -H "Content-Type: application/json"      -d '{"UID": "04a39493cc8680"}'

curl -X POST "https://boltcardpoc.psbt.me/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=UpdateVersion"      -H "Content-Type: application/json"      -d '{"UID": "044561fa967380"}'
```

```sh
curl -X POST https://boltcardpoc.psbt.me/boltcards/api/v1/lnurl/cb/fABRzT2jv9Mt82exoStuxQ      -H "Content-Type: application/json"      -d '{
          "invoice": "lnbc1000n1p...your_bolt11_invoice...",
          "amount": 1000,
          "k1": "fABRzT2jv9Mt82exoStuxQ"
        }'
```

---

## Managing UID Entries in Cloudflare KV

### **Using the Cloudflare Dashboard**

1. **Add a UID Entry:**
   - Navigate to the **Workers KV** section in your Cloudflare dashboard.
   - Select your namespace (`boltcard-poc-kv`).
   - Click **Add Key**.
   - Use a key name like `uid:<UID>` (e.g., `uid:044561fa967380`).
   - Set the value to the JSON configuration.
   - Click **Save**.

2. **Remove a UID Entry:**
   - Locate the key in the list.
   - Click the delete icon and confirm removal.

### **Using the API (via cURL or Wrangler)**

1. **Add a UID Entry via API:**
   ```sh
   curl -X PUT "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/storage/kv/namespaces/boltcard-poc-kv/values/uid:044561fa967380"    -H "Authorization: Bearer YOUR_API_TOKEN"    -H "Content-Type: application/json"    --data '{"K2": "33268DEA5B5511A1B3DF961198FA46D5", "payment_method": "clnrest"}'
   ```

2. **Remove a UID Entry via API:**
   ```sh
   curl -X DELETE "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/storage/kv/namespaces/boltcard-poc-kv/values/uid:044561fa967380"    -H "Authorization: Bearer YOUR_API_TOKEN"
   ```

---

