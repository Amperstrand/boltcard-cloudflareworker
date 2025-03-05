import { decodeAndValidate } from "./boltCardHelper.js";
import { handleStatus } from "./handlers/statusHandler.js";
import { fetchBoltCardKeys } from "./handlers/fetchBoltCardKeys.js";
import { handleLnurlpPayment } from "./handlers/lnurlHandler.js";
import { handleProxy } from "./handlers/proxyHandler.js";
import { uidConfig } from "./uidConfig.js";
import { constructWithdrawResponse } from "./handlers/withdrawHandler.js";
import handleNfc from "./handlers/handleNfc.js"; // ✅ Import NFC Page Handler

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
//    console.log("Environment Variables Loaded:", Object.keys(env));

    if (pathname === "/nfc") return handleNfc();

    if (pathname === "/status") return handleStatus();

    if (pathname === "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards") {
      return fetchBoltCardKeys(request);
    }

    if (pathname.startsWith("/boltcards/api/v1/lnurl/cb")) {
      return handleLnurlpPayment(request);
    }

    // ✅ Handle LNURLW Verification
    const pHex = searchParams.get("p");
    const cHex = searchParams.get("c");

    if (pHex && cHex) {
      console.log("LNURLW Verification: pHex:", pHex, "cHex:", cHex);
      
      const { uidHex, ctr, cmac_validated, cmac_error, error } = decodeAndValidate(pHex, cHex);
      if (error) return errorResponse(error);

      console.log("Decoded UID:", uidHex, "Counter:", parseInt(ctr, 16));

      // Check if UID exists in config
      if (uidConfig[uidHex]) {
        const config = uidConfig[uidHex];
        console.log(`Payment method for UID ${uidHex}: ${config.payment_method}`);

        if (config.payment_method === "proxy" && config.proxy && config.proxy.proxyDomain) {
          console.log(`Proxying request for UID=${uidHex} to domain: ${config.proxy.proxyDomain}`);
          return handleProxy(request, uidHex, pHex, cHex, config.proxy.externalId);
        }

        if (config.payment_method === "clnrest" && config.clnrest && config.clnrest.host) {
          // Perform CMAC validation only if not using a proxy
          if (!cmac_validated) {
            console.warn(`CMAC Validation Warning: ${cmac_error || "CMAC validation skipped."}`);
            return errorResponse(cmac_error || "CMAC validation failed");
          }

          // Construct standard LNURL withdraw response using the new handler, ensuring CMAC validation
          const responsePayload = constructWithdrawResponse(uidHex, pHex, cHex, ctr, cmac_validated);
          console.log("Response Payload:", responsePayload);

          if (responsePayload.status === "ERROR") {
            return errorResponse(responsePayload.reason);
          }

          return jsonResponse(responsePayload);
        }

        if (config.payment_method === "fakewallet") {
          // Perform CMAC validation only if not using a proxy
          if (!cmac_validated) {
            console.warn(`CMAC Validation Warning: ${cmac_error || "CMAC validation skipped."}`);
            return errorResponse(cmac_error || "CMAC validation failed");
          }

          // Construct standard LNURL withdraw response using the new handler, ensuring CMAC validation
          const responsePayload = constructWithdrawResponse(uidHex, pHex, cHex, ctr, cmac_validated);
          console.log("Response Payload:", responsePayload);

          if (responsePayload.status === "ERROR") {
            return errorResponse(responsePayload.reason);
          }

          return jsonResponse(responsePayload);
        }

        // Handle unsupported payment methods or configurations
        console.error(`Unsupported payment method for UID=${uidHex}: ${config.payment_method}`);
        return errorResponse(`Unsupported payment method: ${config.payment_method}`);
      }

      // Handle case where UID does not exist in config
      console.error(`UID ${uidHex} not found in config`);
      return errorResponse("UID not found in config");

    }

    console.error("Error: Route not found.");
    return new Response("Not found", { status: 404 });
  },
};
