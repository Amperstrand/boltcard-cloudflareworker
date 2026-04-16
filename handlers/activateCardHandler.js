import { getDeterministicKeys } from "../keygenerator.js";
import { resetReplayProtection } from "../replayProtection.js";
import { logger } from "../utils/logger.js";

/**
 * Serves the card activation page
 * @returns {Response} HTML page for card activation
 */
export function handleActivateCardPage() {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>BoltCard Activation</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
          line-height: 1.6;
        }
        h1 {
          color: #333;
          margin-bottom: 20px;
        }
        .card {
          background-color: #f9f9f9;
          border-radius: 8px;
          padding: 20px;
          margin-bottom: 20px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .form-group {
          margin-bottom: 15px;
        }
        label {
          display: block;
          margin-bottom: 5px;
          font-weight: bold;
        }
        input[type="text"] {
          width: 100%;
          padding: 8px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 16px;
        }
        button {
          background-color: #007bff;
          color: white;
          border: none;
          padding: 10px 15px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 16px;
          margin-right: 10px;
        }
        button:hover {
          background-color: #0069d9;
        }
        .error {
          color: #dc3545;
          margin-top: 10px;
        }
        .success {
          color: #28a745;
          margin-top: 10px;
        }
        .button-row {
          display: flex;
          margin-bottom: 15px;
        }
        #nfc-status {
          margin-top: 10px;
          padding: 10px;
          border-radius: 4px;
        }
        #nfc-status.scanning {
          background-color: #fff3cd;
          color: #856404;
        }
        #nfc-status.success {
          background-color: #d4edda;
          color: #155724;
        }
        #nfc-status.error {
          background-color: #f8d7da;
          color: #721c24;
        }
      </style>
    </head>
    <body>
      <h1>BoltCard Activation</h1>
      
      <div class="card">
        <h2>Activate New Card</h2>
        <p>Enter your card's UID below or scan it with NFC to activate it with the fake wallet payment method.</p>
        
        <div id="nfc-section">
          <div class="button-row">
            <button id="scan-nfc" type="button">Scan Card with NFC</button>
          </div>
          <div id="nfc-status" style="display: none;"></div>
        </div>
        
        <form id="activateForm" action="/activate" method="POST">
          <div class="form-group">
            <label for="uid">Card UID (7 bytes, 14 hex characters):</label>
            <input type="text" id="uid" name="uid" placeholder="e.g., 04a39493cc8680" required
                   pattern="[0-9a-fA-F]{14}" title="UID must be exactly 14 hexadecimal characters">
          </div>
          
          <button type="submit">Activate Card with Fake Wallet</button>
        </form>
        
        <div id="result"></div>
      </div>

      <script>
        // NFC Scanning functionality
        document.getElementById('scan-nfc').addEventListener('click', async function() {
          const nfcStatus = document.getElementById('nfc-status');
          const uidInput = document.getElementById('uid');
          
          // Reset status display
          nfcStatus.style.display = 'block';
          nfcStatus.className = 'scanning';
          nfcStatus.textContent = 'Please tap your card on the device...';
          
          try {
            if (!('NDEFReader' in window)) {
              throw new Error('NFC is not supported in this browser or device.');
            }
            
            const ndef = new NDEFReader();
            await ndef.scan();
            
            ndef.onreading = (event) => {
              // The serialNumber contains the UID of the card
              if (event.serialNumber) {
                // Clean up the UID format - remove colons and convert to lowercase
                const formattedUid = event.serialNumber.replace(/:/g, '').toLowerCase();
                
                // Verify the UID is correct length after cleaning
                if (!/^[0-9a-f]{14}$/.test(formattedUid)) {
                  nfcStatus.className = 'error';
                  nfcStatus.textContent = 'Invalid UID format after processing. Expected 14 hex characters.';
                  return;
                }
                
                // Update the input field with the formatted UID
                uidInput.value = formattedUid;
                
                // Update status
                nfcStatus.className = 'success';
                nfcStatus.textContent = 'Successfully scanned card UID: ' + formattedUid;
              } else {
                nfcStatus.className = 'error';
                nfcStatus.textContent = 'Could not read UID from card. Please try again.';
              }
            };
            
            ndef.onreadingerror = () => {
              nfcStatus.className = 'error';
              nfcStatus.textContent = 'Error reading NFC card. Please try again.';
            };
            
          } catch (error) {
            nfcStatus.className = 'error';
            nfcStatus.textContent = \`Error: \${error.message}\`;
            console.error('NFC Error:', error);
          }
        });

        // Form submission handling
        document.getElementById('activateForm').addEventListener('submit', async function(e) {
          e.preventDefault();
          const result = document.getElementById('result');
          
          const formData = new FormData(this);
          const data = {};
          formData.forEach((value, key) => {
            // Strip colons and convert to lowercase for the UID field
            data[key] = key === 'uid' ? value.replace(/:/g, '').toLowerCase() : value;
          });
          
          // Validate UID format after stripping colons
          if (!/^[0-9a-f]{14}$/.test(data.uid)) {
            result.className = 'error';
            result.textContent = 'Error: UID must be exactly 7 bytes (14 hex characters)';
            return;
          }

          try {
            const response = await fetch('/activate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data)
            });
            
            const responseData = await response.json();
            
            if (response.ok) {
              result.className = 'success';
              result.textContent = 'Card activated successfully! ' + responseData.message;
            } else {
              result.className = 'error';
              result.textContent = 'Error: ' + responseData.reason;
            }
          } catch (error) {
            result.className = 'error';
            result.textContent = 'Error submitting form: ' + error.message;
          }
        });
      </script>
    </body>
    </html>
  `;

  return new Response(html, {
    headers: { "Content-Type": "text/html" }
  });
}

/**
 * Handle card activation form submission
 * 
 * The activation process works as follows:
 * 1. Receive card UID from the form submission
 * 2. Generate deterministic cryptographic keys for the card
 * 3. Create a configuration object with fakewallet payment method
 * 4. Store configuration in Cloudflare KV storage for persistence
 * 
 * @param {Request} request - The incoming request with form data
 * @param {object} env - Environment variables including KV bindings
 * @returns {Response} JSON response indicating success or failure
 */
export async function handleActivateCardSubmit(request, env) {
  try {
    // Test KV write access first
    logger.trace("Testing KV write access before activation");
    const testResult = await testKvAccess(env);
    if (!testResult.success) {
      logger.error("KV write test failed", { error: testResult.error });
      return new Response(
        JSON.stringify({ 
          status: "ERROR", 
          reason: `KV access test failed: ${testResult.error}` 
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    logger.trace("KV write test succeeded");
    
    // Parse the JSON request body
    const data = await request.json();
    
    // Validate the UID
    const uid = data.uid?.toLowerCase();
    if (!uid || !/^[0-9a-f]{14}$/.test(uid)) {
      return new Response(
        JSON.stringify({ 
          status: "ERROR", 
          reason: "Invalid UID format. Must be 14 hexadecimal characters (7 bytes)." 
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    
    // Generate deterministic keys for the UID
    const keys = await getDeterministicKeys(uid, env);
    if (!keys || !keys.k2) {
      return new Response(
        JSON.stringify({ status: "ERROR", reason: "Failed to generate keys for the UID." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    
    logger.debug("Generated deterministic keys for activation", { uid });
    await resetReplayProtection(env, uid);
    
    // Create configuration with fakewallet payment method
    const config = {
      K2: keys.k2,
      payment_method: "fakewallet"
    };
    
    logger.trace("Preparing to save activated card config", {
      uid,
      paymentMethod: config.payment_method,
      hasUidConfigBinding: Boolean(env?.UID_CONFIG),
    });
    
    // Store in Cloudflare KV storage
    if (env && env.UID_CONFIG) {
      try {
        logger.trace("Writing activated card config to KV", { uid });
        await env.UID_CONFIG.put(uid, JSON.stringify(config));
        logger.debug("Activated card config written to KV", { uid });
        
        // Verify the config was saved correctly
        const savedConfig = await env.UID_CONFIG.get(uid);
        logger.trace("Verified KV write for activated card", {
          uid,
          verified: savedConfig === JSON.stringify(config),
        });
        
        return new Response(
          JSON.stringify({ 
            status: "SUCCESS", 
            message: `Card with UID ${uid} has been activated with fakewallet payment method.`,
            uid: uid,
            config: config
          }),
          { status: 201, headers: { "Content-Type": "application/json" } } // Changed to 201 Created
        );
      } catch (error) {
        logger.error("Failed to save activated card config", { uid, error: error.message });
        return new Response(
          JSON.stringify({ 
            status: "ERROR", 
            reason: `Failed to save card configuration: ${error.message}` 
          }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    } else {
      logger.error("KV storage is not available for activation", {
        hasEnv: Boolean(env),
        hasUidConfigBinding: Boolean(env?.UID_CONFIG),
      });
      return new Response(
        JSON.stringify({ 
          status: "ERROR", 
          reason: "KV storage is not available. Cannot activate card." 
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    logger.error("Error activating card", { error: error.message });
    return new Response(
      JSON.stringify({ status: "ERROR", reason: `Server error: ${error.message}` }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * Test KV access to diagnose writing issues
 */
async function testKvAccess(env) {
  try {
    logger.trace("Checking KV environment for activation", {
      hasEnv: !!env,
      hasUidConfig: !!(env && env.UID_CONFIG),
      // Check if the KV object has expected methods
      isKvObject: !!(env && env.UID_CONFIG && typeof env.UID_CONFIG.put === 'function')
    });
    
    // First check if UID_CONFIG exists in env
    if (!env || !env.UID_CONFIG) {
      // Try accessing global UID_CONFIG as a fallback (older Workers runtime)
      if (typeof UID_CONFIG !== 'undefined') {
        logger.warn("Using global UID_CONFIG fallback binding");
        env = { UID_CONFIG };
      } else {
        return { 
          success: false, 
          error: "UID_CONFIG binding not found in environment" 
        };
      }
    }
    
    // Try a simple write and read
    const testKey = "kvtest_" + new Date().getTime();
    const testValue = "test_value_" + new Date().getTime();
    
    await env.UID_CONFIG.put(testKey, testValue);
    logger.trace("KV test write completed", { testKey });
    
    const readValue = await env.UID_CONFIG.get(testKey);
    logger.trace("KV test read completed", { testKey, readMatched: readValue === testValue });
    
    if (readValue !== testValue) {
      return {
        success: false,
        error: `Write verification failed: expected "${testValue}" but got "${readValue}"`
      };
    }
    
    return { success: true };
  } catch (error) {
    logger.error("KV test error during activation", { error: error.message });
    return { 
      success: false, 
      error: error.message
    };
  }
}
