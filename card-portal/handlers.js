import { hexToBytes, bytesToHex } from '../cryptoutils.js';

const SESSION_TTL = 300;

function generateSessionToken(uid, card, backend) {
  const header = {
    uid,
    counter: card.counter,
    exp: Math.floor(Date.now() / 1000) + parseInt(SESSION_TTL),
    backend: card.backend.primary
  };
  const encoded = btoa(JSON.stringify(header));
  return encoded;
}

function validateSessionToken(token, uid, env) {
  try {
    const decoded = JSON.parse(atob(token));
    const now = Math.floor(Date.now() / 1000);

    if (decoded.exp < now) {
      return { valid: false, error: 'Session expired' };
    }

    if (decoded.uid !== uid) {
      return { valid: false, error: 'UID mismatch' };
    }

    return { valid: true, decoded };
  } catch (e) {
    return { valid: false, error: 'Invalid session' };
  }
}

export async function handleCardPage() {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BoltCard Portal</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    .card-info { background: #f9f9f9; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
    .section { margin-bottom: 15px; }
    .key-row { display: flex; justify-content: space-between; margin: 5px 0; font-family: monospace; }
    .label { font-weight: bold; }
    .value { word-break: break-all; }
    .status { padding: 4px 8px; border-radius: 4px; font-size: 12px; }
    .status.active { background: #28a745; color: white; }
    .status.disabled { background: #dc3545; color: white; }
    button { background: #007bff; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; }
    button:hover { background: #0056b3; }
  </style>
</head>
<body>
  <h1>📱 Tap Your Card</h1>
  <p>Bring your BoltCard close to the reader to view your keys and settings.</p>

  <div id="loading" style="display: none;">Loading card information...</div>

  <div id="card-info" class="card-info" style="display: none;">
    <h2>Card Information</h2>
    <div class="section">
      <div class="label">UID:</div>
      <div class="value" id="uid"></div>
    </div>
    <div class="section">
      <div class="label">Status:</div>
      <div class="value"><span id="status" class="status"></span></div>
    </div>
    <div class="section">
      <div class="label">Backend:</div>
      <div class="value" id="backend-name"></div>
    </div>
    <div class="section">
      <div class="label">Counter:</div>
      <div class="value" id="counter"></div>
    </div>
    <h3>Cryptographic Keys</h3>
    <div class="section">
      <div class="key-row">
        <div class="label">K0:</div>
        <div class="value" id="k0"></div>
      </div>
      <div class="key-row">
        <div class="label">K1:</div>
        <div class="value" id="k1"></div>
      </div>
      <div class="key-row">
        <div class="label">K2:</div>
        <div class="value" id="k2"></div>
      </div>
      <div class="key-row">
        <div class="label">K3:</div>
        <div class="value" id="k3"></div>
      </div>
      <div class="key-row">
        <div class="label">K4:</div>
        <div class="value" id="k4"></div>
      </div>
    </div>
  </div>

  <script>
    let nfcReader = null;
    let ndef = null;

    async function startNFC() {
      if ('NDEFReader' in window) {
        ndef = new NDEFReader();
        await ndef.scan();
      } else {
        showError('NFC is not supported in this browser');
        return false;
      }

      ndef.onreading = (event) => {
        const records = event.message.records;
        for (const record of records) {
          try {
            const decoder = new TextDecoder();
            const data = decoder.decode(record.data);

            if (data.startsWith('lnurlw://')) {
              const url = new URL('https://' + data.substring(9));
              const p = url.searchParams.get('p');
              const c = url.searchParams.get('c');

              if (p && c) {
                authenticateCard(p, c);
              }
            }
          } catch (e) {
            console.error('Error reading NFC record:', e);
          }
        }
      };

      ndef.onreadingerror = () => {
        showError('Error reading card. Please try again.');
      };

      return true;
    }

    async function authenticateCard(p, c) {
      try {
        const response = await fetch('/card/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p, c })
        });

        const result = await response.json();

        if (result.success) {
          const token = result.session;
          document.cookie = \`session=\${token}; path=/; max-age=\${SESSION_TTL}\`;
          await loadCardInfo();
        } else {
          showError(result.error || 'Authentication failed');
        }
      } catch (e) {
        showError('Authentication error: ' + e.message);
      }
    }

    async function loadCardInfo() {
      try {
        const response = await fetch('/card/info', {
          method: 'GET',
          headers: {
            'Cookie': document.cookie
          }
        });

        const result = await response.json();

        if (result.card) {
          const card = result.card;
          document.getElementById('uid').textContent = card.uid;
          document.getElementById('backend-name').textContent = card.backend.name || 'Not configured';
          document.getElementById('counter').textContent = card.counter;
          document.getElementById('k0').textContent = card.keys.K0;
          document.getElementById('k1').textContent = card.keys.K1;
          document.getElementById('k2').textContent = card.keys.K2;
          document.getElementById('k3').textContent = card.keys.K3;
          document.getElementById('k4').textContent = card.keys.K4;

          const statusElement = document.getElementById('status');
          statusElement.textContent = card.status.toUpperCase();
          statusElement.className = 'status ' + card.status;

          document.getElementById('loading').style.display = 'none';
          document.getElementById('card-info').style.display = 'block';
        } else {
          showError('Failed to load card information');
        }
      } catch (e) {
        showError('Error loading card: ' + e.message);
      }
    }

    function showError(message) {
      const errorDiv = document.createElement('div');
      errorDiv.style.cssText = 'color: #dc3545; padding: 10px; border-radius: 4px; margin: 20px 0;';
      errorDiv.textContent = '❌ ' + message;
      document.getElementById('loading').style.display = 'none';
      document.getElementById('card-info').style.display = 'none';
      document.body.appendChild(errorDiv);
      setTimeout(() => errorDiv.remove(), 5000);
    }

    document.addEventListener('DOMContentLoaded', () => {
      startNFC();
    });
  </script>
</body>
</html>
  `;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html' }
  });
}

export async function handleCardAuth(request, env) {
  try {
    const { p, c } = await request.json();

    if (!p || !c) {
      return new Response(JSON.stringify({ error: 'Missing p or c parameters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const cardStub = env.CARD_OBJECTS.get(env.CARD_OBJECTS.idFromName('CardDO'));
    const cardRecord = await cardStub.getCard();

    if (!cardRecord) {
      return new Response(JSON.stringify({ error: 'Card not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const cardData = JSON.parse(cardRecord.card);
    const { uidHex, ctr } = await extractUIDAndCounter(p);

    const validation = await validate_cmac(
      hexToBytes(uidHex),
      hexToBytes(ctr),
      c,
      hexToBytes(cardData.keys.K2)
    );

    if (!validation.cmac_validated) {
      return new Response(JSON.stringify({ error: 'CMAC validation failed' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const token = generateSessionToken(cardData.uid, cardRecord);

    return new Response(JSON.stringify({
      success: true,
      session: token,
      card: {
        uid: cardData.uid,
        keys: {
          K0: cardData.keys_enc.K0,
          K1: cardData.keys_enc.K1,
          K2: cardData.keys_enc.K2,
          K3: cardData.keys_enc.K3,
          K4: cardData.keys_enc.K4
        },
        counter: cardRecord.counter,
        status: cardRecord.status,
        backend: { primary: cardRecord.backend.primary },
        createdAt: cardRecord.createdAt,
        updatedAt: cardRecord.updatedAt
      }
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `session=${token}; path=/; max-age=${SESSION_TTL}`
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Server error: ' + e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}


export async function handleCardInfo(request, env) {
  const sessionCookie = getCookies(request).session;
  if (!sessionCookie) {
    return new Response(JSON.stringify({ error: 'No active session' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const decoded = JSON.parse(atob(sessionCookie));
    const now = Math.floor(Date.now() / 1000);

    if (decoded.exp < now) {
      return new Response(JSON.stringify({ error: 'Session expired' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const cardStub = env.CARD_OBJECTS.get(env.CARD_OBJECTS.idFromName('CardDO'));
    const card = await cardStub.getCard();

    if (!card) {
      return new Response(JSON.stringify({ error: 'Card not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const cardData = JSON.parse(card.card);
    const cardInfo = {
      uid: card.uid,
      keys: {
        K0: cardData.keys_enc.K0,
        K1: cardData.keys_enc.K1,
        K2: cardData.keys_enc.K2,
        K3: cardData.keys_enc.K3,
        K4: cardData.keys_enc.K4
      },
      counter: card.counter,
      status: card.status,
      backend: { primary: card.backend.primary },
      createdAt: card.createdAt,
      updatedAt: card.updatedAt
    };

    return new Response(JSON.stringify({ card: cardInfo }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

function getCookies(request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const cookies = {};
  cookieHeader.split(';').forEach(cookie => {
    const [name, value] = cookie.trim().split('=');
    if (name && value) {
      cookies[name] = value;
    }
  });
  return cookies;
}

async function extractUIDAndCounter(p) {
  return new Promise((resolve, reject) => {
    reject('Not implemented - requires extraction logic');
  });
}
