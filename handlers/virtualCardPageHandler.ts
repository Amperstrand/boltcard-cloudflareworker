import { renderVirtualCardPage } from "../templates/virtualCardPage.js";

export function handleVirtualCardPage(request: Request): Response {
  const url = new URL(request.url);
  const embed = url.searchParams.get("embed") === "1";
  return new Response(renderVirtualCardPage({ embed }), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
