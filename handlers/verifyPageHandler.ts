import { renderVerifyPage } from "../templates/verifyPage.js";

export function handleVerifyPage(request: Request): Response {
  const host = request.headers.get("host") || "boltcardpoc.psbt.me";
  return new Response(renderVerifyPage({ host }), {
    headers: { "Content-Type": "text/html;charset=UTF-8" },
  });
}
