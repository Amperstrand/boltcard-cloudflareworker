export function handleActivatePage(request) {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const pullPaymentId = url.searchParams.get("pullPaymentId") || "fUDXsnySxvb5LYZ1bSLiWzLjVuT";
  const apiUrl = `${baseUrl}/api/v1/pull-payments/${pullPaymentId}/boltcards`;
  
  const programUrl = `${apiUrl}?onExisting=UpdateVersion`;
  const resetUrl = `${apiUrl}?onExisting=KeepVersion`;

  const programDeepLink = `boltcard://program?url=${encodeURIComponent(programUrl)}`;
  const resetDeepLink = `boltcard://reset?url=${encodeURIComponent(resetUrl)}`;

  const html = `
    <!DOCTYPE html>
    <html lang="en" class="dark">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>BoltCard Activate</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
        <style>
          body { background-color: #111827; color: #f3f4f6; }
          .qr-container { display: inline-block; padding: 10px; background: white; border-radius: 8px; margin-top: 10px; }
        </style>
      </head>
      <body class="min-h-screen p-4 md:p-8 font-sans antialiased flex flex-col items-center">
        <div class="max-w-4xl w-full bg-gray-800 border border-gray-700 shadow-xl rounded-lg p-6 md:p-8">
          
          <div class="flex items-center justify-between border-b border-gray-700 pb-4 mb-6">
            <h1 class="text-2xl md:text-3xl font-bold text-amber-500 tracking-tight">CARD ACTIVATION</h1>
            <span class="px-3 py-1 bg-amber-500/10 text-amber-500 text-sm font-mono rounded border border-amber-500/20">OPERATOR MODE</span>
          </div>

          <div class="mb-8 space-y-4">
            <h2 class="text-lg font-semibold text-gray-300">API CONFIGURATION</h2>
            <div class="bg-gray-900 rounded p-4 border border-gray-700 font-mono text-sm break-all flex justify-between items-center group">
              <span id="api-url" class="text-gray-400">${apiUrl}</span>
              <button onclick="copyText('api-url')" class="ml-4 text-gray-500 hover:text-amber-500 focus:outline-none transition-colors">
                COPY
              </button>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
            <!-- Program Card -->
            <div class="bg-gray-900 border border-gray-700 rounded-lg p-6 flex flex-col items-center">
              <h3 class="text-xl font-bold text-gray-200 mb-2">PROGRAM</h3>
              <p class="text-sm text-gray-400 mb-6 text-center">Initialize a blank or wiped NFC card</p>
              
              <div id="qr-program" class="qr-container mb-6"></div>
              
              <a href="${programDeepLink}" class="w-full text-center bg-amber-600 hover:bg-amber-500 text-white font-bold py-3 px-4 rounded transition-colors mb-3 shadow-[0_0_15px_rgba(217,119,6,0.2)]">
                OPEN PROGRAM APP
              </a>
              
              <div class="w-full bg-black/50 rounded p-3 border border-gray-800 flex justify-between items-center group mt-auto">
                <span id="link-program" class="font-mono text-xs text-gray-500 truncate mr-2">${programDeepLink}</span>
                <button onclick="copyText('link-program')" class="text-gray-600 hover:text-amber-500 text-xs font-bold shrink-0 transition-colors">
                  COPY LINK
                </button>
              </div>
            </div>

            <!-- Reset Card -->
            <div class="bg-gray-900 border border-gray-700 rounded-lg p-6 flex flex-col items-center">
              <h3 class="text-xl font-bold text-gray-200 mb-2">RESET</h3>
              <p class="text-sm text-gray-400 mb-6 text-center">Re-provision an existing card</p>
              
              <div id="qr-reset" class="qr-container mb-6"></div>
              
              <a href="${resetDeepLink}" class="w-full text-center border-2 border-amber-600 text-amber-500 hover:bg-amber-600 hover:text-white font-bold py-3 px-4 rounded transition-all mb-3">
                OPEN RESET APP
              </a>
              
              <div class="w-full bg-black/50 rounded p-3 border border-gray-800 flex justify-between items-center group mt-auto">
                <span id="link-reset" class="font-mono text-xs text-gray-500 truncate mr-2">${resetDeepLink}</span>
                <button onclick="copyText('link-reset')" class="text-gray-600 hover:text-amber-500 text-xs font-bold shrink-0 transition-colors">
                  COPY LINK
                </button>
              </div>
            </div>
          </div>

          <div class="border-t border-gray-700 pt-6">
            <h2 class="text-lg font-semibold text-gray-300 mb-4">JSON API (MASS ACTIVATION)</h2>
            <div class="space-y-4">
              <div class="bg-gray-900 border border-gray-800 rounded p-4">
                <div class="flex justify-between items-center mb-2">
                  <span class="text-xs font-bold text-gray-500 uppercase">Program via UID</span>
                  <button onclick="copyText('curl-program')" class="text-xs text-amber-500 hover:text-amber-400 font-bold">COPY</button>
                </div>
                <pre id="curl-program" class="font-mono text-xs text-green-400 overflow-x-auto">curl -X POST '${programUrl}' \\
  -H "Content-Type: application/json" \\
  -d '{"UID": "04a39493cc8680"}'</pre>
              </div>

              <div class="bg-gray-900 border border-gray-800 rounded p-4">
                <div class="flex justify-between items-center mb-2">
                  <span class="text-xs font-bold text-gray-500 uppercase">Reset via LNURLW</span>
                  <button onclick="copyText('curl-reset')" class="text-xs text-amber-500 hover:text-amber-400 font-bold">COPY</button>
                </div>
                <pre id="curl-reset" class="font-mono text-xs text-blue-400 overflow-x-auto">curl -X POST '${resetUrl}' \\
  -H "Content-Type: application/json" \\
  -d '{"LNURLW": "lnurlw://..."}'</pre>
              </div>
            </div>
          </div>
          
        </div>
        
        <div id="toast" class="fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow-lg transform translate-y-20 opacity-0 transition-all duration-300 font-medium z-50">
          Copied to clipboard
        </div>

        <script>
          // Generate QR Codes
          document.addEventListener('DOMContentLoaded', () => {
            const qrProgramOptions = {
              text: "${programDeepLink}",
              width: 200,
              height: 200,
              colorDark : "#000000",
              colorLight : "#ffffff",
              correctLevel : QRCode.CorrectLevel.L
            };
            new QRCode(document.getElementById("qr-program"), qrProgramOptions);

            const qrResetOptions = {
              text: "${resetDeepLink}",
              width: 200,
              height: 200,
              colorDark : "#000000",
              colorLight : "#ffffff",
              correctLevel : QRCode.CorrectLevel.L
            };
            new QRCode(document.getElementById("qr-reset"), qrResetOptions);
          });

          // Copy function
          function copyText(elementId) {
            const el = document.getElementById(elementId);
            const text = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? el.value : el.innerText;
            navigator.clipboard.writeText(text).then(() => {
              showToast();
            }).catch(err => {
              console.error('Failed to copy text: ', err);
            });
          }

          function showToast() {
            const toast = document.getElementById('toast');
            toast.classList.remove('translate-y-20', 'opacity-0');
            setTimeout(() => {
              toast.classList.add('translate-y-20', 'opacity-0');
            }, 2000);
          }
        </script>
      </body>
    </html>
  `;

  return new Response(html, { 
    status: 200, 
    headers: { "Content-Type": "text/html" } 
  });
}
