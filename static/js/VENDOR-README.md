# Vendored third-party libraries

Served same-origin from `/static/js/` (SHA-256 ETags via registry, deploy-rev
cache busting) instead of cdn.jsdelivr.net — removes the supply-chain and
availability dependency and lets CSP be `script-src 'self'`.

| File | Origin (pinned) | sha256 | License |
|---|---|---|---|
| vendor-aes-js.js | https://cdn.jsdelivr.net/npm/aes-js@3.1.2/index.js | 579277f6e64049ff523b1fd6d6ce1bc9bd2b16b6253dac9862a02665e9bf103d | MIT (header intact) |
| vendor-qrcodejs.js | https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js | c541ef06327885a8415bca8df6071e14189b4855336def4f36db54bde8484f36 | MIT |

Files are byte-for-byte from the pinned artifacts — do not edit; re-vendor
by re-downloading and updating this table.
