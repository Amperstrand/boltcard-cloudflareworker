(function () {
  "use strict";

  var nostrNpub = null;

  function $(id) { return document.getElementById(id); }

  function showSection(prefix) {
    ["pair-idle", "pair-loading", "pair-success", "pair-error"].forEach(function (s) {
      $(s).classList.add("hidden");
    });
    $(prefix).classList.remove("hidden");
  }

  function showError(msg) {
    $("pair-error-msg").textContent = msg || "Unknown error";
    showSection("pair-error");
  }

  // ─── NIP-07: Connect Nostr Identity ───────────────────────────
  function checkNip07() {
    return typeof window.nostr !== "undefined" &&
           typeof window.nostr.getPublicKey === "function";
  }

  $("btn-connect-nostr").addEventListener("click", async function () {
    if (!checkNip07()) {
      $("nip07-missing").classList.remove("hidden");
      $("nip07-available").classList.add("hidden");
      return;
    }

    try {
      var npub = await window.nostr.getPublicKey();
      if (!npub || !npub.startsWith("npub1")) {
        showError("Invalid public key returned");
        return;
      }
      nostrNpub = npub;
      $("nostr-npub").textContent = npub;
      $("nip07-available").classList.add("hidden");
      $("nostr-connected").classList.remove("hidden");
    } catch (e) {
      showError(String(e.message || e));
    }
  });

  // ─── NFC scanning ──────────────────────────────────────────────
  function startNfcScan() {
    if (!("NDEFReader" in window)) {
      $("no-nfc-msg").classList.remove("hidden");
      $("btn-use-virtual").classList.remove("hidden");
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
        try {
          var parsed = new URL(url);
          var p = parsed.searchParams.get("p");
          var c = parsed.searchParams.get("c");
          if (p && c && nostrNpub) doPair(p, c);
        } catch (e) { return; }
      };

      ndef.scan().then(function () {
        $("scan-hint").classList.remove("hidden");
      }).catch(function () {
        $("scan-hint").textContent = "NFC scan failed — use virtual card";
        $("btn-use-virtual").classList.remove("hidden");
      });
    } catch (e) {
      $("no-nfc-msg").classList.remove("hidden");
      $("btn-use-virtual").classList.remove("hidden");
    }
  }

  // ─── Virtual card hook ─────────────────────────────────────────
  window._vcTapPair = function (p, c) {
    if (!nostrNpub) {
      showError("Connect your Nostr identity first");
      return;
    }
    doPair(p, c);
  };

  $("btn-use-virtual").addEventListener("click", function () {
    if (typeof window._vcTap === "function") {
      var t = window._vcTap();
      if (t && nostrNpub) doPair(t.p, t.c);
    } else {
      window.location.href = "/virtual";
    }
  });

  // ─── Pair / Unpair API ─────────────────────────────────────────
  async function doPair(p, c) {
    showSection("pair-loading");
    try {
      var csrfMatch = document.cookie.match(/op_csrf=([^;]+)/);
      var headers = { "Content-Type": "application/json" };
      if (csrfMatch) headers["X-CSRF-Token"] = csrfMatch[1];

      var resp = await fetch("/api/pair-nostr", {
        method: "POST",
        headers: headers,
        body: JSON.stringify({ p: p, c: c, npub: nostrNpub }),
      });
      var data = await resp.json();
      if (data.success) {
        showSection("pair-success");
      } else {
        showError(data.reason || data.error || "HTTP " + resp.status);
      }
    } catch (e) {
      showError(String(e.message || e));
    }
  }

  $("btn-unpair").addEventListener("click", async function () {
    if (!confirm("Remove the Nostr identity pairing from this card?")) return;
    var btn = $("btn-unpair");
    btn.textContent = "Unpairing...";
    btn.disabled = true;

    try {
      if (typeof window._vcTap === "function") {
        var t = window._vcTap();
        var csrfMatch = document.cookie.match(/op_csrf=([^;]+)/);
        var headers = { "Content-Type": "application/json" };
        if (csrfMatch) headers["X-CSRF-Token"] = csrfMatch[1];

        var resp = await fetch("/api/unpair-nostr", {
          method: "POST",
          headers: headers,
          body: JSON.stringify({ p: t.p, c: t.c }),
        });
        var data = await resp.json();
        if (data.success) {
          showSection("pair-idle");
          $("nostr-connected").classList.add("hidden");
          $("nip07-available").classList.remove("hidden");
          nostrNpub = null;
        }
      }
    } catch (e) {
      btn.textContent = "Unpair Failed";
    }
  });

  $("btn-retry-pair").addEventListener("click", function () {
    showSection("pair-idle");
  });

  // ─── Init ──────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", function () {
    if (!checkNip07()) {
      $("nip07-missing").classList.remove("hidden");
      $("nip07-available").classList.add("hidden");
    }
    startNfcScan();
  });
})();
