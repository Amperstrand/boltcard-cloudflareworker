import { decodeAndValidate } from "../boltCardHelper.js";

export async function handleLnurlpPayment(request, env) {
  try {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const lnurlpBase = "/boltcards/api/v1/lnurl/cb";
    
    if (request.method === "POST") {
      const json = await request.json();
      console.log("Received LNURLp Payment request:", JSON.stringify(json, null, 2));

      let p, q;
      // Check for extra path segments after lnurlp
      const extra = pathname.slice(lnurlpBase.length).split("/").filter(Boolean);
      if (extra.length >= 1) {
        // Method (b): p provided as a URL path parameter, k1 contains only the q value.
        p = extra[0];
        if (!json.k1) {
          return new Response(
            JSON.stringify({ status: "ERROR", reason: "Missing k1 parameter for q value" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        q = json.k1;
      } else {
        // Method (a): k1 is formatted as "p=x&q=y".
        if (!json.k1) {
          return new Response(
            JSON.stringify({ status: "ERROR", reason: "Missing k1 parameter" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        const k1Params = new URLSearchParams(json.k1);
        p = k1Params.get("p");
        q = k1Params.get("q");
        if (!p || !q) {
          return new Response(
            JSON.stringify({ status: "ERROR", reason: "Invalid k1 format, missing p or q" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
      }
      
      console.log(`Using p: ${p} and q: ${q}`);
      const { uidHex, ctr, error } = decodeAndValidate(p, q, env);
      if (error) {
        return new Response(
          JSON.stringify({ status: "ERROR", reason: error }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      console.log(`Decoded LNURLp values: UID=${uidHex}, Counter=${parseInt(ctr, 16)}`);

      // Process the invoice if present
      if (json.invoice) {
        console.log(`Processing withdrawal for UID=${uidHex} with invoice: ${json.invoice}`);
        processWithdrawalPayment(uidHex, json.invoice, env);

        return new Response(
          JSON.stringify({ status: "OK" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }
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
