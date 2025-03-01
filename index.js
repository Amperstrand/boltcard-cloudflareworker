import AES from "aes-js";
import {
  hexToBytes,
  bytesToHex,
  buildVerificationData,
  decryptP,
  computeAesCmacForVerification,
  getK2KeyForUID
} from "./cryptoutils.js";
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
        // For a reset request, the POST body contains LNURLW (with p and c values)
        try {
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

          // Decode p to determine UID and counter.
          const { uidHex, ctr, error } = this.decodeAndValidate(pHex, cHex, env);
          if (error) {
            return new Response(JSON.stringify({ status: "ERROR", reason: error }), {
              status: 400,
              headers: { "Content-Type": "application/json" }
            });
          }
          console.log("Reset Flow: Decoded UID:", uidHex, "Counter:", ctr);
          // Now call reset handler with the UID.
          return handleReset(uidHex, env);
        } catch (err) {
          return new Response(JSON.stringify({ status: "ERROR", reason: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }
      }
    }

    // 3. LNURLW verification for GET requests (if p and c are provided in the URL)
    const pHex = params.get("p");
    const cHex = params.get("c");
    if (pHex) {
      const { uidHex, ctr, error } = this.decodeAndValidate(pHex, cHex, env);
      if (error) {
        return new Response(JSON.stringify({ status: "ERROR", reason: error }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
      console.log("Decoded UID:", uidHex, "Counter:", ctr);
      // For non-reset GET requests, we assume CMAC validation is for a withdraw request.
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
    }

    return new Response("Not Found", { status: 404 });
  },

  /**
   * decodeAndValidate:
   *   Decrypts pHex using BOLT_CARD_K1, extracts UID and counter,
   *   then validates the provided cHex using the k2 key.
   * Returns an object with { uidHex, ctr, error }.
   */
  decodeAndValidate(pHex, cHex, env) {
    if (!env.BOLT_CARD_K1) {
      return { error: "BOLT_CARD_K1 environment variable is missing." };
    }
    const k1Keys = env.BOLT_CARD_K1.split(",").map(hexToBytes);
    if (!k1Keys || k1Keys.length === 0) {
      return { error: "Failed to parse BOLT_CARD_K1." };
    }
    const result = decryptP(pHex, k1Keys);
    if (!result.success) {
      return { error: "Unable to decode UID from provided p parameter." };
    }
    const uidHex = bytesToHex(result.uidBytes);
    const ctr = bytesToHex(result.ctr);
    if (cHex) {
      const k2Bytes = getK2KeyForUID(env, uidHex);
      if (!k2Bytes) {
        return { error: `No K2 key found for UID ${uidHex}. Unable to verify CMAC.` };
      }
      const { sv2 } = buildVerificationData(hexToBytes(uidHex), hexToBytes(ctr), k2Bytes);
      const computedCtHex = bytesToHex(computeAesCmacForVerification(sv2, k2Bytes));
      if (computedCtHex !== cHex.toLowerCase()) {
        return { error: `CMAC verification failed. Expected CMAC: ${cHex.toLowerCase()}, Calculated CMAC: ${computedCtHex}. This is likely because the K2 key is incorrect.` };
      }
    } else {
      return { error: "Missing c parameter for CMAC verification." };
    }
    return { uidHex, ctr };
  }
};
