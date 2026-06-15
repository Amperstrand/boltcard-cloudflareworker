/**
 * mock-ndef-reader.ts
 *
 * Reusable NDEFReader mock for Playwright E2E tests.
 * Injected via `page.addInitScript()` before page load so that
 * `'NDEFReader' in window` returns true and `new NDEFReader()` works.
 *
 * Communication bridge:
 *   Test -> Page:  `page.evaluate(() => window.__mockNFC.simulateTap(url))`
 *   Page -> Test:  via `page.exposeFunction()` if needed
 *
 * The mock supports multiple concurrent NDEFReader instances (nfc-gate.js
 * creates its own) and handles AbortController signals.
 *
 * Sets `window._nfcPageHandler = true` to prevent nfc-gate.js from
 * creating a competing reader. All NFC event processing is done by
 * the page's own scanner.
 */

/**
 * JavaScript source string injected into the browser via addInitScript.
 * This runs as a classic script BEFORE any page scripts load.
 */
export const MOCK_NDEF_READER_SCRIPT = `
(function installMockNDEFReader() {
  // Prevent nfc-gate.js from creating its own reader.
  // The mock fires onreading on all active readers, so the page's
  // own scanner handles events directly.
  window._nfcPageHandler = true;

  // Bridge object for test harness communication
  window.__mockNFC = {
    simulateTap: null,
    simulateError: null,
    _readers: [],
    _removeReader: null,
  };

  // NDEF URI prefix table (RFC 3944)
  var URI_PREFIX_TABLE = [
    '', 'http://www.', 'https://www.', 'http://', 'https://',
    'tel:', 'mailto:', 'ftp://anonymous:anonymous@', 'ftp://ftp.',
    'ftps://', 'sftp://', 'smb://', 'nfs://', 'ftp://', 'dav://',
    'news:', 'telnet://', 'imap:', 'rtsp://', 'urn:', 'pop:',
    'sip:', 'sips:', 'tftp:', 'btspp://', 'btl2cap://', 'btgoep://',
    'tcpobex://', 'irdaobex://', 'file://', 'urn:epc:id:',
    'urn:epc:tag:', 'urn:epc:pat:', 'urn:epc:raw:', 'urn:epc:', 'urn:nfc:'
  ];

  /**
   * Encode a URL string into an NDEF URL record payload (ArrayBuffer).
   * First byte is the URI prefix code (0x04 = "https://"), rest is UTF-8.
   * Matches the format that a real NTAG424 card produces.
   */
  function encodeNdefUrlRecord(url) {
    var prefixCode = -1;
    for (var i = 0; i < URI_PREFIX_TABLE.length; i++) {
      if (url.indexOf(URI_PREFIX_TABLE[i]) === 0) {
        prefixCode = i;
        break;
      }
    }
    var encoder = new TextEncoder();
    var payload;
    if (prefixCode >= 0) {
      var remainder = url.substring(URI_PREFIX_TABLE[prefixCode].length);
      var body = encoder.encode(remainder);
      payload = new Uint8Array(1 + body.length);
      payload[0] = prefixCode;
      payload.set(body, 1);
    } else {
      payload = encoder.encode(url);
    }
    return payload.buffer;
  }

  function MockNDEFReader() {
    this.onreading = null;
    this.onreadingerror = null;
    this._signal = null;
    this._active = false;
  }

  MockNDEFReader.prototype.scan = function scan(options) {
    var self = this;
    var signal = options && options.signal ? options.signal : null;
    self._signal = signal;

    return new Promise(function(resolve, reject) {
      if (signal && signal.aborted) {
        var abortErr = new DOMException('The operation was aborted.', 'AbortError');
        abortErr.name = 'AbortError';
        reject(abortErr);
        return;
      }

      self._active = true;
      window.__mockNFC._readers.push(self);

      // Listen for abort if signal provided
      if (signal) {
        signal.addEventListener('abort', function() {
          self._active = false;
          var idx = window.__mockNFC._readers.indexOf(self);
          if (idx !== -1) window.__mockNFC._readers.splice(idx, 1);
          var err = new DOMException('The operation was aborted.', 'AbortError');
          err.name = 'AbortError';
          reject(err);
        });
      }

      // Resolve immediately — simulates NFC permission granted
      resolve();
    });
  };

  /**
   * Simulate an NFC tap by firing onreading on all active readers.
   * Produces an NDEF URL record matching real NTAG424 card output.
   *
   * @param {string} url - Full URL (e.g. https://boltcardpoc.psbt.me/?p=XXX&c=YYY)
   * @param {string} [serialNumber] - Mock serial number (colon-separated hex)
   */
  window.__mockNFC.simulateTap = function simulateTap(url, serialNumber) {
    var readers = window.__mockNFC._readers.slice();
    var serial = serialNumber || '04:aa:bb:cc:dd:ee:ff';
    var recordData = encodeNdefUrlRecord(url);

    // Build NDEFReadingEvent-like object matching browser NDEFReader API
    var event = {
      serialNumber: serial,
      message: {
        records: [
          {
            recordType: 'url',
            mediaType: '',
            id: '',
            data: recordData,
            encoding: 'utf-8',
            lang: '',
          },
        ],
      },
    };

    for (var i = 0; i < readers.length; i++) {
      var reader = readers[i];
      if (reader._active && typeof reader.onreading === 'function') {
        try {
          reader.onreading(event);
        } catch (e) {
          // Swallow handler errors — matches real browser behavior
        }
      }
    }
  };

  /**
   * Simulate a reading error on all active readers.
   */
  window.__mockNFC.simulateError = function simulateError() {
    var readers = window.__mockNFC._readers.slice();
    for (var i = 0; i < readers.length; i++) {
      var reader = readers[i];
      if (reader._active && typeof reader.onreadingerror === 'function') {
        try {
          reader.onreadingerror(new Event('readingerror'));
        } catch (e) {
          // Swallow
        }
      }
    }
  };

  /**
   * Remove a reader from the active list (called on abort/cleanup).
   */
  window.__mockNFC._removeReader = function(reader) {
    var idx = window.__mockNFC._readers.indexOf(reader);
    if (idx !== -1) window.__mockNFC._readers.splice(idx, 1);
  };

  // Install globally — makes 'NDEFReader' in window return true
  window.NDEFReader = MockNDEFReader;

  // Without this, canAutoStartNfc() returns false and pages never auto-start scanning
  if (navigator.permissions && navigator.permissions.query) {
    var originalQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = function(desc) {
      if (desc && desc.name === 'nfc') {
        return Promise.resolve({ state: 'granted', onchange: null });
      }
      return originalQuery(desc);
    };
  }
})();
`;

/**
 * Build a boltcard NFC URL from base URL and encrypted params.
 */
export function buildNfcUrl(baseUrl: string, p: string, c: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("p", p);
  url.searchParams.set("c", c);
  return url.toString();
}
