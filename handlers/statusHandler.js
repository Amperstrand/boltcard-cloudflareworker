export async function handleStatus() {
  // The base route for "program" or "reset"
  const BASE_URL =
    "https://boltcardpoc.psbt.me/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards";

  // Program link => ?onExisting=UpdateVersion
  const programUrl = `${BASE_URL}?onExisting=UpdateVersion`;
  // Reset link => ?onExisting=KeepVersion
  const resetUrl = `${BASE_URL}?onExisting=KeepVersion`;

  // Build the boltcard:// deep links:
  const deeplinkProgram = `boltcard://program?url=${encodeURIComponent(programUrl)}`;
  const deeplinkReset = `boltcard://reset?url=${encodeURIComponent(resetUrl)}`;

  // Simple HTML page with clickable links & QR codes
  const htmlContent = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Boltcard Setup</title>
    <style>
      body { font-family: Arial, sans-serif; text-align: center; margin: 50px; }
      .action { margin-bottom: 40px; }
      .qr-code { margin-top: 10px; }
    </style>
  </head>
  <body>
    <h1>Boltcard Setup/Reset</h1>

    <div class="action">
      <h2>Program Boltcard</h2>
      <p><a href="${deeplinkProgram}" target="_blank">${deeplinkProgram}</a></p>
      <p>Scan this QR code to open the Boltcard NFC Programmer:</p>
      <img class="qr-code"
           src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(deeplinkProgram)}"
           alt="Program Boltcard QR">
    </div>

    <div class="action">
      <h2>Reset Boltcard</h2>
      <p><a href="${deeplinkReset}" target="_blank">${deeplinkReset}</a></p>
      <p>Scan this QR code to open the Boltcard NFC Programmer:</p>
      <img class="qr-code"
           src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(deeplinkReset)}"
           alt="Reset Boltcard QR">
    </div>
  </body>
  </html>
  `;

  return new Response(htmlContent, {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}
