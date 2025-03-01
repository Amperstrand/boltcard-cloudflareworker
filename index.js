import { handleProgram } from "./handlers/programHandler.js";
import { handleReset } from "./handlers/resetHandler.js";
import { handleVerification } from "./handlers/verificationHandler.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Dispatch based on the request path
    if (pathname === "/program") {
      return handleProgram(url, env);
    } else if (pathname === "/reset") {
      return handleReset(url, env);
    } else {
      return handleVerification(url, env);
    }
  }
};
