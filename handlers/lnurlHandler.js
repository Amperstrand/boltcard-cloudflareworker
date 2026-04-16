import { extractUIDAndCounter, validate_cmac } from "../boltCardHelper.js";
import { getUidConfig } from "../getUidConfig.js";
import { hexToBytes } from "../cryptoutils.js";

// Global counter for fakewallet payments
let fakewalletCounter = 0;

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

      // Step 1: Decrypt PICCENCData to recover UID and SDMReadCtr
      const decryption = extractUIDAndCounter(p, env);
      if (!decryption.success) {
        return new Response(
          JSON.stringify({ status: "ERROR", reason: decryption.error }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      if (!decryption.uidHex) {
        return new Response(
          JSON.stringify({ status: "ERROR", reason: "Failed to decode UID" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const normalizedUidHex = decryption.uidHex.toLowerCase();

      const config = await getUidConfig(normalizedUidHex, env);
      if (!config || !config.K2) {
        return new Response(
          JSON.stringify({ status: "ERROR", reason: "Card configuration not found or missing K2 for local verification" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // Step 3: Validate CMAC with the card's K2 key
      const uidBytes = hexToBytes(decryption.uidHex);
      const ctrBytes = hexToBytes(decryption.ctr);
      const k2Bytes = hexToBytes(config.K2);
      const { cmac_validated, cmac_error } = validate_cmac(uidBytes, ctrBytes, c, k2Bytes);
      if (!cmac_validated) {
        return new Response(
          JSON.stringify({ status: "ERROR", reason: cmac_error || "CMAC validation failed" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // Process the withdrawal payment via CLN REST or fakewallet
      const withdrawalResponse = await processWithdrawalPayment(normalizedUidHex, invoice, env);
      
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

export async function processWithdrawalPayment(uid, pr, env) {
  if (!uid) {
    console.error("Received undefined UID in processWithdrawalPayment");
    return new Response(
      JSON.stringify({ status: "ERROR", reason: "Invalid UID" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  console.log(`Processing payment for invoice ${pr} with UID=${uid}`);

  uid = uid.toLowerCase(); // Ensure UID is in lowercase for lookup
  const config = await getUidConfig(uid, env);
  console.log(`Loaded config for UID=${uid}:`, JSON.stringify(config, null, 2));

  if (!config) {
    console.error(`No configuration found for UID=${uid}`);
    return new Response(
      JSON.stringify({ status: "ERROR", reason: "UID configuration not found" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Handle fakewallet payment method with alternating failure/success
  if (config.payment_method === "fakewallet") {
    fakewalletCounter++;
    if (fakewalletCounter % 2 === 0) {
      console.log(`Fakewallet: simulated failure for UID=${uid}`);
      return new Response(
        JSON.stringify({ status: "ERROR", reason: "Simulated fakewallet failure" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    } else {
      console.log(`Fakewallet: simulated success for UID=${uid}`);
      return new Response(
        JSON.stringify({ status: "OK", message: "Payment processed successfully by fakewallet" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // Handle CLN REST payment method
  // CLN REST API: POST /v1/pay with {bolt11: invoice}, Rune auth header
  // Success: HTTP 201 with JSON body containing status "complete" or "pending"
  // See: https://docs.corelightning.org/reference/pay
  // See: https://docs.corelightning.org/reference/post_rpc_method_resource
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

      const headers = new Headers();
      headers.set("Content-Type", "application/json");
      headers.set("Rune", clnrest.rune);

      const requestBody = JSON.stringify({ bolt11: pr });
      console.log(`CLN REST: POST ${clnrest_endpoint}/v1/pay with invoice: ${pr}`);

      const response = await fetch(clnrest_endpoint + "/v1/pay", {
        method: "POST",
        headers,
        body: requestBody,
      });

      const responseBody = await response.json();

      if (response.status === 201) {
        if (responseBody.status === "complete") {
          console.log(`CLN payment complete:`, JSON.stringify(responseBody, null, 2));
          return new Response(
            JSON.stringify({ status: "OK", message: "Payment processed successfully" }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        console.warn(`CLN payment not complete, status: ${responseBody.status}`, JSON.stringify(responseBody, null, 2));
        return new Response(
          JSON.stringify({ status: "ERROR", reason: `Payment status: ${responseBody.status}` }),
          { status: 202, headers: { "Content-Type": "application/json" } }
        );
      }

      const errorReason = `${response.status}: ${JSON.stringify(responseBody)}`;
      console.error(`CLN REST error: ${errorReason}`);
      return new Response(
        JSON.stringify({ status: "ERROR", reason: errorReason }),
        { status: response.status, headers: { "Content-Type": "application/json" } }
      );
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
