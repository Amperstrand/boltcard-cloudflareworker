(function () {
  "use strict";

  var elIdle = document.getElementById("state-idle");
  var elLoading = document.getElementById("state-loading");
  var elIssued = document.getElementById("state-issued");
  var elError = document.getElementById("state-error");
  var elNfcStatus = document.getElementById("nfc-status");
  var elScanHint = document.getElementById("scan-hint");
  var elNoNfc = document.getElementById("no-nfc-msg");

  function showState(el) {
    [elIdle, elLoading, elIssued, elError].forEach(function (s) {
      s.classList.add("hidden");
      s.classList.add("opacity-0");
    });
    el.classList.remove("hidden");
    el.classList.remove("opacity-0");
  }

  function showError(msg) {
    var elMsg = document.getElementById("error-msg");
    elMsg.textContent = msg || "Unknown error";
    showState(elError);
  }

  var lastP = null;
  var lastC = null;

  async function issueCredential(p, c, alg) {
    showState(elLoading);
    var url = "/api/credential?p=" + encodeURIComponent(p) + "&c=" + encodeURIComponent(c);
    if (alg) url += "&alg=" + encodeURIComponent(alg);
    try {
      var resp = await fetch(url);
      if (!resp.ok) {
        var errBody = await resp.json().catch(function () { return {}; });
        showError(errBody.reason || errBody.error || "HTTP " + resp.status);
        return;
      }
      var data = await resp.json();
      lastP = p;
      lastC = c;
      displayCredential(data, alg);
    } catch (e) {
      showError(String(e.message || e));
    }
  }

  function displayCredential(data, requestedAlg) {
    var payload = data.decoded;
    if (!payload) {
      showError("Failed to decode credential");
      return;
    }

    var subject = payload.vc ? payload.vc.credentialSubject : null;
    if (subject) {
      document.getElementById("claim-name").textContent = subject.name || "—";
      document.getElementById("claim-role").textContent = subject.role || "—";
      document.getElementById("claim-dept").textContent = subject.department || "—";
      document.getElementById("claim-clearance").textContent = subject.clearance || "—";
      document.getElementById("claim-uid").textContent = subject.cardUid || "—";
    }

    document.getElementById("issuer-did").textContent = data.issuer || payload.iss || "—";
    document.getElementById("vc-jwt-display").textContent = data.credential || "—";
    document.getElementById("credential-alg").textContent = data.alg || requestedAlg || "ES256";

    var now = new Date();
    document.getElementById("credential-time").textContent = now.toLocaleTimeString();

    window._vcJwt = data.credential;

    var btnToggle = document.getElementById("btn-toggle-alg");
    if (data.alg === "EdDSA") {
      btnToggle.textContent = "Re-issue as ES256";
    } else {
      btnToggle.textContent = "Re-issue as EdDSA";
    }

    showState(elIssued);
  }

  async function verifyCredential(jwt) {
    var elResult = document.getElementById("verify-result");
    var elStatus = document.getElementById("verify-status");
    var elDetails = document.getElementById("verify-details");

    elStatus.textContent = "Verifying...";
    elDetails.textContent = "";
    elResult.classList.remove("hidden");

    try {
      var resp = await fetch("/api/verify-credential", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: jwt }),
      });
      var data = await resp.json();

      if (data.valid) {
        elStatus.textContent = "✓ VALID";
        elStatus.className = "text-sm font-bold mb-2 text-emerald-400";
        var p = data.payload;
        if (p && p.vc) {
          var s = p.vc.credentialSubject;
          elDetails.textContent =
            "Subject: " + (s ? s.name : "—") +
            " | UID: " + (s ? s.cardUid : "—") +
            " | Expires: " + (p.exp ? new Date(p.exp * 1000).toISOString() : "—");
        }
      } else {
        elStatus.textContent = "✗ INVALID";
        elStatus.className = "text-sm font-bold mb-2 text-red-400";
        elDetails.textContent = data.error || "Verification failed";
      }
    } catch (e) {
      elStatus.textContent = "✗ ERROR";
      elStatus.className = "text-sm font-bold mb-2 text-red-400";
      elDetails.textContent = String(e.message || e);
    }
  }

  function startNfcScan() {
    if (!("NDEFReader" in window)) {
      elNoNfc.classList.remove("hidden");
      return;
    }

    try {
      var ndef = new NDEFReader();
      ndef.onreading = function (event) {
        var url = "";
        for (var i = 0; i < event.message.records.length; i++) {
          var record = event.message.records[i];
          if (record.recordType === "url" || record.recordType === "text") {
            url = new TextDecoder().decode(record.data);
            break;
          }
        }
        if (!url) return;

        var parsedUrl;
        try { parsedUrl = new URL(url); } catch (e) { return; }

        var p = parsedUrl.searchParams.get("p");
        var c = parsedUrl.searchParams.get("c");
        if (p && c) {
          issueCredential(p, c);
        }
      };

      ndef.onreadingerror = function () {
        elScanHint.textContent = "Read error — try again";
      };

      ndef.scan().then(function () {
        elScanHint.classList.remove("hidden");
        elNfcStatus.classList.add("bg-purple-500/20", "border-purple-500/40");
        elNfcStatus.classList.remove("bg-gray-900", "border-gray-800");
      }).catch(function () {
        elScanHint.textContent = "NFC scan failed to start";
      });
    } catch (e) {
      elNoNfc.classList.remove("hidden");
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    startNfcScan();

    window._vcTapCredential = function (p, c) {
      issueCredential(p, c);
    };

    var btnCopy = document.getElementById("btn-copy-jwt");
    if (btnCopy) {
      btnCopy.addEventListener("click", function () {
        var jwt = window._vcJwt || "";
        if (!jwt) return;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(jwt).then(function () {
            btnCopy.textContent = "Copied!";
            setTimeout(function () { btnCopy.textContent = "Copy Credential"; }, 2000);
          });
        }
      });
    }

    var btnToggleAlg = document.getElementById("btn-toggle-alg");
    if (btnToggleAlg) {
      btnToggleAlg.addEventListener("click", function () {
        if (!lastP || !lastC) return;
        var currentAlg = document.getElementById("credential-alg").textContent;
        var newAlg = currentAlg === "EdDSA" ? "ES256" : "EdDSA";
        issueCredential(lastP, lastC, newAlg);
      });
    }

    var btnReset = document.getElementById("btn-reset");
    if (btnReset) {
      btnReset.addEventListener("click", function () {
        showState(elIdle);
        window._vcJwt = null;
        lastP = null;
        lastC = null;
      });
    }

    var btnRetry = document.getElementById("btn-retry");
    if (btnRetry) {
      btnRetry.addEventListener("click", function () {
        showState(elIdle);
      });
    }

    var btnVerifyInput = document.getElementById("btn-verify-input");
    if (btnVerifyInput) {
      btnVerifyInput.addEventListener("click", function () {
        var input = document.getElementById("verify-input");
        var jwt = (input.value || "").trim();
        if (!jwt) return;
        verifyCredential(jwt);
      });
    }
  });
})();
