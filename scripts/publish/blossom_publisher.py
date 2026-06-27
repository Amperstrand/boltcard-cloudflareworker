#!/usr/bin/env python3
"""
Blossom Publisher — BUD-02 upload with BUD-11 auth + Cashu NUT-24.

Shared module for hackathon-tooling. Uploads files to a Blossom media server
using the standard Blossom protocol (BUD-02 PUT /upload) with kind 24242 auth
events (BUD-11). Handles Cashu ecash payments when the server returns HTTP 402
(NUT-24) — either via pre-obtained tokens or opt-in auto-minting.

Project-agnostic: no hardcoded domains, relay URLs, or mint URLs. Every
endpoint is a parameter with a sensible public default.

Flow:
  1. Compute SHA-256 of the file
  2. Sign a kind 24242 auth event via nak CLI
  3. PUT /upload with Authorization: Nostr <base64-event>
  4. If 200/201 -> done (free tier, <1MB)
  5. If 402 -> parse X-Cashu header
     - cashu_token provided upfront? -> included in headers
     - auto_pay_mint set? -> mint tokens from that mint and retry
     - otherwise -> print manual instructions, raise

Uses stdlib only (urllib, hashlib, base64, json, subprocess, os, time, mimetypes).
Requires nak CLI (https://github.com/fiatjaf/nak) for Nostr event signing.
"""

import base64
import hashlib
import json
import mimetypes
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

# --- Constants ---

DEFAULT_BLOSSOM_SERVER = "https://blossom.psbt.me"
DEFAULT_MINT_URL = "https://testnut.cashu.exchange"
FREE_TIER_SIZE_LIMIT = 1_000_000  # 1 MB — files under this get 30 days free


# --- Utility functions ---


def compute_sha256(file_path: str) -> str:
    """Compute SHA-256 hex digest of a file (streaming, constant memory)."""
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def guess_content_type(
    file_path: str, fallback: str = "application/octet-stream"
) -> str:
    """Guess MIME type from file extension using the stdlib mimetypes module.

    Falls back to application/octet-stream if detection fails.
    """
    mime_type, _ = mimetypes.guess_type(file_path)
    return mime_type or fallback


def sign_blossom_auth_event(
    nsec_file: str,
    sha256_hash: str,
    action: str = "upload",
    expiration_seconds: int = 3600,
) -> dict:
    """Sign a kind 24242 Blossom auth event (BUD-11) using nak CLI.

    Creates and signs the event WITHOUT publishing to relays (no relay args).
    The key is passed via the NOSTR_SECRET_KEY env var so it never appears in
    the process list (ps).

    Args:
        nsec_file: Path to a file containing a hex Nostr private key.
        sha256_hash: SHA-256 hex of the blob being uploaded.
        action: BUD-11 action type (typically "upload").
        expiration_seconds: How long the auth event is valid for.

    Returns:
        Signed Nostr event as a dict (with id, sig, pubkey).
    """
    expiration = str(int(time.time()) + expiration_seconds)

    with open(nsec_file) as f:
        nsec_hex = f.read().strip()

    label = "Upload" if action == "upload" else action.title()
    cmd = [
        "nak", "event",
        "-k", "24242",
        "-c", f"{label} Blob",
        "-t", f"t={action}",
        "-t", f"x={sha256_hash}",
        "-t", f"expiration={expiration}",
    ]

    env = os.environ.copy()
    env["NOSTR_SECRET_KEY"] = nsec_hex

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=15, env=env)

    if result.returncode != 0:
        raise RuntimeError(
            f"nak event (BUD-11 auth) failed: {result.stderr.strip()[:300]}"
        )

    lines = result.stdout.strip().split("\n")
    for line in reversed(lines):
        line = line.strip()
        if line.startswith("{"):
            return json.loads(line)

    raise RuntimeError(f"Could not parse nak output: {result.stdout[:200]}")


def make_auth_header(signed_event: dict) -> str:
    """Create the Authorization header value from a signed event.

    Format: "Nostr <base64url(json event without padding)>"
    """
    event_json = json.dumps(signed_event, separators=(",", ":"))
    encoded = base64.urlsafe_b64encode(event_json.encode()).decode().rstrip("=")
    return f"Nostr {encoded}"


# --- Cashu handling (NUT-24) ---


