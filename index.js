import { decodeAndValidate } from "./boltCardHelper.js";
import { handleStatus } from "./handlers/statusHandler.js";
import { handleBoltCardsRequest } from "./handlers/boltcardsHandler.js";
import { handleReset } from "./handlers/resetHandler.js";
import { handleLnurlpPayment } from "./handlers/lnurlpHandler.js";
import { handleProxy } from "./handlers/proxyHandler.js";

export default {
  async fetch(request, env) {
    console.log("Request:", request.method, request.url);
    const url = new URL(request.url);
    const pathname = url.pathname;
    const params = url.searchParams;

    // 1. Status page
    if (pathname === "/status") {
      return handleStatus();
    }

    // 2. Deep-link endpoint for boltcards
    if (pathname === "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards") {
      const onExisting = params.get("onExisting");
      if (onExisting === "UpdateVersion") {
        return handleBoltCardsRequest(request, env);
      }
      if (onExisting === "KeepVersion") {
        try {
          // Reset requests: extract p and c from LNURLW in POST body.
          const body = await request.json();
          const lnurlw = body.LNURLW;
          if (!lnurlw) {
            return new Response(
              JSON.stringify({ status: "ERROR", reason: "Missing LNURLW parameter." }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }
          let lnurl;
          try {
            lnurl = new URL(lnurlw);
          } catch (e) {
            return new Response(
              JSON.stringify({ status: "ERROR", reason: "Invalid LNURLW format." }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }
          const pHex = lnurl.searchParams.get("p");
          const cHex = lnurl.searchParams.get("c");
          if (!pHex || !cHex) {
            return new Response(
              JSON.stringify({ status: "ERROR", reason: "Invalid LNURLW format: missing p or c." }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }
          // Decode and validate CMAC from the LNURLW
          const { uidHex, ctr, error } = decodeAndValidate(pHex, cHex, env);
          if (error) {
            return new Response(JSON.stringify({ status: "ERROR", reason: error }), {
              status: 400,
              headers: { "Content-Type": "application/json" }
            });
          }
          console.log("Reset Flow: Decoded UID:", uidHex, "Counter:", parseInt(ctr, 16));
          return handleReset(uidHex, env);
        } catch (err) {
          return new Response(JSON.stringify({ status: "ERROR", reason: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }
      }
    }

    // 3. GET requests with p (and c) for LNURLW verification
    const pHex = params.get("p");
    const cHex = params.get("c");
    if (pHex) {
      const { uidHex, ctr, error } = decodeAndValidate(pHex, cHex, env);
      if (error) {
        return new Response(JSON.stringify({ status: "ERROR", reason: error }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
      console.log("Decoded UID:", uidHex, "Counter:", parseInt(ctr, 16));

      // If UID is "044561fa967380", forward the request using the proxy handler.
      if (uidHex === "044561fa967380") {
        return await handleProxy(request, uidHex, pHex, cHex);
      }
      const responsePayload = {
        tag: "withdrawRequest",
        uid: uidHex,
        counter: parseInt(ctr, 16),
        callback: `https://card.yourdomain.com/withdraw?uid=${uidHex}`,
        maxWithdrawable: 100000000,
        minWithdrawable: 1000,
        defaultDescription: `${uidHex}, counter ${parseInt(ctr, 16)}, cmac: OK`
      };
      return new Response(JSON.stringify(responsePayload), { headers: { "Content-Type": "application/json" } });
    }

    // 4. Generalized LNURLp POST request handling
    // Supports two methods:
    //   a) POST to /boltcards/api/v1/lnurlp with k1 formatted as "p=x&q=y"
    //   b) POST to /boltcards/api/v1/lnurlp/<p> with k1 as the q value
    const lnurlpBase = "/boltcards/api/v1/lnurlp";
    if (pathname.startsWith(lnurlpBase) && request.method === "POST") {
      return handleLnurlpPayment(request, env);
    }

    return new Response("Not Found", { status: 404 });
  }
};
