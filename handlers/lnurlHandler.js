import { decodeAndValidate } from "../boltCardHelper.js";
import { uidConfig } from "../uidConfig.js";

// Helper: Standard JSON response
function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Helper: Extract parameter "p" from the URL path after the base path.
function extractParamFromPath(path, base) {
  const extra = path.slice(base.length).split("/").filter(Boolean);
  return extra.length >= 1 ? extra[0] : null;
}

// Helper: Extract "p" and "c" from a k1 query string.
function extractParamsFromK1(k1) {
  const k1Params = new URLSearchParams(k1);
  return { p: k1Params.get("p"), c: k1Params.get("c") };
}

export async function handleLnurlpPayment(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const lnurlpBase = "/boltcards/api/v1/lnurl/cb";

  let p, c;
  let json;

  try {
    if (request.method === "POST") {
      json = await request.json();
      console.log("Received LNURLp Payment request (POST):", JSON.stringify(json, null, 2));

      p = extractParamFromPath(pathname, lnurlpBase);
      if (p) {
        if (!json.k1) {
          return jsonResponse({ status: "ERROR", reason: "Missing k1 parameter for c value" }, 400);
        }
        c = json.k1;
      } else {
        if (!json.k1) {
          return jsonResponse({ status: "ERROR", reason: "Missing k1 parameter" }, 400);
        }
        ({ p, c } = extractParamsFromK1(json.k1));
        if (!p || !c) {
          return jsonResponse({ status: "ERROR", reason: "Invalid k1 format, missing p or c" }, 400);
        }
      }
      console.log(`Using p: ${p} and c: ${c}`);
    } else if (request.method === "GET") {
      p = extractParamFromPath(pathname, lnurlpBase);
      const params = url.searchParams;
      const k1 = params.get("k1");
      if (!k1) {
        return jsonResponse({ status: "ERROR", reason: "Missing k1 parameter in query string" }, 400);
      }

      if (!p) {
        ({ p, c } = extractParamsFromK1(k1));
        if (!p || !c) {
          return jsonResponse({ status: "ERROR", reason: "Invalid k1 format, missing p or c" }, 400);
        }
      } else {
        c = k1;
      }
      console.log(`Using p: ${p} and c: ${c} (from GET request)`);

      const invoice = params.get("pr");
      if (!invoice) {
        return jsonResponse({ status: "ERROR", reason: "Missing invoice parameter in query string" }, 400);
      }
      console.log(`Invoice from GET: ${invoice}`);
      json = { invoice };
    } else {
      return jsonResponse({ status: "ERROR", reason: "Unsupported method" }, 405);
    }

    const { uidHex, ctr, cmac_validated, cmac_error, error } = decodeAndValidate(p, c, env);
    if (error) {
      return jsonResponse({ status: "ERROR", reason: error }, 400);
    }
    console.log(`Decoded LNURLp values: UID=${uidHex}, Counter=${parseInt(ctr, 16)}`);

    if (!cmac_validated) {
      return jsonResponse({ status: "ERROR", reason: `CMAC validation failed: ${cmac_error}` }, 400);
    }
    console.log("CMAC validation passed");

    if (uidHex in uidConfig) {
      const config = uidConfig[uidHex];
      
      if (config.payment_method === "proxy" && config.proxy && config.proxy.proxyDomain && config.proxy.proxyDomain !== "") {
        console.log(`Using Proxy for UID=${uidHex}`);
        console.log(`Proxy Domain: ${config.proxy.proxyDomain}, External ID: ${config.proxy.externalId}`);
      } else if (config.payment_method === "clnrest" && config.clnrest) {
        console.log(`Using CLN REST for UID=${uidHex}`);
        console.log(`CLN REST Config: Protocol=${config.clnrest.protocol}, Host=${config.clnrest.host}, Port=${config.clnrest.port}, Rune=${config.clnrest.rune}`);
      } else {
        console.log(`No valid payment configuration found for UID=${uidHex}`);
      }
    } else {
      console.log(`No payment configuration found for UID=${uidHex}`);
    }

    if (json && json.invoice) {
      console.log(`Processing withdrawal for UID=${uidHex} with invoice: ${json.invoice}`);
      processWithdrawalPayment(uidHex, json.invoice, env);
      return jsonResponse({ status: "OK" });
    }

    return jsonResponse({ status: "ERROR", reason: "No invoice found" }, 400);
  } catch (err) {
    console.error("Error processing LNURL withdraw request:", err.message);
    return jsonResponse({ status: "ERROR", reason: err.message }, 500);
  }
}

// Simulated withdrawal payment processing function.
function processWithdrawalPayment(uid, pr, env) {
  console.log(`Simulating payment for invoice ${pr} with UID=${uid}`);
}
