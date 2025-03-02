import { decodeAndValidate } from "./boltCardHelper.js";
import { handleStatus } from "./handlers/statusHandler.js";
import { handleBoltCardsRequest } from "./handlers/boltcardsHandler.js";
import { handleReset } from "./handlers/resetHandler.js";
import { handleLnurlpPayment } from "./handlers/lnurlHandler.js";
import { handleProxy } from "./handlers/proxyHandler.js";
import { uidConfig } from "./uidConfig.js";  // Import the UID configuration

export default {
  async fetch(request, env) {
    try {
      console.log("Request:", request.method, request.url);
      const url = new URL(request.url);
      const { pathname, searchParams } = url;

      const routes = {
        "/status": () => handleStatus(),
        "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards": () => handleBoltCards(request, searchParams, env),
        "/boltcards/api/v1/lnurl/cb": () => request.method === "POST" ? handleLnurlpPayment(request, env) : new Response("Not Found", { status: 404 })
      };

      if (routes[pathname]) return routes[pathname]();

      // Handle LNURLW verification dynamically
      const pHex = searchParams.get("p");
      const cHex = searchParams.get("c");

      if (pHex && cHex) {
        return handleLnurlwVerification(request, pHex, cHex, env);
      }

      return new Response("Not Found", { status: 404 });

    } catch (err) {
      return errorResponse(err.message, 500);
    }
  }
};

// --- Extracted Helper Functions ---

function errorResponse(reason, status = 400) {
  return new Response(JSON.stringify({ status: "ERROR", reason }), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function handleBoltCards(request, searchParams, env) {
  const onExisting = searchParams.get("onExisting");

  if (onExisting === "UpdateVersion") {
    return handleBoltCardsRequest(request, env);
  }

  if (onExisting === "KeepVersion") {
    try {
      const body = await request.json();
      const lnurlw = body.LNURLW;
      if (!lnurlw) return errorResponse("Missing LNURLW parameter.");

      let lnurl;
      try {
        lnurl = new URL(lnurlw);
      } catch (e) {
        return errorResponse("Invalid LNURLW format.");
      }

      const pHex = lnurl.searchParams.get("p");
      const cHex = lnurl.searchParams.get("c");

      if (!pHex || !cHex) return errorResponse("Invalid LNURLW format: missing p or c.");

      const { uidHex, ctr, error } = decodeAndValidate(pHex, cHex, env);
      if (error) return errorResponse(error);

      console.log("Reset Flow: Decoded UID:", uidHex, "Counter:", parseInt(ctr, 16));
      return handleReset(uidHex, env);
    } catch (err) {
      return errorResponse(err.message, 500);
    }
  }

  return new Response("Invalid request", { status: 400 });
}

function handleLnurlwVerification(request, pHex, cHex, env) {
  const { uidHex, ctr, error } = decodeAndValidate(pHex, cHex, env);
  if (error) return errorResponse(error);

  console.log("Decoded UID:", uidHex, "Counter:", parseInt(ctr, 16));

  // Check if UID should be proxied
  if (uidConfig[uidHex]) {
    const config = uidConfig[uidHex];
    console.log("Proxying request for UID:", uidHex, "to domain:", config.proxyDomain);
    return handleProxy(request, uidHex, pHex, cHex, config.externalId);
  }

  // If no proxy match, return the default JSON response
  return new Response(JSON.stringify({
    tag: "withdrawRequest",
    callback: `https://boltcardpoc.psbt.me/boltcards/api/v1/lnurl/cb/${pHex}`,
    k1: cHex,
    minWithdrawable: 1000,
    maxWithdrawable: 1000,
    defaultDescription: `Boltcard payment from UID ${uidHex}, counter ${parseInt(ctr, 16)}`,
    payLink: `lnurlp://boltcardpoc.psbt.me/boltcards/api/v1/lnurlp_not_implemented_yet/${uidHex}/${pHex}/${cHex}`
  }), { headers: { "Content-Type": "application/json" } });
}
