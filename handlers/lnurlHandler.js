import { decodeAndValidate } from "../boltCardHelper.js";
import { uidConfig } from "../uidConfig.js";

export async function handleLnurlpPayment(request) {
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
      // Optionally, if you want to support POST-based withdrawal processing,
      // you can call processWithdrawalPayment here.
      // For now, the POST branch only logs the request.
      return new Response(
        JSON.stringify({ status: "200", message: "POST received" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
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

      const { uidHex, ctr, error } = decodeAndValidate(p, c);
      if (error) {
        return new Response(
          JSON.stringify({ status: "ERROR", reason: error }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      const normalizedUidHex = uidHex.toLowerCase(); // Ensure UID is in lowercase for lookup
      console.log(`Processing withdrawal for UID=${normalizedUidHex} with invoice: ${invoice}`);

      // Process the withdrawal payment via CLN REST or fakewallet
      const withdrawalResponse = await processWithdrawalPayment(normalizedUidHex, invoice);
      
      // If processWithdrawalPayment returns a Response, forward it.
      if (withdrawalResponse instanceof Response) {
        return withdrawalResponse;
      }
      
      // Fallback if no response was provided from processWithdrawalPayment.
      return new Response(
        JSON.stringify({ status: "-1" }),
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
  console.log(`Processing payment for invoice ${pr} with UID=${uid}`);

  uid = uid.toLowerCase(); // Ensure UID is in lowercase for lookup
  const config = uidConfig[uid];
  console.log(`Loaded config for UID=${uid}:`, JSON.stringify(config, null, 2));

  if (!config) {
    console.error(`No configuration found for UID=${uid}`);
    return new Response(
      JSON.stringify({ status: "ERROR", reason: "UID configuration not found" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Handle fakewallet payment method
  if (config.payment_method === "fakewallet") {
    console.log(`Processing payment using fakewallet for UID=${uid}`);
    // Since fakewallet requires no extra parameters, simply return success.
    return new Response(
      JSON.stringify({ status: "201", message: "Payment processed successfully by fakewallet" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Handle CLN REST payment method
  if (config.payment_method === "clnrest") {
    if (!config.clnrest || !config.clnrest.rune) {
      console.error(`Missing CLN REST configuration or rune for UID=${uid}`);
      return new Response(
        JSON.stringify({ status: "ERROR", reason: "Invalid CLN REST configuration" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    try {
      const clnrest = config.clnrest;
      const clnrest_endpoint = `${clnrest.host}`;
      console.log(`Sending request to CLN REST at ${clnrest_endpoint}/v1/pay with invoice: ${pr}`);

      // Create headers with the required content type and Rune for authentication.
      const headers = new Headers();
      headers.set("Content-Type", "application/json");
      headers.set("Rune", clnrest.rune);
      console.log("Headers to be sent:", JSON.stringify(Array.from(headers.entries())));

      // Build the request body using the correct parameter name
      const requestBody = JSON.stringify({ bolt11: pr });
      console.log("Request Body:", requestBody);

      // Make the API call to the CLN REST endpoint.
      const response = await fetch(clnrest_endpoint + "/v1/pay", {
        method: "POST",
        headers: headers,
        body: requestBody,
      });

      if (!response) {
        console.error("No response received from CLN REST endpoint.");
        return new Response(
          JSON.stringify({ status: "ERROR", reason: "No response from CLN REST endpoint" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      if (response.status === 201) {
        const responseBody = await response.json();
        console.log(`Payment processed successfully. Response Body:`, JSON.stringify(responseBody, null, 2));
        return new Response(
          JSON.stringify({ status: "201", message: "Payment processed successfully" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      } else if (response.status === 401) {
        const text = await response.text();
        console.error(`Authentication issue: Status ${response.status}. Body: ${text}`);
        return new Response(
          JSON.stringify({ status: "ERROR", reason: `Authentication issue: ${text}` }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );
      } else {
        const text = await response.text();
        console.error(`Error in response: Status ${response.status}. Body: ${text}`);
        return new Response(
          JSON.stringify({ status: "ERROR", reason: `Error response: ${text}` }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    } catch (error) {
      console.error(`CLN REST Pay Request Failed: ${error.message}`);
      return new Response(
        JSON.stringify({ status: "ERROR", reason: `CLN REST Pay Request Failed: ${error.message}` }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // If the payment_method is neither fakewallet nor clnrest, return an error.
  console.error(`Unsupported payment method for UID=${uid}: ${config.payment_method}`);
  return new Response(
    JSON.stringify({ status: "ERROR", reason: `Unsupported payment method: ${config.payment_method}` }),
    { status: 400, headers: { "Content-Type": "application/json" } }
  );
}
