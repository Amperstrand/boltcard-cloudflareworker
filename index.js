import { handleStatus } from "./handlers/statusHandler.js";
import { handleBoltCardsRequest } from "./handlers/boltcardsHandler.js";
import { handleReset } from "./handlers/resetHandler.js"; // New Reset Handler
import { hexToBytes, bytesToHex, buildVerificationData, decryptP, computeAesCmacForVerification, getK2KeyForUID } from "./cryptoutils.js";

export default {
  async fetch(request, env) {
    console.log("Request:", request.method, request.url);

    const url = new URL(request.url);
    const pathname = url.pathname;
    const params = url.searchParams;

    // Status page
    if (pathname === "/status") {
      return handleStatus();
    }

    // Deep-link endpoint for boltcards
    if (pathname === "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards") {
      const onExisting = params.get("onExisting");
      if (onExisting === "UpdateVersion") {
        return handleBoltCardsRequest(request, env);
      }
      if (onExisting === "KeepVersion") {
        return handleReset(request, env);
      }
    }

    // LNURLW verification
    const pHex = params.get("p");
    const cHex = params.get("c");

    if (pHex || cHex) {
      let uidHex = null;
      let ctr = null;

      // Step 1: Decode pHex to get UID and counter.
      if (pHex) {
        if (!env.BOLT_CARD_K1) {
          return new Response(
            JSON.stringify({ status: "ERROR", reason: "BOLT_CARD_K1 environment variable is missing." }),
            { status: 500 }
          );
        }
        const k1Keys = env.BOLT_CARD_K1.split(",").map(hexToBytes);
        if (!k1Keys || k1Keys.length === 0) {
          return new Response(
            JSON.stringify({ status: "ERROR", reason: "Failed to parse BOLT_CARD_K1." }),
            { status: 500 }
          );
        }

        const result = decryptP(pHex, k1Keys);
        const { success, uidBytes, ctr: ctrBytes } = result;
        if (!success) {
          return new Response(
            JSON.stringify({ status: "ERROR", reason: "Unable to decode UID from provided p parameter." }),
            { status: 400 }
          );
        }
        uidHex = bytesToHex(uidBytes);
        ctr = bytesToHex(ctrBytes);
        console.log("Decoded UID:", uidHex, "Counter:", ctr);
      }

      // Step 2: Validate the provided cHex using the k2 key and computed CMAC.
      if (cHex) {
        if (!uidHex) {
          return new Response(
            JSON.stringify({ status: "ERROR", reason: "UID could not be decoded" }),
            { status: 400 }
          );
        }
        const k2Bytes = getK2KeyForUID(env, uidHex);
        if (!k2Bytes) {
          return new Response(
            JSON.stringify({ 
              status: "ERROR", 
              reason: `No K2 key found for UID ${uidHex}. Unable to verify CMAC.` 
            }),
            { status: 400 }
          );
        }
        
        const { sv2 } = buildVerificationData(hexToBytes(uidHex), hexToBytes(ctr), k2Bytes);
        const computedCtHex = bytesToHex(computeAesCmacForVerification(sv2, k2Bytes));
        if (computedCtHex !== cHex.toLowerCase()) {
          return new Response(
            JSON.stringify({
              status: "ERROR",
              reason: `CMAC verification failed. Expected CMAC: ${cHex.toLowerCase()}, Calculated CMAC: ${computedCtHex}. This is likely because the k2 key is incorrect.`
            }),
            { status: 400 }
          );
        }
        // If we reach here, the CMAC verified successfully.
        const responsePayload = {
          tag: "withdrawRequest",
          uid: uidHex,
          counter: ctr,
          callback: `https://card.yourdomain.com/withdraw?uid=${uidHex}`,
          maxWithdrawable: 100000000,
          minWithdrawable: 1000,
          defaultDescription: `${uidHex}, counter ${ctr}, cmac: OK`
        };
        return new Response(JSON.stringify(responsePayload), { headers: { "Content-Type": "application/json" } });
      } else {
        return new Response(
          JSON.stringify({ status: "ERROR", reason: "Missing c parameter for CMAC verification." }),
          { status: 400 }
        );
      }
    }

    return new Response("Not Found", { status: 404 });
  }
};
