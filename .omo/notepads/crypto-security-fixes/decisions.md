2026-04-16
- Implemented replay protection immediately after CMAC validation and before the LNURL response so only authenticated taps can advance card state and replays are rejected before withdraw metadata is returned.
- Kept KV failures fail-open with warning logs, matching the requested POC behavior while documenting Cloudflare KV eventual-consistency limits instead of introducing Durable Objects.
