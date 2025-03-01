import AES from "aes-js";
import {
  hexToBytes,
  bytesToHex,
  computeKs,
  computeCm
} from "../cryptoutils.js";
import { getDeterministicKeys } from "../keygenerator.js"; // Ensure this can derive keys from UID

export async function handleReset(request, env) {
  try {
    const body = await request.json();
    const lnurlw = body.LNURLW; // Reset flow provides LNURLW instead of UID

    if (!lnurlw) {
      return new Response(JSON.stringify({ error: "Missing LNURLW parameter" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Parse p= and c= from LNURLW
    const url = new URL(lnurlw);
    const pHex = url.searchParams.get("p");
    const cHex = url.searchParams.get("c");

    if (!pHex || !cHex) {
      return new Response(JSON.stringify({ error: "Invalid LNURLW format" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Attempt decryption with all available K1 keys
    const k1Keys = env.BOLT_CARD_K1.split(",").map(hexToBytes);
    const k2Bytes = hexToBytes(env.BOLT_CARD_K2);
    const pBytes = hexToBytes(pHex);
    const cBytes = hexToBytes(cHex);

    if (pBytes.length !== 16 || cBytes.length !== 8) {
      return new Response(JSON.stringify({ error: "Invalid p or c length" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    let decrypted, uidBytes, ctr;
    let matched = false;
    let usedK1 = null;

    for (const k1Bytes of k1Keys) {
      const aesEcbK1 = new AES.ModeOfOperation.ecb(k1Bytes);
      decrypted = aesEcbK1.decrypt(pBytes);

      if (decrypted[0] === 0xC7) {
        matched = true;
        usedK1 = bytesToHex(k1Bytes);
        uidBytes = decrypted.slice(1, 8);
        ctr = new Uint8Array([decrypted[10], decrypted[9], decrypted[8]]);
        break;
      }
    }

    if (!matched) {
      return new Response(
        JSON.stringify({ error: "Unable to decode UID from LNURLW" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`Decryption successful with K1: ${usedK1}`);
    const uid = bytesToHex(uidBytes).toUpperCase();

    // Derive keys using the decoded UID
    const keys = await getDeterministicKeys(uid);

    // Construct response payload
    const responsePayload = {
      protocol_name: "new_bolt_card_response",
      protocol_version: 1,
      card_name: `UID ${uid}`,
      LNURLW: "lnurlw://boltcardpoc.psbt.me/ln",
      K0: keys.k0,
      K1: keys.k1,
      K2: keys.k2,
      K3: keys.k3,
      K4: keys.k4,
    };

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
