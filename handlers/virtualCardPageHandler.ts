import { renderVirtualCardPage } from "../templates/virtualCardPage.js";

export function handleVirtualCardPage(): Response {
  return new Response(renderVirtualCardPage(), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
