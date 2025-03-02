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

  test("should return valid withdraw request for another UID", async () => {
    const response = await makeRequest(
      "/?p=0DBF3C59B59B0638D60B5842A997D4D1&c=CC61660C020B4D96"
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    
    expect(json).toMatchObject({
      tag: "withdrawRequest",
      callback: expect.stringContaining("/api/v1/lnurl/cb/0DBF3C59B59B0638D60B5842A997D4D1"),
      k1: "CC61660C020B4D96",
      minWithdrawable: 1000,
      maxWithdrawable: 1000,
      defaultDescription: expect.stringContaining("Boltcard payment from UID"),
      payLink: expect.stringContaining("lnurlp://boltcardpoc.psbt.me"),
    });
  });

  test("should handle pull-payment update request and validate keys", async () => {
    const response = await makeRequest(
      "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=UpdateVersion",
      "POST",
      { UID: "04a39493cc8680" }
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    
    expect(json).toMatchObject({
      protocol_name: "new_bolt_card_response",
      protocol_version: 1,
      card_name: "UID 04A39493CC8680",
      LNURLW: "lnurlw://boltcardpoc.psbt.me/ln",
      K0: "a29119fcb48e737d1591d3489557e49b",
      K1: "55da174c9608993dc27bb3f30a4a7314",
      K2: "f4b404be700ab285e333e32348fa3d3b",
      K3: "73610ba4afe45b55319691cb9489142f",
      K4: "addd03e52964369be7f2967736b7bdb5",
    });
  });
});
