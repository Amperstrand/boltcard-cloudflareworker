export default async function handleNfc() {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Bolt Card Scanner (LUD-03)</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-100 flex items-center justify-center min-h-screen">
      <div class="max-w-md w-full bg-white shadow-lg rounded-xl p-6">
        
        <img id="profile-picture" src="" alt="User Profile" class="hidden w-20 h-20 rounded-full mx-auto mb-4">

        <h1 class="text-2xl font-bold text-center text-gray-800">Bolt Card Scanner (LUD-03)</h1>

        <h3 class="text-lg font-semibold text-gray-700 mt-4">Enter BOLT11 Invoice</h3>
        <div class="flex space-x-2 mt-2">
          <input type="text" id="invoice-input" 
                 class="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                 placeholder="Enter BOLT11 Invoice here" oninput="updatePayButtonState()" />
        </div>
        
        <button id="pay-button"
                class="w-full bg-blue-600 text-white font-medium py-2 rounded-md mt-3 hidden disabled:bg-gray-400"
                disabled>
          Pay Invoice
        </button>
        <div id="payment-status" class="mt-2 text-sm font-bold"></div>

        <h3 class="text-lg font-semibold text-gray-700 mt-6">NDEF Data</h3>
        <div id="ndef-box" class="p-3 bg-gray-200 rounded-md text-gray-700 mt-2">
          Waiting for NFC scan...
        </div>

        <h3 class="text-lg font-semibold text-gray-700 mt-6">LNURLW Payment Details</h3>
        <div id="lnurlw-details" class="p-3 bg-gray-200 rounded-md text-gray-700 mt-2">
          Scan NFC to fetch payment data...
        </div>

        <button id="toggle-json-button" 
                class="w-full bg-gray-600 text-white font-medium py-2 rounded-md mt-3 hidden">
          Show Full JSON
        </button>
        <div id="json-box" class="p-3 bg-gray-200 rounded-md text-gray-700 mt-2 hidden"></div>

        <button id="retry-button" 
                class="w-full bg-red-600 text-white font-medium py-2 rounded-md mt-3 hidden">
          Start NFC Scan
        </button>
        <div id="error-message" class="text-red-600 font-bold mt-3 hidden"></div>
      </div>

      <script>
        let lastScannedUrl = "";
        let callbackUrl = "";
        let k1 = "";
        let jsonFetched = false;
        let paymentUsed = false;

        async function startScanning() {
          const errorBox = document.getElementById('error-message');
          const retryButton = document.getElementById('retry-button');

          try {
            const ndef = new NDEFReader();
            await ndef.scan();

            ndef.onreading = async (event) => {
              const decoder = new TextDecoder();
              let nfcData = decoder.decode(event.message.records[0].data);

              if (nfcData.startsWith("lnurlw://")) {
                nfcData = "https://" + nfcData.substring(9);
              }

              document.getElementById('ndef-box').textContent = nfcData;

              if (nfcData.startsWith("https://") && nfcData !== lastScannedUrl) {
                lastScannedUrl = nfcData;
                fetchJsonAndHandlePayment(nfcData);
              }
            };
          } catch (error) {
            if (error.name === "NotAllowedError") {
              errorBox.classList.remove("hidden");
              errorBox.textContent = "NFC permission denied. Click 'Start NFC Scan' to try again.";
              retryButton.classList.remove("hidden");
              retryButton.addEventListener("click", startScanning);
            } else {
              document.getElementById('ndef-box').textContent = "Error: " + error.message;
            }
          }
        }

        async function fetchJsonAndHandlePayment(url) {
          try {
            const response = await fetch(url);
            const jsonData = await response.json();
            jsonFetched = true;
            paymentUsed = false;

            document.getElementById('json-box').textContent = JSON.stringify(jsonData, null, 2);
            document.getElementById('toggle-json-button').classList.remove("hidden");

            document.getElementById('toggle-json-button').onclick = () => {
              document.getElementById('json-box').classList.toggle("hidden");
            };

            if (jsonData.tag === "withdrawRequest") {
              callbackUrl = jsonData.callback;
              k1 = jsonData.k1;
              
              if (k1) {
                updateProfilePicture(k1);
              }

              document.getElementById('lnurlw-details').innerHTML = 
                \`<b>Callback:</b> \${callbackUrl}<br>
                 <b>K1:</b> \${k1}<br>
                 <b>Min Withdraw:</b> \${jsonData.minWithdrawable / 1000} sats<br>
                 <b>Max Withdraw:</b> \${jsonData.maxWithdrawable / 1000} sats\`;

              if (!callbackUrl || !k1) return;

              document.getElementById('pay-button').classList.remove("hidden");
              document.getElementById('pay-button').onclick = processPayment;
            }
          } catch (error) {
            document.getElementById('lnurlw-details').textContent = "Error fetching JSON: " + error.message;
          }
        }

        function updateProfilePicture(k1) {
          let hash = 0;
          for (let i = 0; i < k1.length; i++) {
            hash = (hash * 31 + k1.charCodeAt(i)) % 11;
          }
          const profilePicture = document.getElementById('profile-picture');
          profilePicture.src = \`https://randomuser.me/api/portraits/thumb/women/\${hash}.jpg\`;
          profilePicture.style.display = "block";
        }

        function updatePayButtonState() {
          const invoiceInput = document.getElementById('invoice-input').value.trim();
          const payButton = document.getElementById('pay-button');
          payButton.disabled = invoiceInput === "";
        }

        async function processPayment() {
          const invoiceInput = document.getElementById('invoice-input').value.trim();
          if (!invoiceInput || !jsonFetched || paymentUsed) return;

          const withdrawUrl = \`\${callbackUrl}?k1=\${k1}&pr=\${encodeURIComponent(invoiceInput)}\`;

          try {
            const withdrawResponse = await fetch(withdrawUrl);
            const withdrawResult = await withdrawResponse.json();
            const paymentStatus = document.getElementById('payment-status');

            paymentStatus.style.display = "block";
            paymentStatus.textContent = withdrawResult.status === "OK" ? "Payment Successful!" : "Payment Failed: " + withdrawResult.reason;
            paymentStatus.style.color = withdrawResult.status === "OK" ? "green" : "red";

            if (withdrawResult.status === "OK") {
              paymentUsed = true;
              document.getElementById('pay-button').classList.add("hidden");
            }
          } catch {
            document.getElementById('payment-status').textContent = "Error processing payment.";
          }
        }

        window.onload = startScanning;
      </script>
    </body>
    </html>
  `;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}
