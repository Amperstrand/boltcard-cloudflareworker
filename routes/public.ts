import type { AppRouter } from "../middleware/withOperatorAuth.js";
import { redirect, errorResponse } from "../utils/responses.js";
import { handleStatus } from "../handlers/statusHandler.js";
import { handleLnurlw } from "../handlers/lnurlwHandler.js";
import { handleLnurlPayCallback } from "../handlers/lnurlPayHandler.js";
import { handleLnurlpPayment } from "../handlers/lnurlHandler.js";
import { handleLoginPage, handleLoginVerify } from "../handlers/loginHandler.js";
import { handleCardPage, handleCardInfo, handleCardLock, handleCardReactivate } from "../handlers/cardDashboardHandler.js";
import { handleIdentityPage, handleIdentityProfileUpdate, handleIdentityVerify } from "../handlers/identityHandler.js";
import { handleTwoFactor } from "../handlers/twoFactorHandler.js";
import { handleDecodePage, handleDecodeApi } from "../handlers/bolt11DecodeHandler.js";
import { handleVirtualCardPage } from "../handlers/virtualCardPageHandler.js";
import { handleVirtualCardKeys } from "../handlers/virtualCardHandler.js";
import { handleFakeInvoice } from "../handlers/fakeInvoiceHandler.js";
import { handleBalanceCheck } from "../handlers/balanceCheckHandler.js";
import { handleClientError } from "../handlers/clientErrorHandler.js";

export function registerPublicRoutes(router: AppRouter): void {
  router.get("/status", (request, env) => handleStatus(request, env));
  router.get("/api/fake-invoice", (request, env) => handleFakeInvoice(request, env));
  router.all("/boltcards/api/v1/lnurl/cb*", (request, env) => handleLnurlpPayment(request, env));
  router.get("/2fa", (request, env) => handleTwoFactor(request, env));
  router.get("/login", (request) => handleLoginPage(request));
  router.post("/login", (request, env) => handleLoginVerify(request, env));
  router.get("/pos", () => redirect("/operator/pos"));
  router.get("/lnurlp/cb", (request, env) => handleLnurlPayCallback(request, env));
  router.get("/api/verify-identity", (request, env) => handleIdentityVerify(request, env));
  router.post("/api/identity/profile", (request, env) => handleIdentityProfileUpdate(request, env));
  router.get("/api/vc/keys", (request, env) => handleVirtualCardKeys(request, env));
  router.post("/api/balance-check", (request, env) => handleBalanceCheck(request, env));
  router.post("/api/client-error", (request, env) => handleClientError(request, env));

  router.get("/decode", (request) => handleDecodePage(request));
  router.get("/api/decode", (request) => handleDecodeApi(request));

  router.get("/identity", (request) => handleIdentityPage(request));
  router.get("/card", (request, env) => handleCardPage(request, env));
  router.get("/virtual", (request) => handleVirtualCardPage(request));
  router.get("/card/info", (request, env) => handleCardInfo(request, env));
  router.post("/api/card/lock", (request, env) => handleCardLock(request, env));
  router.post("/api/card/reactivate", (request, env) => handleCardReactivate(request, env));

  router.get("/nfc-uid", () => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NFC UID Reader</title><style>body{background:#111827;color:#f3f4f6;font-family:system-ui;padding:2rem;text-align:center}h1{color:#10b981;font-size:1.5rem}#uid{font-size:2rem;font-family:monospace;color:#34d399;margin:2rem 0;word-break:break-all}#status{color:#6b7280;font-size:0.875rem}button{background:#10b981;color:white;border:none;padding:0.75rem 2rem;border-radius:0.5rem;font-size:1rem;cursor:pointer;margin:1rem}</style></head><body><h1>NFC UID Reader</h1><p id="status">Tap card to read UID...</p><div id="uid">\u2014</div><button id="btn" onclick="startScan()">START SCAN</button><script>
async function startScan(){
if(!('NDEFReader' in window)){document.getElementById('status').textContent='Web NFC not supported';return;}
try{
const ndef=new NDEFReader();
await ndef.scan();
document.getElementById('status').textContent='Scanning... tap a card';
ndef.onreading=e=>{
const uid=e.serialNumber.replace(/:/g,'').toUpperCase();
document.getElementById('uid').textContent=uid;
document.getElementById('status').textContent='UID read! '+new Date().toLocaleTimeString();
};
ndef.onreadingerror=()=>{document.getElementById('status').textContent='Read error, try again';};
}catch(err){document.getElementById('status').textContent='Error: '+err.message;}
}
if('NDEFReader' in window&&navigator.permissions){navigator.permissions.query({name:'nfc'}).then(r=>{if(r.state==='granted')startScan();});}
</script></body></html>`;
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  });

  router.get("/", (request, env) => {
    const { searchParams } = new URL(request.url);
    const hasP = searchParams.has("p");
    const hasC = searchParams.has("c");
    if (hasP && hasC) {
      const accept = request.headers.get("Accept") || "";
      if (accept.includes("text/html")) {
        return handleIdentityPage(request);
      }
      return handleLnurlw(request, env);
    }
    if (hasP || hasC) {
      return errorResponse("Missing card parameters — both p and c are required", 400);
    }
    return handleLoginPage(request);
  });
}
