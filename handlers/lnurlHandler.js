import { decodeAndValidate } from "../boltCardHelper.js";

export async function handleLnurlpPayment(request, env) {
  try {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const lnurlpBase = "/boltcards/api/v1/lnurl/cb";
    
    let p, c, json;

    // Handle POST request
    if (request.method === "POST") {
      json = await request.json();
      console.log("Received LNURLp Payment request (POST):", JSON.stringify(json, null, 2));

      // Extract p from the URL path if there is anything after lnurlpBase
      const extra = pathname.slice(lnurlpBase.length).split("/").filter(Boolean);
      if (extra.length >= 1) {
        // p is the first part of the path after lnurlpBase, and k1 is c
        p = extra[0];
        if (!json.k1) {
          return new Response(
            JSON.stringify({ status: "ERROR", reason: "Missing k1 parameter for c value" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        c = json.k1;  // k1 is just c in this case
      } else {
        // If no extra path after lnurlpBase, extract p and c from k1 (Method a)
        if (!json.k1) {
          return new Response(
            JSON.stringify({ status: "ERROR", reason: "Missing k1 parameter" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        const k1Params = new URLSearchParams(json.k1);
        p = k1Params.get("p");
        c = k1Params.get("c");
        if (!p || !c) {
          return new Response(
            JSON.stringify({ status: "ERROR", reason: "Invalid k1 format, missing p or c" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
      }

      console.log(`Using p: ${p} and c: ${c}`);
    } else if (request.method === "GET") {
      // Handle GET request

      // Extract p from the URL path if there is anything after lnurlpBase
      const extra = pathname.slice(lnurlpBase.length).split("/").filter(Boolean);
      if (extra.length >= 1) {
        // p is the first part of the path after lnurlpBase, and k1 is just c
        p = extra[0];
      }

      // k1 should contain c
      const params = url.searchParams;
      const k1 = params.get("k1");
      if (!k1) {
        return new Response(
          JSON.stringify({ status: "ERROR", reason: "Missing k1 parameter in query string" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // If p is not extracted from the URL path, extract p and c from k1 (Method a)
      if (!p) {
        const k1Params = new URLSearchParams(k1);
        p = k1Params.get("p");
        c = k1Params.get("c");
        if (!p || !c) {
          return new Response(
            JSON.stringify({ status: "ERROR", reason: "Invalid k1 format, missing p or c" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
      } else {
        // If p is already extracted from the path, k1 is just c
        c = k1;  // k1 is just c here
      }

      console.log(`Using p: ${p} and c: ${c} (from GET request)`);

      // Also, make sure invoice exists for GET requests
      const invoice = params.get("pr");
      if (!invoice) {
        return new Response(
          JSON.stringify({ status: "ERROR", reason: "Missing invoice parameter in query string" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      console.log(`Invoice from GET: ${invoice}`);
    } else {
      return new Response(
        JSON.stringify({ status: "ERROR", reason: "Unsupported method" }),
        { status: 405, headers: { "Content-Type": "application/json" } }
      );
    }

    // Decode and validate the p and c values
    const { uidHex, ctr, cmac_validated, cmac_error, error } = decodeAndValidate(p, c, env);
    if (error) {
      return new Response(
        JSON.stringify({ status: "ERROR", reason: error }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Debug print the counter and UID
    console.log(`Decoded LNURLp values: UID=${uidHex}, Counter=${parseInt(ctr, 16)}`);

    // Assert that cmac_validated is true
    if (!cmac_validated) {
      return new Response(
        JSON.stringify({ status: "ERROR", reason: `CMAC validation failed: ${cmac_error}` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`CMAC validation passed`);

    // Process the invoice if present
    if (json && json.invoice) {
      console.log(`Processing withdrawal for UID=${uidHex} with invoice: ${json.invoice}`);
      processWithdrawalPayment(uidHex, json.invoice, env);

      return new Response(
        JSON.stringify({ status: "OK" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ status: "OK" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error processing LNURL withdraw request:", err.message);
    return new Response(
      JSON.stringify({ status: "ERROR", reason: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// Simulated withdrawal payment processing function
function processWithdrawalPayment(uid, pr, env) {
  console.log(`Simulating payment for invoice ${pr} with UID=${uid}`);
  // Implement actual Lightning Network payment logic here
}
