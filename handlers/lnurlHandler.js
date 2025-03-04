import { decodeAndValidate } from "../boltCardHelper.js";
import { uidConfig } from "../uidConfig.js";

export async function handleLnurlpPayment(request, env) {
  try {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const lnurlpBase = "/boltcards/api/v1/lnurl/cb";
    
    let p, c, json;

    if (request.method === "POST") {
      json = await request.json();
      console.log("Received LNURLp Payment request (POST):", JSON.stringify(json, null, 2));

      const extra = pathname.slice(lnurlpBase.length).split("/").filter(Boolean);
      if (extra.length >= 1) {
        p = extra[0];
        if (!json.k1) {
          return new Response(
            JSON.stringify({ status: "ERROR", reason: "Missing k1 parameter for c value" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        c = json.k1;
      } else {
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
      const extra = pathname.slice(lnurlpBase.length).split("/").filter(Boolean);
      if (extra.length >= 1) {
        p = extra[0];
      }

      const params = url.searchParams;
      const k1 = params.get("k1");
      if (!k1) {
        return new Response(
          JSON.stringify({ status: "ERROR", reason: "Missing k1 parameter in query string" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

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
        c = k1;
      }

      console.log(`Using p: ${p} and c: ${c} (from GET request)`);

      const invoice = params.get("pr");
      if (!invoice) {
        return new Response(
          JSON.stringify({ status: "ERROR", reason: "Missing invoice parameter in query string" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      console.log(`Invoice from GET: ${invoice}`);

      const { uidHex, ctr, error } = decodeAndValidate(p, c, env);
      if (error) {
        return new Response(
          JSON.stringify({ status: "ERROR", reason: error }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      const normalizedUidHex = uidHex.toLowerCase(); // Ensure UID is in lowercase for lookup
      console.log(`Processing withdrawal for UID=${normalizedUidHex} with invoice: ${invoice}`);
      await processWithdrawalPayment(normalizedUidHex, invoice);
      
      return new Response(
        JSON.stringify({ status: "OK" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
  } catch (err) {
    console.error("Error processing LNURL withdraw request:", err.message);
    return new Response(
      JSON.stringify({ status: "ERROR", reason: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}


export async function processWithdrawalPayment(uid, pr) {
  console.log(`Simulating payment for invoice ${pr} with UID=${uid}`);

  uid = uid.toLowerCase(); // Ensure UID is in lowercase for lookup
  const config = uidConfig[uid];
  console.log(`Loaded config for UID=${uid}:`, JSON.stringify(config, null, 2));

  if (!config || config.payment_method !== "clnrest") {
    console.error(`No valid CLN REST configuration found for UID=${uid}`);
    return;
  }

  // Check that rune is present
  if (!config.clnrest || !config.clnrest.rune) {
    console.error(`Rune is missing in the config for UID=${uid}`);
    return;
  }

  try {
    const clnrest = config.clnrest;
    const clnrest_endpoint = `${clnrest.host}`;
    console.log(`Sending request to CLN REST at ${clnrest_endpoint}/v1/pay with invoice: ${pr}`);

    // Create a Headers object explicitly
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    headers.set("Rune", clnrest.rune);  // 'Rune' header
    console.log("Headers to be sent:", JSON.stringify(Array.from(headers.entries())));

    // Correctly using 'bolt11' in the request body
    const requestBody = JSON.stringify({ bolt11: pr });  // Ensure 'bolt11' is in the body
    console.log("Request Body:", requestBody);

    const response = await fetch(clnrest_endpoint + "/v1/pay", {
      method: "POST",
      headers: headers,
      body: requestBody,
    });

    // Handle success response (201)
    if (response.status === 201) {
      const responseBody = await response.json();
      console.log(`Payment processed successfully. Response Body:`, JSON.stringify(responseBody, null, 2));
    } else if (response.status === 401) {
      // Handle 401 response (e.g., permission issues, incorrect parameter, etc.)
      const text = await response.text();
      console.error(`Authentication or permission issue: Status ${response.status}. Body: ${text}`);
    } else {
      // Handle other failure responses
      const text = await response.text();
      console.error(`Error in response: Status ${response.status}. Body: ${text}`);
    }

    console.log(`CLN REST Pay Response Headers:`, JSON.stringify(Array.from(response.headers.entries()), null, 2));
  } catch (error) {
    console.error(`CLN REST Pay Request Failed: ${error.message}`);
  }
}

