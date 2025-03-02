import { decodeAndValidate } from "./boltCardHelper.js";
import { handleStatus } from "./handlers/statusHandler.js";
import { handleBoltCardsRequest } from "./handlers/boltcardsHandler.js";
import { handleReset } from "./handlers/resetHandler.js";
import { handleLnurlpPayment } from "./handlers/lnurlHandler.js";
import { handleProxy } from "./handlers/proxyHandler.js";
import { uidConfig } from "./uidConfig.js";  // Import the UID configuration

export default {
  async fetch(request, env) {
    console.log("\n--- Incoming Request ---");
    console.log("Method:", request.method);
    console.log("URL:", request.url);

    const url = new URL(request.url);
    const pathname = url.pathname;
    const params = url.searchParams;

    console.log("Path:", pathname);
    console.log("Query Params:", Object.fromEntries(params));

    // Ensure `env` is loaded properly
    console.log("Environment Variables Loaded:", Object.keys(env));

    // Status page
    if (pathname === "/status") {
      return handleStatus();
    }

    // Boltcard deep-link endpoint
    if (pathname === "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards") {
      const onExisting = params.get("onExisting");
      console.log("BoltCards Request - onExisting:", onExisting);

      if (onExisting === "UpdateVersion") {
        return handleBoltCardsRequest(request, env);
      }
      if (onExisting === "KeepVersion") {
        try {
          const body = await request.json();
          console.log("Request Body:", body);

          const lnurlw = body.LNURLW;
          if (!lnurlw) {
            console.error("Error: Missing LNURLW parameter.");
            return new Response(
              JSON.stringify({ status: "ERROR", reason: "Missing LNURLW parameter." }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }

          let lnurl;
          try {
            lnurl = new URL(lnurlw);
          } catch (e) {
            console.error("Error: Invalid LNURLW format.");
            return new Response(
              JSON.stringify({ status: "ERROR", reason: "Invalid LNURLW format." }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }

          const pHex = lnurl.searchParams.get("p");
          const cHex = lnurl.searchParams.get("c");
          if (!pHex || !cHex) {
            console.error("Error: Invalid LNURLW format - missing `p` or `c`.");
            return new Response(
              JSON.stringify({ status: "ERROR", reason: "Invalid LNURLW format: missing p or c." }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }

          console.log("Decoding LNURLW: pHex:", pHex, "cHex:", cHex);
          const { uidHex, ctr, error } = decodeAndValidate(pHex, cHex, env);
          if (error) {
            console.error("decodeAndValidate failed:", error);
            return new Response(
              JSON.stringify({ status: "ERROR", reason: error }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }

          console.log("Reset Flow: Decoded UID:", uidHex, "Counter:", parseInt(ctr, 16));
          return handleReset(uidHex, env);
        } catch (err) {
          console.error("Error in KeepVersion Flow:", err);
          return new Response(
            JSON.stringify({ status: "ERROR", reason: err.message }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }
      }
    }

    // LNURLW verification
    const pHex = params.get("p");
    const cHex = params.get("c");
    if (pHex && cHex) {
      console.log("LNURLW Verification: pHex:", pHex, "cHex:", cHex);

      const { uidHex, ctr, error } = decodeAndValidate(pHex, cHex, env);
      if (error) {
        console.error("decodeAndValidate failed:", error);
        return new Response(
          JSON.stringify({ status: "ERROR", reason: error }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      console.log("Decoded UID:", uidHex, "Counter:", parseInt(ctr, 16));

      // Check if UID should be proxied
      if (uidConfig[uidHex]) {
        const config = uidConfig[uidHex];
        console.log("Proxying request for UID:", uidHex, "to domain:", config.proxyDomain);
        return handleProxy(request, uidHex, pHex, cHex, config.externalId);
      }

      // If no proxy match, return the default JSON response
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
      return new Response(JSON.stringify(responsePayload), { headers: { "Content-Type": "application/json" } });
    }

    // Generalized LNURLp POST request handling
    if (pathname.startsWith("/boltcards/api/v1/lnurl/cb") && request.method === "POST") {
      return handleLnurlpPayment(request, env);
    }

    console.error("Error: Route not found.");
    return new Response("Not Found", { status: 404 });
  },
};