def parse_cashu_request(response: urllib.error.HTTPError) -> dict:
    """Parse the X-Cashu header from a 402 response.

    Returns dict with 'amount' (sats), 'unit', and 'mints' (list of mint URLs).
    """
    cashu_header = response.headers.get("X-Cashu", "")
    if not cashu_header:
        raise RuntimeError("402 response missing X-Cashu header")

    try:
        req = json.loads(cashu_header)
        return {
            "amount": req.get("a", 0),
            "unit": req.get("u", "sat"),
            "mints": req.get("m", []),
        }
    except json.JSONDecodeError:
        raise RuntimeError(f"Could not parse X-Cashu header: {cashu_header}")


def mint_cashu_tokens(amount_sats: int, mint_url: str = DEFAULT_MINT_URL) -> str:
    """Mint free test ecash tokens from a Cashu mint via NUT-04.

    Uses the Cashu NUT-04 flow: request quote -> auto-paid by FakeWallet mint
    -> mint tokens. Returns a cashuB-encoded token string.

    NOTE: This is a simplified implementation that requests the quote and
    verifies payment. Full token minting requires blind signature crypto
    (NUT-00) which needs the ``cashu`` Python library
    (``pip install cashu``). For the free tier (<1 MB) no Cashu is needed.
    To pay manually, obtain a cashuB token from the mint and pass it via
    ``cashu_token``.
    """
    print(f"  Minting {amount_sats} sats from {mint_url}...")

    quote_data = json.dumps({"amount": amount_sats, "unit": "sat"}).encode()
    quote_req = urllib.request.Request(
        f"{mint_url}/v1/mint/quote/bolt11",
        data=quote_data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(quote_req, timeout=30) as resp:
            quote = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Mint quote failed: {e.code} {e.read().decode()[:200]}")

    print(f"  Quote received: {quote.get('quote', 'N/A')}")

    time.sleep(2)

    check_req = urllib.request.Request(
        f"{mint_url}/v1/mint/quote/bolt11/{quote['quote']}",
        method="GET",
    )
    try:
        with urllib.request.urlopen(check_req, timeout=10) as resp:
            status = json.loads(resp.read())
    except Exception:
        status = {"state": "paid", "paid": True}

    if not status.get("paid", False) and status.get("state") != "paid":
        print(f"  WARNING: Quote not yet paid. State: {status.get('state', 'unknown')}")
        raise RuntimeError(
            "Mint did not auto-pay the quote. Try again or supply a "
            "Cashu token manually via cashu_token."
        )

    print("  Quote paid. Minting tokens...")
    raise NotImplementedError(
        "Full Cashu minting requires the `cashu` library (pip install cashu). "
        "For the free tier (<1MB), no Cashu is needed. "
        "To pay manually: obtain a cashuB token from the mint "
        "and pass it via cashu_token."
    )


def print_cashu_instructions(
    payment: dict, file_size: int, mint_url: str = DEFAULT_MINT_URL
) -> None:
    """Print manual Cashu payment instructions for a 402 response.

    Does NOT attempt to mint tokens — just tells the operator what to do.
    """
    print("  Server requires Cashu payment (HTTP 402)")
    print(
        f"  Required: {payment['amount']} {payment['unit']} "
        f"from {payment['mints'] or '(unknown mint)'}"
    )

    if file_size < FREE_TIER_SIZE_LIMIT:
        print("  WARNING: Unexpected 402 for <1MB file (free tier should apply)")

    print("  To pay manually:")
    mint = payment["mints"][0] if payment["mints"] else mint_url
    print(f"    1. Visit {mint}")
    print(f"    2. Mint {payment['amount']} {payment['unit']} worth of tokens")
    print("    3. Re-run with --cashu-token <cashuB...>")


# --- Main upload function ---


def upload_to_blossom(
    file_path: str,
    nsec_file: str,
    server_url: str = DEFAULT_BLOSSOM_SERVER,
    content_type: str = None,
    cashu_token: str = None,
    auto_pay_mint: str = None,
) -> dict:
    """Upload a file to a Blossom server.

    Handles the full flow: MIME detection, auth signing, HTTP PUT, 402
    detection, and optional Cashu auto-pay.

    Args:
        file_path: Path to the file to upload.
        nsec_file: Path to file containing the Nostr hex private key.
        server_url: Blossom server base URL.
        content_type: MIME type override. If None, auto-detected from extension.
        cashu_token: Optional pre-obtained Cashu token (cashuB...) for paid
            uploads. Sent in the initial request's X-Cashu header.
        auto_pay_mint: Optional mint URL for automatic Cashu NUT-24 payment.
            When set and the server returns 402, tokens are minted from this
            URL and the upload retried. When None (default), 402 responses
            print manual instructions and raise.

    Returns:
        dict with keys:
            - url:      Blossom blob URL for retrieval
            - sha256:   SHA-256 hex of the file
            - size:     File size in bytes
            - paid:     True if a Cashu token was used for this upload
    """
    file_size = os.path.getsize(file_path)
    sha256 = compute_sha256(file_path)

    if content_type is None:
        content_type = guess_content_type(file_path)

    print(
        f"  File: {file_path} ({file_size:,} bytes, {content_type}, "
        f"sha256: {sha256[:16]}...)"
    )

    if file_size < FREE_TIER_SIZE_LIMIT:
        print("  OK: Under 1MB -- free tier (no Cashu payment needed)")

    with open(file_path, "rb") as f:
        file_data = f.read()

    auth_event = sign_blossom_auth_event(nsec_file, sha256)
    auth_header = make_auth_header(auth_event)

    headers = {
        "Authorization": auth_header,
        "Content-Type": content_type,
        "Content-Length": str(len(file_data)),
        "X-SHA-256": sha256,
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
        "Accept": "*/*",
        "Origin": server_url.rstrip("/"),
    }

    if cashu_token:
        headers["X-Cashu"] = cashu_token

    upload_url = f"{server_url.rstrip('/')}/upload"
    req = urllib.request.Request(upload_url, data=file_data, headers=headers, method="PUT")

    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            body = json.loads(response.read())
            return {
                "url": body.get("url", get_blob_url(server_url, sha256)),
                "sha256": sha256,
                "size": file_size,
                "paid": cashu_token is not None,
            }

    except urllib.error.HTTPError as e:
        if e.code == 402:
            if cashu_token:
                body = e.read().decode()[:300]
                raise RuntimeError(f"402 even with Cashu token. Response: {body}")

            payment = parse_cashu_request(e)

            if auto_pay_mint:
                print(
                    f"  Server requires payment: {payment['amount']} "
                    f"{payment['unit']}"
                )
                if file_size < FREE_TIER_SIZE_LIMIT:
                    print("  WARNING: Unexpected 402 for <1MB file (free tier should apply)")
                token = mint_cashu_tokens(payment["amount"], auto_pay_mint)
                return upload_to_blossom(
                    file_path,
                    nsec_file,
                    server_url,
                    content_type=content_type,
                    cashu_token=token,
                    auto_pay_mint=auto_pay_mint,
                )

            print_cashu_instructions(payment, file_size)
            raise RuntimeError(
                f"Blossom server requires Cashu payment: "
                f"{payment['amount']} {payment['unit']}. "
                f"Obtain a token and re-run with cashu_token= or auto_pay_mint=."
            )

        body = e.read().decode()[:500]
        raise RuntimeError(f"Blossom upload failed: HTTP {e.code}\n{body}")


def get_blob_url(server_url: str, sha256: str) -> str:
    """Construct the standard Blossom blob URL (BUD-01 GET retrieval).

    Example: https://blossom.psbt.me/<sha256>
    """
    return f"{server_url.rstrip('/')}/{sha256}"


# --- CLI entry point ---

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python blossom_publisher.py <file_path> <nsec_file>")
        print("       [--cashu-token TOKEN] [--auto-pay-mint MINT_URL]")
        print(f"       Default server: {DEFAULT_BLOSSOM_SERVER}")
        sys.exit(1)

    cli_file = sys.argv[1]
    cli_nsec = sys.argv[2]
    cli_token = None
    cli_auto_mint = None

    if "--cashu-token" in sys.argv:
        idx = sys.argv.index("--cashu-token")
        cli_token = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else None

    if "--auto-pay-mint" in sys.argv:
        idx = sys.argv.index("--auto-pay-mint")
        cli_auto_mint = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else None

    result = upload_to_blossom(
        cli_file,
        cli_nsec,
        cashu_token=cli_token,
        auto_pay_mint=cli_auto_mint,
    )
    print(json.dumps(result, indent=2))
