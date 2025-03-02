import worker from "../index.js"; // Import the Cloudflare Worker

// Simulate environment variables from `wrangler.toml`
const env = {
  BOLT_CARD_K1: "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d",
  K2_04996C6A926980: "B45775776CB224C75BCDE7CA3704E933",
  K2_044561FA967380: "33268DEA5B5511A1B3DF961198FA46D5",
  CLN_PROTOCOL: "https",
  CLN_IP: "192.0.2.10",
  CLN_PORT: "8080",
  CLN_RUNE: "your-rune-string",
};

// Helper function to send requests to the Worker
async function makeRequest(path, method = "GET", body = null) {
  const url = "https://test.local" + path; // Use a mock domain
  const options = { method };
  if (body) {
    options.body = JSON.stringify(body);
    options.headers = { "Content-Type": "application/json" };
  }
  return worker.fetch(new Request(url, options), env); // Pass the environment
}

describe("Cloudflare Worker Tests", () => {
  test("should return LNURLW withdraw request", async () => {
    const response = await makeRequest(
      "/?p=4E2E289D945A66BB13377A728884E867&c=E19CCB1FED8892CE"
    );

    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json).toMatchObject({
      tag: "withdrawRequest",
      callback: expect.stringContaining("/api/v1/lnurl/cb/4E2E289D945A66BB13377A728884E867"),
      k1: "E19CCB1FED8892CE",
      minWithdrawable: 1000,
      maxWithdrawable: 1000,
      defaultDescription: expect.stringContaining("Boltcard payment from UID"),
      payLink: expect.stringContaining("lnurlp://boltcardpoc.psbt.me"),
    });
  });

  test("should return valid withdraw request for different UID", async () => {
    const response = await makeRequest(
      "/?p=00F48C4F8E386DED06BCDC78FA92E2FE&c=66B4826EA4C155B4"
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    
    expect(json).toMatchObject({
      tag: "withdrawRequest",
      callback: expect.stringContaining("/api/v1/lnurl/cb/00F48C4F8E386DED06BCDC78FA92E2FE"),
      k1: "66B4826EA4C155B4",
      minWithdrawable: 1000,
      maxWithdrawable: 1000,
      defaultDescription: expect.stringContaining("Boltcard payment from UID"),
      payLink: expect.stringContaining("lnurlp://boltcardpoc.psbt.me"),
    });
  });

  test("should return valid LNURL callback response", async () => {
    const response = await makeRequest(
      "/boltcards/api/v1/lnurl/cb",
      "POST",
      {
        invoice: "lnbc1000n1p...your_bolt11_invoice...",
        amount: 1000,
        k1: "p=3736A84681238418D4B9B7210C13DC39&q=1549E9D901188F77"
      }
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    
    expect(json).toMatchObject({
      status: "OK"
    });
  });

  // New test case for curl command simulation
  test("should handle LNURL callback via curl command", async () => {
    const curlOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        invoice: "lnbc1000n1p...your_bolt11_invoice...",
        amount: 1000,
        k1: "1549E9D901188F77"
      })
    };

    const curlResponse = await fetch('https://boltcardpoc.psbt.me/boltcards/api/v1/lnurl/cb/3736A84681238418D4B9B7210C13DC39', curlOptions);
    const curlJson = await curlResponse.json();

    expect(curlResponse.status).toBe(200);
    expect(curlJson).toMatchObject({
      status: "OK"
    });
  });

  // New test case for Pull Payment with UpdateVersion
  test("should handle pull payment with UpdateVersion", async () => {
    const response = await makeRequest(
      "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=UpdateVersion",
      "POST",
      {
        UID: "044561FA967380"
      }
    );

    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json).toMatchObject({
      protocol_name: "new_bolt_card_response",
      protocol_version: 1,
      card_name: "UID 044561FA967380",
      LNURLW: expect.stringContaining("lnurlw://boltcardpoc.psbt.me/ln"),
      K0: "157163032ef8a8f89c5fc3c271675a3c",
      K1: "55da174c9608993dc27bb3f30a4a7314",
      K2: "33268dea5b5511a1b3df961198fa46d5",
      K3: "f78200e8918fceea9db3574ae35b67e7",
      K4: "62f41e0dcff67e74db596ae0fe1c0a3f"
    });
  });

  // New test case for Pull Payment with KeepVersion
  test("should handle pull payment with KeepVersion", async () => {
    const response = await makeRequest(
      "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=KeepVersion",
      "POST",
      {
        LNURLW: "lnurlw://boltcardpoc.psbt.me/ln?p=C115F9FA83DCD2FEC0864A3B2DDD0AEF&c=BAA4A9496DEC311D"
      }
    );

    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json).toMatchObject({
      protocol_name: "new_bolt_card_response",
      protocol_version: 1,
      card_name: "UID 044561FA967380",
      LNURLW: expect.stringContaining("lnurlw://boltcardpoc.psbt.me/ln"),
      K0: "157163032ef8a8f89c5fc3c271675a3c",
      K1: "55da174c9608993dc27bb3f30a4a7314",
      K2: "33268dea5b5511a1b3df961198fa46d5",
      K3: "f78200e8918fceea9db3574ae35b67e7",
      K4: "62f41e0dcff67e74db596ae0fe1c0a3f"
    });
  });
});
