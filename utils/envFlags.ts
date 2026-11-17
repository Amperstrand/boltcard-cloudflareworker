// Opt-in feature flags for audited decisions (the #87 flag pattern:
// middleware/withKeyEndpointAuth.ts). Every flag is default-OFF — unset or
// any unrecognized value keeps the documented posture, so bench/HIL lanes
// are unaffected until the owner flips the wrangler binding.
//
// Truthy strings: "1", "true", "on", "enforce" (case-insensitive).

const TRUTHY = new Set(["1", "true", "on", "enforce"]);

export function isFlagOn(value: string | undefined | null): boolean {
  return TRUTHY.has((value ?? "").trim().toLowerCase());
}
