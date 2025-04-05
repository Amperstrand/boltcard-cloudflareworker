// index.js
import { decodeAndValidate } from "./boltCardHelper.js";
import { handleStatus } from "./handlers/statusHandler.js";
import { fetchBoltCardKeys } from "./handlers/fetchBoltCardKeys.js";
import { handleLnurlpPayment } from "./handlers/lnurlHandler.js";
import { handleProxy } from "./handlers/proxyHandler.js";
import { constructWithdrawResponse } from "./handlers/withdrawHandler.js";
import handleNfc from "./handlers/handleNfc.js"; // Import NFC Page Handler
import { getUidConfig } from "./getUidConfig.js"; // <-- Import the new helper

// Helper function to return JSON responses
const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// Helper function for error responses
const errorResponse = (reason, status = 400) =>
  jsonResponse({ status: "ERROR", reason }, status);

export default {
  async fetch(request, env) {
    console.log("\n--- Incoming Request ---");
    console.log("Method:", request.method);
    console.log("URL:", request.url);

    const url = new URL(request.url);
    const { pathname, searchParams } = url;
    console.log("Path:", pathname);
    console.log("Query Params:", Object.fromEntries(searchParams));

    // Route handling
    if (pathname === "/nfc") return handleNfc();
    if (pathname === "/status") return handleStatus();
    if (pathname === "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards") {
      return fetchBoltCardKeys(request);
    }
    if (pathname.startsWith("/boltcards/api/v1/lnurl/cb")) {
      return handleLnurlpPayment(request);
    }

    // LNURLW Verification
    const pHex = searchParams.get("p");
    const cHex = searchParams.get("c");

    if (pHex && cHex) {
      console.log("LNURLW Verification: pHex:", pHex, "cHex:", cHex);

      // Decode and validate the LNURL parameters
      const { uidHex, ctr, cmac_validated, cmac_error, error } = decodeAndValidate(pHex, cHex);
      if (error) return errorResponse(error);

      console.log("Decoded UID:", uidHex, "Counter:", parseInt(ctr, 16));

      // Fetch the UID configuration from KV or static file
      const config = await getUidConfig(uidHex, env);

      // If we still don't have a configuration, return an error
      if (!config) {
        console.error(`UID ${uidHex} not found in any config`);
        return errorResponse("UID not found in config");
      }

      console.log(`Payment method for UID ${uidHex}: ${config.payment_method}`);

      // Handle proxy payment method
      if (config.payment_method === "proxy" && config.proxy?.proxyDomain) {
        console.log(`Proxying request for UID=${uidHex} to domain: ${config.proxy.proxyDomain}`);
        return handleProxy(request, uidHex, pHex, cHex, config.proxy.externalId);
      }

      // Handle CLN REST payment method
      if (config.payment_method === "clnrest" && config.clnrest?.host) {
        if (!cmac_validated) {
          console.warn(`CMAC Validation Warning: ${cmac_error || "CMAC validation skipped."}`);
          return errorResponse(cmac_error || "CMAC validation failed");
        }
        const responsePayload = constructWithdrawResponse(uidHex, pHex, cHex, ctr, cmac_validated);
        console.log("Response Payload:", responsePayload);
        if (responsePayload.status === "ERROR") return errorResponse(responsePayload.reason);
        return jsonResponse(responsePayload);
      }

      // Handle fake wallet payment method
      if (config.payment_method === "fakewallet") {
        if (!cmac_validated) {
          console.warn(`CMAC Validation Warning: ${cmac_error || "CMAC validation skipped."}`);
          return errorResponse(cmac_error || "CMAC validation failed");
        }
        const responsePayload = constructWithdrawResponse(uidHex, pHex, cHex, ctr, cmac_validated);
        console.log("Response Payload:", responsePayload);
        if (responsePayload.status === "ERROR") return errorResponse(responsePayload.reason);
        return jsonResponse(responsePayload);
      }

      console.error(`Unsupported payment method for UID=${uidHex}: ${config.payment_method}`);
      return errorResponse(`Unsupported payment method: ${config.payment_method}`);
    }

    console.error("Error: Route not found.");
    return new Response("Not found", { status: 404 });
  },
};
