/**
 * Proxy handler that forwards requests to a specified externalId on the LNBits instance.
 * 
 * @param {Request} request - The incoming request object.
 * @param {string} uidHex - The UID of the Boltcard.
 * @param {string} pHex - The 'p' parameter from LNURLW.
 * @param {string} cHex - The 'c' parameter from LNURLW.
 * @param {string} externalId - The LNBits external ID to be used dynamically.
 * @returns {Response} - The proxied response from the target server.
 */
export async function handleProxy(request, uidHex, pHex, cHex, externalId) {
  const targetBaseUrl = "https://demo.lnbits.com";
  const targetPath = `/boltcards/api/v1/scan/${externalId}?p=${encodeURIComponent(pHex)}&c=${encodeURIComponent(cHex)}`;
  const targetUrl = new URL(targetPath, targetBaseUrl);

  console.log(`Proxying request for UID ${uidHex} to ${targetUrl.toString()}`);
  console.log("Proxy Request Details:");
  console.log("Method:", request.method);
  console.log("Headers:", JSON.stringify(Object.fromEntries(request.headers.entries()), null, 2));

  let requestBody = null;

  try {
    if (request.method !== "GET") {
      const requestClone = request.clone();
      requestBody = await requestClone.text();
      console.log("Request Body:", requestBody.length > 0 ? requestBody : "Empty Body");
    } else {
      console.log("GET request - No body expected.");
    }
  } catch (error) {
    console.error("Error reading request body:", error);
  }

  // Send the proxied request
  const proxyRequest = new Request(targetUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: requestBody ? requestBody : null,
    redirect: "manual"
  });

  try {
    const proxiedResponse = await fetch(proxyRequest);

    // Log response details
    console.log("Proxy Response Details:");
    console.log("Status:", proxiedResponse.status);
    console.log("Headers:", JSON.stringify(Object.fromEntries(proxiedResponse.headers.entries()), null, 2));

    const responseBody = await proxiedResponse.text();
    console.log("Response Body:", responseBody.length > 0 ? responseBody : "Empty Response");

    // Return the proxied response
    return new Response(responseBody, {
      status: proxiedResponse.status,
      headers: proxiedResponse.headers,
    });

  } catch (error) {
    console.error("Error fetching from proxy:", error);
    return new Response("Proxy error", { status: 500 });
  }
}
