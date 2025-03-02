// proxyHandler.js
export async function handleProxy(request, uidHex, pHex, cHex) {
  // Construct target URL with hardcoded external_id.
  const targetBaseUrl = "https://demo.lnbits.com";
  const lnbitsExternalId = "tapko6sbthfdgzoejjztjb";
  const targetPath = `/boltcards/api/v1/scan/${lnbitsExternalId}?p=${encodeURIComponent(pHex)}&c=${encodeURIComponent(cHex)}`;
  const targetUrl = new URL(targetPath, targetBaseUrl);

  console.log(`Proxying request for UID ${uidHex} to ${targetUrl.toString()}`);
  console.log("Proxy Request Details:");
  console.log("Method:", request.method);
  console.log("Headers:", JSON.stringify(Object.fromEntries(request.headers.entries()), null, 2));

  let requestBody = null;
  if (request.body) {
    requestBody = await request.text();
    console.log("Body:", requestBody);
  } else {
    console.log("Body: No body in request");
  }

  const proxyRequest = new Request(targetUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: requestBody ? requestBody : null,
    redirect: "manual"
  });

  const proxiedResponse = await fetch(proxyRequest);
  return proxiedResponse;
}
