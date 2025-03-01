import { handleStatus } from "./handlers/statusHandler.js";
import { handleBoltCardsRequest } from "./handlers/boltcardsHandler.js";
import { handleVerification } from "./handlers/verificationHandler.js";
import { handleReset } from "./handlers/resetHandler.js"; // New Reset Handler

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const params = url.searchParams;

    // 1. The status page
    if (pathname === "/status") {
      return handleStatus();
    }

    // 2. The new deep-link endpoint
    if (
      pathname === "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards"
    ) {
      // Extract "onExisting" param to determine if it's a program or reset request
      const onExisting = params.get("onExisting");
      
      if (onExisting === "UpdateVersion") {
        return handleBoltCardsRequest(request, env); // Program new card
      }
      if (onExisting === "KeepVersion") {
        return handleReset(request, env); // Reset existing card
      }
    }

    // 3. Existing LNURLW verification (test vector support)
    const pHex = params.get("p");
    const cHex = params.get("c");
    if (pHex && cHex) {
      return handleVerification(url, env);
    }

    return new Response("Not Found", { status: 404 });
  }
};
