import { getDeterministicKeys } from "../keygenerator.js";

export async function handleProgram(url, env) {
  const uid = url.searchParams.get("uid");
  if (!uid) {
    return new Response(
      JSON.stringify({ status: "ERROR", reason: "Missing UID" }),
      { status: 400 }
    );
  }

  try {
    const keys = await getDeterministicKeys(uid);
    const response = {
      status: "SUCCESS",
      message: "BoltCard programmed successfully",
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
