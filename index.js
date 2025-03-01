import { extractUIDAndCounter, decodeAndValidate } from "./boltCardHelper.js";
import { handleStatus } from "./handlers/statusHandler.js";
import { handleBoltCardsRequest } from "./handlers/boltcardsHandler.js";
import { handleReset } from "./handlers/resetHandler.js";

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
          // Decode and validate CMAC from the LNURLW (using strict HMAC validation)
          const { uidHex, ctr, error } = decodeAndValidate(pHex, cHex, env);
          if (error) {
            return new Response(JSON.stringify({ status: "ERROR", reason: error }), {
              status: 400,
              headers: { "Content-Type": "application/json" }
            });
          }
          console.log("Reset Flow: Decoded UID:", uidHex, "Counter:", ctr);
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
      // First extract UID so we can determine if we're proxying.
      const extraction = extractUIDAndCounter(pHex, env);
      if (extraction.error) {
        return new Response(JSON.stringify({ status: "ERROR", reason: extraction.error }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
      const { uidHex, ctr } = extraction;

      let decodeResult;
      // For proxying (UID equals "044561fa967380"), ignore HMAC errors.
      if (uidHex === "044561fa967380") {
        decodeResult = decodeAndValidate(pHex, cHex, env, { ignoreHmac: true });
      } else {
        decodeResult = decodeAndValidate(pHex, cHex, env);
      }
      if (decodeResult.error) {
        return new Response(JSON.stringify({ status: "ERROR", reason: decodeResult.error }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      console.log("Decoded UID:", decodeResult.uidHex, "Counter:", decodeResult.ctr);

      // If UID is "044561fa967380", forward the request.
      if (decodeResult.uidHex === "044561fa967380") {
        // Construct target URL with hardcoded external_id.
        const targetBaseUrl = "https://demo.lnbits.com";
        const lnbitsExternalId = "tapko6sbthfdgzoejjztjb";
        const targetPath = `/boltcards/api/v1/scan/${lnbitsExternalId}?p=${encodeURIComponent(pHex)}&c=${encodeURIComponent(cHex)}`;
        const targetUrl = new URL(targetPath, targetBaseUrl);
        console.log(`Proxying request for UID ${decodeResult.uidHex} to ${targetUrl.toString()}`);
        const proxyRequest = new Request(targetUrl.toString(), {
          method: request.method,
          headers: request.headers,
          body: request.body,
          redirect: "manual"
        });
        const proxiedResponse = await fetch(proxyRequest);
        return proxiedResponse;
      }

      // Otherwise, return the usual withdraw response.
      const responsePayload = {
        tag: "withdrawRequest",
        uid: decodeResult.uidHex,
        counter: decodeResult.ctr,
        callback: `https://card.yourdomain.com/withdraw?uid=${decodeResult.uidHex}`,
        maxWithdrawable: 100000000,
        minWithdrawable: 1000,
        defaultDescription: `${decodeResult.uidHex}, counter ${decodeResult.ctr}, cmac: OK`
      };
      return new Response(JSON.stringify(responsePayload), { headers: { "Content-Type": "application/json" } });
    }

    return new Response("Not Found", { status: 404 });
  }
};
