import { rawHtml, safe } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";
import { BROWSER_NFC_HELPERS } from "./browserNfc.js";

export function renderNfcPage() {
  return renderTailwindPage({
    title: "BoltCard NFC Console",
    bodyClass: "min-h-screen bg-gray-950 text-gray-100 font-sans antialiased",
    styles: "body { background-color: #030712; color: #f3f4f6; }",
    content: rawHtml`
        <div class="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 md:p-8">
          <section class="rounded-2xl border border-gray-800 bg-gray-900/80 p-6 shadow-2xl shadow-black/30">
            <div class="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div class="max-w-3xl">
                <p class="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-400">Operator utility</p>
                <h1 class="mt-3 text-3xl font-bold tracking-tight text-white md:text-4xl">NFC test console</h1>
                <p class="mt-3 text-sm leading-6 text-gray-400 md:text-base">
                  Tap a BoltCard, inspect the decoded LNURL-withdraw payload, then scan or paste a BOLT11 invoice and trigger the callback directly from the browser. Camera QR scanning is built in, so this works well as a hands-on payment demo on mobile.
                </p>
              </div>

              <div class="flex flex-wrap items-center gap-3">
                <a
                  href="/debug"
                  class="rounded-xl border border-gray-700 bg-gray-950 px-4 py-2 text-sm font-semibold text-gray-200 transition hover:border-cyan-500/50 hover:text-cyan-300"
                >
                  Back to debug tools
                </a>
                <a
                  href="/2fa"
                  class="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-500/20"
                >
                  Open 2FA demo
                </a>
                <button
                  id="nfc-indicator"
                  class="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-500/20"
                >
                  NFC inactive · click to start
                </button>
              </div>
            </div>

            <div class="mt-6 grid gap-4 md:grid-cols-2">
              <div class="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
                <div class="text-xs font-semibold uppercase tracking-[0.25em] text-gray-500">Card UID</div>
                <div id="uid-box" class="mt-3 break-all font-mono text-sm text-amber-400">Waiting for scan...</div>
              </div>

              <div class="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
                <div class="text-xs font-semibold uppercase tracking-[0.25em] text-gray-500">NDEF payload</div>
                <div id="ndef-box" class="mt-3 break-all font-mono text-xs leading-6 text-gray-300">Waiting for NFC scan...</div>
              </div>
            </div>

            <div id="identity-section" class="mt-4 hidden rounded-2xl border border-purple-500/30 bg-purple-500/5 p-6 shadow-xl shadow-black/20">
              <div class="flex items-center gap-3 mb-4">
                <div id="identity-status-dot" class="h-3 w-3 rounded-full bg-gray-500"></div>
                <p class="text-xs font-semibold uppercase tracking-[0.25em] text-purple-400">Card Identification</p>
              </div>
              <div id="identity-details" class="space-y-3 text-sm leading-6 text-gray-300">
                <p class="text-gray-500">Identifying card...</p>
              </div>
            </div>

            <div class="mt-4 rounded-xl border border-gray-800 bg-gray-950/70 p-4">
              <div class="text-xs font-semibold uppercase tracking-[0.25em] text-gray-500">Decoded LNURLW</div>
              <div id="lnurlw-details" class="mt-3 text-sm leading-6 text-gray-300">Scan a card to load callback, limits, and payment metadata.</div>
            </div>

            <div id="error-message" class="mt-4 hidden rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"></div>

            <button
              id="retry-button"
              class="mt-4 hidden w-full rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-200 transition hover:bg-amber-500/20"
            >
              Restart NFC scanner
            </button>
          </section>

          <div class="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <section class="rounded-2xl border border-gray-800 bg-gray-900/80 p-6 shadow-xl shadow-black/20">
              <div class="flex flex-col gap-2">
                <p class="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-400">Step 1</p>
                <h2 class="text-2xl font-semibold text-white">Load an invoice</h2>
                <p class="text-sm leading-6 text-gray-400">
                  Paste a BOLT11 invoice directly or open the QR scanner with your device camera. Payment stays disabled until a card payload has been fetched.
                </p>
              </div>

              <div class="mt-5 flex flex-col gap-3 sm:flex-row">
                <input
                  type="text"
                  id="invoice-input"
                  class="w-full rounded-xl border border-gray-700 bg-gray-950 px-4 py-3 text-sm text-gray-100 placeholder:text-gray-500 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                  placeholder="Paste BOLT11 invoice here"
                />
                <button
                  id="toggle-qr-button"
                  class="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/20 sm:min-w-[180px]"
                >
                  Scan invoice QR
                </button>
              </div>

              <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                <span class="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3 py-1 text-emerald-200">
                  <span class="h-2 w-2 rounded-full bg-emerald-400"></span>
                  Camera QR ready
                </span>
                <span>Best on mobile: tap the card, then point the camera at the invoice QR.</span>
              </div>

              <video
                id="qr-video"
                class="mt-4 hidden w-full rounded-2xl border border-gray-800 bg-black"
                style="max-height: 320px; object-fit: cover;"
                autoplay
                muted
                playsinline
              ></video>

              <div class="mt-4 grid gap-3 sm:grid-cols-2">
                <button
                  id="pay-button"
                  class="hidden rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-cyan-500/40 disabled:text-cyan-100"
                  disabled
                >
                  Pay invoice
                </button>

                <button
                  id="toggle-json-button"
                  class="hidden rounded-xl border border-gray-700 bg-gray-950 px-4 py-3 text-sm font-semibold text-gray-200 transition hover:border-cyan-500/40 hover:text-cyan-300"
                >
                  Show raw JSON
                </button>
              </div>

              <div id="payment-status" class="mt-4 hidden rounded-xl border px-4 py-3 text-sm font-semibold"></div>
              <pre id="json-box" class="mt-4 hidden max-h-96 overflow-auto rounded-2xl border border-gray-800 bg-gray-950/80 p-4 text-xs leading-6 text-green-300"></pre>
            </section>

            <section class="rounded-2xl border border-gray-800 bg-gray-900/80 p-6 shadow-xl shadow-black/20">
              <div class="flex flex-col gap-2">
                <p class="text-xs font-semibold uppercase tracking-[0.25em] text-amber-400">Step 2</p>
                <h2 class="text-2xl font-semibold text-white">Run a live browser-side payment check</h2>
                <p class="text-sm leading-6 text-gray-400">
                  This page is meant for operator testing. It helps you confirm that Web NFC, the LNURL-withdraw response, invoice submission, and callback handling all work together on a real device.
                </p>
              </div>

              <div class="mt-5 space-y-4">
                <div class="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
                  <div class="text-xs font-semibold uppercase tracking-[0.25em] text-gray-500">Suggested flow</div>
                  <ol class="mt-3 space-y-3 text-sm leading-6 text-gray-300">
                    <li>1. Tap a card and confirm the UID and NDEF payload appear above.</li>
                    <li>2. Use <span class="font-semibold text-white">Scan invoice QR</span> or paste a fresh BOLT11 invoice.</li>
                    <li>3. Submit the payment and confirm the callback returns <span class="font-mono text-cyan-300">status: OK</span>.</li>
                  </ol>
                </div>

                <div class="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
                  <div class="text-xs font-semibold uppercase tracking-[0.25em] text-gray-500">Environment notes</div>
                  <div class="mt-3 space-y-3 text-sm leading-6 text-gray-300">
                    <p>Web NFC works best in Chrome on Android. Camera-based QR scanning requires camera permission.</p>
                    <p>The page waits three seconds between NFC reads so repeated taps do not spam the callback flow.</p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>

        <script type="module">
          import QrScanner from "https://cdn.jsdelivr.net/npm/qr-scanner@1.4.2/qr-scanner.min.js";
          ${safe(BROWSER_NFC_HELPERS)}

          let lastScannedUrl = "";
          let callbackUrl = "";
          let k1 = "";
          let jsonFetched = false;
          let paymentUsed = false;
          let qrScanner = null;
          let qrActive = false;
          let nfcActive = false;
          let lastNfcReadTime = 0;
          let nfcAbortController = null;

          const errorBox = document.getElementById("error-message");
          const retryButton = document.getElementById("retry-button");
          const ndefBox = document.getElementById("ndef-box");
          const uidBox = document.getElementById("uid-box");
          const lnurlwDetails = document.getElementById("lnurlw-details");
          const invoiceInput = document.getElementById("invoice-input");
          const payButton = document.getElementById("pay-button");
          const paymentStatus = document.getElementById("payment-status");
          const toggleJsonButton = document.getElementById("toggle-json-button");
          const jsonBox = document.getElementById("json-box");
          const qrVideo = document.getElementById("qr-video");

          function showError(message) {
            errorBox.textContent = message;
            errorBox.classList.remove("hidden");
          }

          function clearError() {
            errorBox.textContent = "";
            errorBox.classList.add("hidden");
          }

          function setPaymentStatus(message, ok) {
            paymentStatus.className = ok
              ? "mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200"
              : "mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200";
            paymentStatus.textContent = message;
            paymentStatus.classList.remove("hidden");
          }

          function hidePaymentStatus() {
            paymentStatus.textContent = "";
            paymentStatus.className = "mt-4 hidden rounded-xl border px-4 py-3 text-sm font-semibold";
          }

          function updatePayButtonState() {
            const invoice = invoiceInput.value.trim();
            const readyToPay = invoice !== "" && jsonFetched && callbackUrl && k1 && !paymentUsed;
            payButton.disabled = !readyToPay;
            payButton.classList.toggle("hidden", !readyToPay);
          }

          function updateToggleQrButton() {
            const button = document.getElementById("toggle-qr-button");
            button.textContent = qrActive ? "Stop invoice QR scan" : "Scan invoice QR";
          }

          function updateNfcIndicator() {
            const indicator = document.getElementById("nfc-indicator");
            if (nfcActive) {
              indicator.className = "rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/20";
              indicator.textContent = "NFC active · click to restart";
            } else {
              indicator.className = "rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-500/20";
              indicator.textContent = "NFC inactive · click to start";
            }
          }

          function restartNfc() {
            if (nfcAbortController) {
              nfcAbortController.abort();
            }
            nfcActive = false;
            updateNfcIndicator();
            clearError();
            retryButton.classList.add("hidden");
            setTimeout(() => startNfc(), 1200);
          }

          async function startNfc() {
            clearError();
            retryButton.classList.add("hidden");

            try {
              const ndef = new NDEFReader();
              nfcAbortController = new AbortController();
              await ndef.scan({ signal: nfcAbortController.signal });
              nfcActive = true;
              updateNfcIndicator();

              ndef.onreading = async (event) => {
                const now = Date.now();
                if (now - lastNfcReadTime < 3000) {
                  return;
                }

                lastNfcReadTime = now;
                clearError();
                hidePaymentStatus();

                let nfcData = await extractNdefUrl(event.message.records, ["lnurlw://", "https://"]);
                nfcData = normalizeBrowserNfcUrl(nfcData);

                ndefBox.textContent = nfcData;

                if (event.serialNumber) {
                  uidBox.textContent = normalizeNfcSerial(event.serialNumber);
                } else {
                  uidBox.textContent = "No UID available";
                }

                if (nfcData.startsWith("https://") && nfcData !== lastScannedUrl) {
                  lastScannedUrl = nfcData;

                  try {
                    const nfcUrl = new URL(nfcData);
                    const pVal = nfcUrl.searchParams.get("p");
                    const cVal = nfcUrl.searchParams.get("c");
                    if (pVal && cVal) {
                      identifyCard(pVal, cVal);
                    }
                  } catch {}

                  await fetchJsonAndHandlePayment(nfcData);
                }
              };

              ndef.onreadingerror = () => {
                showError("Error reading NFC data. Try tapping the card again.");
                ndefBox.textContent = "Error reading NFC data.";
              };
            } catch (error) {
              nfcActive = false;
              updateNfcIndicator();
              retryButton.classList.remove("hidden");

              if (error.name === "NotAllowedError") {
                showError("NFC permission denied. Click restart once the browser is allowed to scan.");
              } else if (error.name === "AbortError") {
                clearError();
              } else {
                showError("Unable to start NFC: " + error.message);
                ndefBox.textContent = "Error: " + error.message;
              }
            }
          }

          async function identifyCard(pVal, cVal) {
            const section = document.getElementById("identity-section");
            const details = document.getElementById("identity-details");
            const dot = document.getElementById("identity-status-dot");
            section.classList.remove("hidden");
            dot.className = "h-3 w-3 rounded-full bg-yellow-400 animate-pulse";
            details.innerHTML = '<p class="text-gray-500">Identifying card...</p>';

            try {
              const resp = await fetch("/api/identify-card", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ p: pVal, c: cVal }),
              });
              const data = await resp.json();

              if (data.status === "ERROR") {
                dot.className = "h-3 w-3 rounded-full bg-red-400";
                details.innerHTML = '<p class="text-red-300">' + (data.reason || "Identification failed") + '</p>';
                return;
              }

              if (data.matched) {
                dot.className = "h-3 w-3 rounded-full bg-emerald-400";
                const m = data.matched;
                const versionLabel = m.version !== undefined ? ' (version ' + m.version + ')' : '';
                const sourceLabel = m.source === "config" ? "Known card" : "Deterministic fallback";
                const methodLabel = m.payment_method ? ' · ' + m.payment_method : '';
                const stateLabel = m.card_state ? ' · state: ' + m.card_state : '';
                const idLabel = m.id ? ' · id: ' + m.id.slice(0, 16) + '...' : '';
                details.innerHTML =
                  '<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">' +
                  '<div><span class="font-semibold text-gray-100">Source:</span> <span class="text-purple-200">' + sourceLabel + versionLabel + '</span></div>' +
                  '<div><span class="font-semibold text-gray-100">UID:</span> <span class="font-mono text-amber-300">' + data.uid + '</span></div>' +
                  '<div><span class="font-semibold text-gray-100">Counter:</span> <span class="font-mono text-cyan-300">' + data.counter + '</span></div>' +
                  '<div><span class="font-semibold text-gray-100">CMAC:</span> <span class="text-emerald-300">valid</span></div>' +
                  '</div>' +
                  '<div class="mt-2 text-xs text-gray-400">' + methodLabel + stateLabel + idLabel + '</div>';

                if (data.all_attempts && data.all_attempts.length > 1) {
                  const others = data.all_attempts.filter(a => !a.cmac_validated);
                  if (others.length > 0) {
                    details.innerHTML += '<div class="mt-2 text-xs text-gray-500">Also tried ' + others.length + ' other key(s) without CMAC match.</div>';
                  }
                }
              } else {
                dot.className = "h-3 w-3 rounded-full bg-red-400";
                let html = '<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">' +
                  '<div><span class="font-semibold text-gray-100">UID:</span> <span class="font-mono text-amber-300">' + data.uid + '</span></div>' +
                  '<div><span class="font-semibold text-gray-100">Counter:</span> <span class="font-mono text-cyan-300">' + data.counter + '</span></div>' +
                  '<div><span class="font-semibold text-gray-100">CMAC:</span> <span class="text-red-300">no match</span></div>' +
                  '</div>';
                if (data.all_attempts && data.all_attempts.length > 0) {
                  html += '<div class="mt-2 text-xs text-gray-500">Tried ' + data.all_attempts.length + ' key(s) (config + deterministic v0-v10). None matched CMAC.</div>';
                } else {
                  html += '<div class="mt-2 text-xs text-gray-500">No keys available to try. Card may not be programmed for this issuer.</div>';
                }
                details.innerHTML = html;
              }
            } catch (err) {
              dot.className = "h-3 w-3 rounded-full bg-red-400";
              details.innerHTML = '<p class="text-red-300">Error: ' + err.message + '</p>';
            }
          }

          async function fetchJsonAndHandlePayment(url) {
            jsonFetched = false;
            paymentUsed = false;
            callbackUrl = "";
            k1 = "";
            updatePayButtonState();

            try {
              const response = await fetch(url);
              const jsonData = await response.json();

              jsonBox.textContent = JSON.stringify(jsonData, null, 2);
              toggleJsonButton.classList.remove("hidden");

              if (jsonData.tag === "withdrawRequest") {
                callbackUrl = jsonData.callback;
                k1 = jsonData.k1;
                jsonFetched = true;
                lnurlwDetails.innerHTML =
                  '<div class="space-y-2">' +
                  '<div><span class="font-semibold text-gray-100">Callback:</span> <span class="break-all font-mono text-xs text-cyan-300">' + jsonData.callback + '</span></div>' +
                  '<div><span class="font-semibold text-gray-100">K1:</span> <span class="break-all font-mono text-xs text-amber-300">' + jsonData.k1 + '</span></div>' +
                  '<div><span class="font-semibold text-gray-100">Min withdraw:</span> ' + (jsonData.minWithdrawable / 1000) + ' sats</div>' +
                  '<div><span class="font-semibold text-gray-100">Max withdraw:</span> ' + (jsonData.maxWithdrawable / 1000) + ' sats</div>' +
                  '</div>';
                updatePayButtonState();
                return;
              }

              lnurlwDetails.textContent = "The scanned URL did not return a withdrawRequest payload.";
            } catch (error) {
              lnurlwDetails.textContent = "Error fetching JSON: " + error.message;
              showError("Unable to fetch LNURLW response from scanned card URL.");
            }
          }

          async function processPayment() {
            const invoice = invoiceInput.value.trim();
            if (!invoice || !jsonFetched || paymentUsed) {
              return;
            }

            const withdrawUrl = callbackUrl + '?k1=' + k1 + '&pr=' + encodeURIComponent(invoice);

            try {
              const withdrawResponse = await fetch(withdrawUrl);
              const withdrawResult = await withdrawResponse.json();
              const succeeded = withdrawResult.status === "OK";

              setPaymentStatus(
                succeeded ? "Payment successful." : 'Payment failed: ' + (withdrawResult.reason || 'Unknown error'),
                succeeded
              );

              if (succeeded) {
                paymentUsed = true;
                updatePayButtonState();
              }
            } catch {
              setPaymentStatus("Error processing payment.", false);
            }
          }

          function startQrScanner() {
            qrVideo.classList.remove("hidden");
            if (qrScanner) {
              qrScanner.start();
              qrActive = true;
              updateToggleQrButton();
              return;
            }

            qrScanner = new QrScanner(qrVideo, (result) => {
              if (result && result.toLowerCase().startsWith("lnbc")) {
                invoiceInput.value = result;
                updatePayButtonState();
                toggleQrScanner();
              }
            });

            qrScanner.start();
            qrActive = true;
            updateToggleQrButton();
          }

          function stopQrScanner() {
            if (qrScanner) {
              qrScanner.stop();
            }
            qrVideo.classList.add("hidden");
            qrActive = false;
            updateToggleQrButton();
            restartNfc();
          }

          function toggleQrScanner() {
            if (qrActive) {
              stopQrScanner();
            } else {
              startQrScanner();
            }
          }

          document.getElementById("nfc-indicator").addEventListener("click", restartNfc);
          document.getElementById("retry-button").addEventListener("click", restartNfc);
          document.getElementById("toggle-qr-button").addEventListener("click", toggleQrScanner);
          document.getElementById("pay-button").addEventListener("click", processPayment);
          document.getElementById("invoice-input").addEventListener("input", updatePayButtonState);
          document.getElementById("toggle-json-button").addEventListener("click", () => {
            jsonBox.classList.toggle("hidden");
            toggleJsonButton.textContent = jsonBox.classList.contains("hidden") ? "Show raw JSON" : "Hide raw JSON";
          });

          updateToggleQrButton();
          updateNfcIndicator();
          updatePayButtonState();
          window.addEventListener("load", startNfc);
        </script>
`,
  });
}
