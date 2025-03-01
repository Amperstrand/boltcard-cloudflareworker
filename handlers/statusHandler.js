export async function handleStatus() {
  const BASE_URL =
    "https://boltcardpoc.psbt.me/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards";

  // Create the deep links
  const programUrl = `${BASE_URL}?onExisting=UpdateVersion`;
  const resetUrl = `${BASE_URL}?onExisting=KeepVersion`;

  // Encode for href attribute
  const encodedProgramUrl = encodeURIComponent(programUrl);
  const encodedResetUrl = encodeURIComponent(resetUrl);

  // Boltcard NFC Programmer deep links
  const deeplinkProgram = `boltcard://program?url=${encodedProgramUrl}`;
  const deeplinkReset = `boltcard://reset?url=${encodedResetUrl}`;

  // Decode the links for display (removes %2F, %3D, etc.)
  const humanReadableProgramUrl = decodeURIComponent(deeplinkProgram);
  const humanReadableResetUrl = decodeURIComponent(deeplinkReset);

  // HTML content with human-readable links
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
      <p>
        <a href="${deeplinkProgram}" target="_blank">${humanReadableProgramUrl}</a>
      </p>
      <p>Scan this QR code to open the Boltcard NFC Programmer:</p>
      <img class="qr-code"
           src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodedProgramUrl}"
           alt="Program Boltcard QR">
    </div>

    <div class="action">
      <h2>Reset Boltcard</h2>
      <p>
        <a href="${deeplinkReset}" target="_blank">${humanReadableResetUrl}</a>
      </p>
      <p>Scan this QR code to open the Boltcard NFC Programmer:</p>
      <img class="qr-code"
           src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodedResetUrl}"
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
