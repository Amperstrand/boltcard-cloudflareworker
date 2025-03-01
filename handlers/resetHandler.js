import { getDeterministicKeys } from "../keygenerator.js";

export async function handleReset(url, env) {
  const lnurlw = url.searchParams.get("lnurlw");
  if (!lnurlw) {
    return new Response(
      JSON.stringify({ status: "ERROR", reason: "Missing lnurlw parameter" }),
      { status: 400 }
    );
  }

  try {
    // Note: if getDeterministicKeys should be parameterless for reset, keep as-is.
    const keys = await getDeterministicKeys();
    const response = {
      status: "SUCCESS",
      message: "BoltCard reset successfully",
      keys: {
        K0: keys.k0,
        K1: keys.k1,
        K2: keys.k2,
        K3: keys.k3,
        K4: keys.k4,
        ID: keys.id,
        CardKey: keys.cardKey,
      },
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ status: "ERROR", reason: error.message }),
      { status: 500 }
    );
  }
}
