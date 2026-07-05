(function () {
  "use strict";

  function init() {
    var input = document.getElementById("verify-input");
    var btnVerify = document.getElementById("btn-verify");
    var btnClear = document.getElementById("btn-clear");
    var resultSection = document.getElementById("result-section");
    var resultTitle = document.getElementById("result-title");
    var resultBadge = document.getElementById("result-badge");
    var resultDetails = document.getElementById("result-details");

    if (!btnVerify || !input) return;

    btnVerify.addEventListener("click", async function () {
      var cred = (input.value || "").trim();
      if (!cred) return;

      resultSection.classList.remove("hidden");
      resultTitle.textContent = "Verifying...";
      resultBadge.textContent = "...";
      resultBadge.className = "text-xs font-bold px-3 py-1 rounded-full bg-gray-700 text-gray-300";
      resultDetails.replaceChildren();

      try {
        var resp = await fetch("/api/verify-credential", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential: cred }),
        });
        var data = await resp.json();

        if (data.valid) {
          resultTitle.textContent = "Valid Credential";
          resultBadge.textContent = "\u2713 VALID";
          resultBadge.className = "text-xs font-bold px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30";

          var p = data.payload || {};
          var s = (p.vc && p.vc.credentialSubject) || {};
          var rows = [
            ["Subject", s.name || "\u2014"],
            ["Role", s.role || "\u2014"],
            ["Department", s.department || "\u2014"],
            ["Card UID", s.cardUid || "\u2014"],
            ["Issuer", (data.issuer || p.iss || "\u2014").substring(0, 60) + "..."],
            ["Algorithm", data.alg || p.alg || "\u2014"],
            ["Issued", p.iat ? new Date(p.iat * 1000).toISOString() : "\u2014"],
            ["Expires", p.exp ? new Date(p.exp * 1000).toISOString() : "\u2014"],
          ];

          if (s.nostrNpub) rows.push(["Nostr", s.nostrNpub]);
          if (s.nostrName) rows.push(["Nostr Name", s.nostrName]);

          resultDetails.replaceChildren();
          rows.forEach(function (row) {
            var row_el = document.createElement("div");
            row_el.className = "flex justify-between items-center border-b border-gray-800/50 pb-2";
            var label = document.createElement("span");
            label.className = "text-xs text-gray-500 uppercase tracking-wider";
            label.textContent = row[0];
            var value = document.createElement("span");
            value.className = "text-sm font-mono text-gray-300 text-right";
            value.textContent = row[1];
            row_el.appendChild(label);
            row_el.appendChild(value);
            resultDetails.appendChild(row_el);
          });
        } else {
          resultTitle.textContent = "Invalid Credential";
          resultBadge.textContent = "\u2717 INVALID";
          resultBadge.className = "text-xs font-bold px-3 py-1 rounded-full bg-red-500/20 text-red-400 border border-red-500/30";
          var err_el = document.createElement("p");
          err_el.className = "text-sm text-red-400";
          err_el.textContent = data.error || "Verification failed";
          resultDetails.appendChild(err_el);
        }
      } catch (e) {
        resultTitle.textContent = "Error";
        resultBadge.textContent = "\u2717 ERROR";
        resultBadge.className = "text-xs font-bold px-3 py-1 rounded-full bg-red-500/20 text-red-400 border border-red-500/30";
        var msg_el = document.createElement("p");
        msg_el.className = "text-sm text-red-400";
        msg_el.textContent = String((e && e.message) || e);
        resultDetails.appendChild(msg_el);
      }
    });

    if (btnClear) {
      btnClear.addEventListener("click", function () {
        input.value = "";
        resultSection.classList.add("hidden");
        input.focus();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
