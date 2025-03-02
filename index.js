import { decodeAndValidate } from "./boltCardHelper.js";
import { handleStatus } from "./handlers/statusHandler.js";
import { handleBoltCardsRequest } from "./handlers/boltcardsHandler.js";
import { handleReset } from "./handlers/resetHandler.js";
import { handleLnurlpPayment } from "./handlers/lnurlHandler.js";
import { handleProxy } from "./handlers/proxyHandler.js";
import { uidConfig } from "./uidConfig.js";

// Helper function to return JSON responses
const jsonResponse = (data, status = 200) => 
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// Helper function for error responses
const errorResponse = (reason, status = 400) => 
  jsonResponse({ status: "ERROR", reason }, status);

export default {
  async fetch(request, env) {
    console.log("\n--- Incoming Request ---");
    console.log("Method:", request.method);
    console.log("URL:", request.url);

    const url = new URL(request.url);
    const { pathname, searchParams } = url;

    console.log("Path:", pathname);
    console.log("Query Params:", Object.fromEntries(searchParams));
    console.log("Environment Variables Loaded:", Object.keys(env));

    // Handle Status Page
    if (pathname === "/status") return handleStatus();

    // Handle BoltCard Requests
    if (pathname === "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards") {
      const onExisting = searchParams.get("onExisting");
      console.log("BoltCards Request - onExisting:", onExisting);

      if (onExisting === "UpdateVersion") {
        return handleBoltCardsRequest(request, env);
      }

      if (onExisting === "KeepVersion") {
        try {
          const body = await request.json();
          console.log("Request Body:", body);

          const lnurlw = body.LNURLW;
          if (!lnurlw) return errorResponse("Missing LNURLW parameter.");

          let lnurl;
          try {
            lnurl = new URL(lnurlw);
          } catch {
            return errorResponse("Invalid LNURLW format.");
          }

          const pHex = lnurl.searchParams.get("p");
          const cHex = lnurl.searchParams.get("c");
          if (!pHex || !cHex) return errorResponse("Invalid LNURLW format: missing p or c.");

          console.log("Decoding LNURLW: pHex:", pHex, "cHex:", cHex);
          const { uidHex, ctr, error } = decodeAndValidate(pHex, cHex, env);
          if (error) return errorResponse(error);

          console.log("Reset Flow: Decoded UID:", uidHex, "Counter:", parseInt(ctr, 16));
          return handleReset(uidHex, env);
        } catch (err) {
          console.error("Error in KeepVersion Flow:", err);
          return errorResponse(err.message, 500);
        }
      }
    }

    // Handle LNURLW Verification
    const pHex = searchParams.get("p");
    const cHex = searchParams.get("c");

    if (pHex && cHex) {
      console.log("LNURLW Verification: pHex:", pHex, "cHex:", cHex);
      
      const { uidHex, ctr, error } = decodeAndValidate(pHex, cHex, env);
      if (error) return errorResponse(error);

      console.log("Decoded UID:", uidHex, "Counter:", parseInt(ctr, 16));

      // Check if UID should be proxied
      if (uidConfig[uidHex]) {
        const config = uidConfig[uidHex];
        console.log("Proxying request for UID:", uidHex, "to domain:", config.proxyDomain);
        return handleProxy(request, uidHex, pHex, cHex, config.externalId);
      }

      // Construct standard LNURL withdraw response
      const responsePayload = {
        tag: "withdrawRequest",
        callback: `https://boltcardpoc.psbt.me/boltcards/api/v1/lnurl/cb/${pHex}`,
        k1: cHex,
        minWithdrawable: 1000,
        maxWithdrawable: 1000,
        defaultDescription: `Boltcard payment from UID ${uidHex}, counter ${parseInt(ctr, 16)}`,
        payLink: `lnurlp://boltcardpoc.psbt.me/boltcards/api/v1/lnurlp_not_implemented_yet/${uidHex}/${pHex}/${cHex}`,
      };

      console.log("Response Payload:", responsePayload);
      return jsonResponse(responsePayload);
    }

    // Handle LNURLp Payment Processing
    if (pathname.startsWith("/boltcards/api/v1/lnurl/cb") && request.method === "POST") {
      return handleLnurlpPayment(request, env);
    }

    console.error("Error: Route not found.");
    return new Response("Not Found", { status: 404 });
  },
};
