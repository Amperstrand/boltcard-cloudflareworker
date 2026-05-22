# Issues — boltcard-cleanup

## [2026-02-27] Session Start

### Known Issues (Pre-existing, to be fixed)
- Bug 1: index.js:172 — ctrValue undefined
- Bug 2: index.js:174 — cardStub undefined + validateAndUpdateCounter wrong sig
- Bug 3: lnurlHandler.js:150 — missing await + env param
- Bug 4: card-portal/handlers.js:302-364 — orphaned code block
- Bug 5: card-portal/handlers.js:397 — variable shadowing
- Bug 6: card-portal/handlers.js:251 — extractUIDAndCounter not implemented
- Bug 7: boltCardHelper.js validate_cmac — 4th arg silently ignored
- Bug 8: src/index.js — dead stub
- Bug 9: admin/routes.js — interface mismatch
- Bug 10: admin/routes.js:17 — handleAdminCreateBackend not imported
- Bug 11: index.js — routes registered 3x
- Bug 12: keygenerator.js — process.env.ISSUER_KEY unavailable in CF Workers

### Known Limitations (Not fixing)
- Counter wraparound at 24-bit max not handled
- No admin panel authentication
- card-portal NFC login deferred
- lnurlp deferred
- TOTP deferred
