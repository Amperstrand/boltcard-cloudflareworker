import { decodeAndValidate } from "./boltCardHelper.js";
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

      // If UID is "044561fa967380", forward the request.
      if (uidHex === "044561fa967380") {
        // Construct target URL with hardcoded external_id.
        const targetBaseUrl = "https://demo.lnbits.com";
        const lnbitsExternalId = "tapko6sbthfdgzoejjztjb";
        const targetPath = `/boltcards/api/v1/scan/${lnbitsExternalId}?p=${encodeURIComponent(pHex)}&c=${encodeURIComponent(cHex)}`;
        const targetUrl = new URL(targetPath, targetBaseUrl);
        console.log(`Proxying request for UID ${uidHex} to ${targetUrl.toString()}`);
        console.log("Proxy Request Details:");
        console.log("Method:", request.method);
        console.log("Headers:", JSON.stringify(Object.fromEntries(request.headers.entries()), null, 2));
        let requestBody = null;
        if (request.body) {
          requestBody = await request.text();
          console.log("Body:", requestBody);
        } else {
          console.log("Body: No body in request");
        }
        const proxyRequest = new Request(targetUrl.toString(), {
          method: request.method,
          headers: request.headers,
          body: requestBody ? requestBody : null,
          redirect: "manual"
        });
        const proxiedResponse = await fetch(proxyRequest);
        return proxiedResponse;
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
    // Supports two ways:
    //   a) POST to /boltcards/api/v1/lnurlp with JSON body k1 formatted as "p=x&q=y"
    //   b) POST to /boltcards/api/v1/lnurlp/<p> with JSON body k1 containing just the q value
    const lnurlpBase = "/boltcards/api/v1/lnurlp";
    if (pathname.startsWith(lnurlpBase) && request.method === "POST") {
      try {
        const json = await request.json();
        console.log("Received LNURLp POST request:", JSON.stringify(json, null, 2));
        let p, q;
        // Check if a p value is provided in the URL path (method b)
        const extra = pathname.slice(lnurlpBase.length).split("/").filter(Boolean);
        if (extra.length >= 1) {
          p = extra[0];
          if (!json.k1) {
            return new Response(JSON.stringify({ status: "ERROR", reason: "Missing k1 parameter for q value" }), { 
              status: 400, headers: { "Content-Type": "application/json" } 
            });
          }
          q = json.k1;
        } else {
          // Method a) where k1 is formatted as "p=x&q=y"
          if (!json.k1) {
            return new Response(JSON.stringify({ status: "ERROR", reason: "Missing k1 parameter" }), { 
              status: 400, headers: { "Content-Type": "application/json" } 
            });
          }
          const k1Params = new URLSearchParams(json.k1);
          p = k1Params.get("p");
          q = k1Params.get("q");
          if (!p || !q) {
            return new Response(JSON.stringify({ status: "ERROR", reason: "Invalid k1 format, missing p or q" }), { 
              status: 400, headers: { "Content-Type": "application/json" } 
            });
          }
        }
        console.log(`Using p: ${p} and q: ${q}`);
        const { uidHex, ctr, error } = decodeAndValidate(p, q, env);
        if (error) {
          return new Response(JSON.stringify({ status: "ERROR", reason: error }), { 
            status: 400, headers: { "Content-Type": "application/json" } 
          });
        }
        console.log(`Decoded LNURLp values: UID=${uidHex}, Counter=${parseInt(ctr, 16)}`);
        return new Response(JSON.stringify({ status: "OK", uid: uidHex, counter: parseInt(ctr, 16) }), { 
          status: 200, headers: { "Content-Type": "application/json" } 
        });
      } catch (err) {
        console.error("Error processing LNURLp POST request:", err.message);
        return new Response(JSON.stringify({ status: "ERROR", reason: err.message }), { 
          status: 500, headers: { "Content-Type": "application/json" } 
        });
      }
    }

    return new Response("Not Found", { status: 404 });
  }
};
