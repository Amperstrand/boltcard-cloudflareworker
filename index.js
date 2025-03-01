import { handleStatus } from "./handlers/statusHandler.js";
import { handleBoltCardsRequest } from "./handlers/boltcardsHandler.js";
import { handleVerification } from "./handlers/verificationHandler.js";

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
    //    /api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards
    //    ?onExisting=UpdateVersion|KeepVersion
    if (
      pathname === "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards"
    ) {
      return handleBoltCardsRequest(request, env);
    }

    // 3. The old LNURLW verification check:
    //    If the request has ?p=... & c=..., use handleVerification
    const pHex = params.get("p");
    const cHex = params.get("c");
    if (pHex && cHex) {
      // Forward to your existing verification logic (test vectors, etc.)
      return handleVerification(url, env);
    }

    // 4. Otherwise, "Not Found"
    return new Response("Not Found", { status: 404 });
  }
};
