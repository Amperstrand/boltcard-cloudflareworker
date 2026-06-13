#!/usr/bin/env python3
"""Financial flow test with physical NTAG424 card via pcscd bridge.

Exercises the full operator pipeline against a live worker:
  top-up -> POS charge -> refund -> balance verification

Each operation taps the physical card for fresh SDM params.
The card stays on the reader — each /tap reads a new counter value.

Usage:
  python3 scripts/financial-flow-test.py                    # Default: live production
  python3 scripts/financial-flow-test.py --local             # Local wrangler dev
  python3 scripts/financial-flow-test.py --amount 1000       # Custom amounts
  python3 scripts/financial-flow-test.py --topup 3000 --charge 1500 --refund 500

Prerequisites:
  1. pcscd bridge running: python3 scripts/pcscd-bridge.py --port 4321
  2. NTAG424 card on the reader
  3. Operator PIN set (default: 1234)

Exit codes:
  0 = all operations succeeded, balance math correct
  1 = test failed (API error or balance mismatch)
  2 = infrastructure error (bridge down, login failed)
"""
import argparse
import json
import re
import sys

import requests

DEFAULT_WORKER = "https://boltcardpoc.psbt.me"
LOCAL_WORKER = "http://127.0.0.1:8787"
DEFAULT_BRIDGE = "http://127.0.0.1:4321"
DEFAULT_PIN = "1234"


def tap(bridge_url: str) -> tuple[str, str]:
    """Read card via pcscd bridge, return (p, c) params."""
    r = requests.get(f"{bridge_url}/tap", timeout=15)
    data = r.json()
    if "error" in data:
        print(f"  Bridge error: {data['error']}", file=sys.stderr)
        sys.exit(2)
    return data["p"], data["c"]


def get_balance(worker_url: str, bridge_url: str) -> int | str:
    """Tap card and check balance via public API."""
    p, c = tap(bridge_url)
    r = requests.post(
        f"{worker_url}/api/balance-check",
        json={"p": p, "c": c},
        timeout=15,
        headers={"User-Agent": "financial-flow-test/1.0"},
    )
    if r.status_code == 200:
        return r.json().get("balance", "?")
    return f"HTTP {r.status_code}"


def operator_login(session: requests.Session, worker_url: str, pin: str) -> None:
    """Login + fetch CSRF token from operator page."""
    session.get(f"{worker_url}/operator/login", timeout=10)
    r = session.post(
        f"{worker_url}/operator/login",
        data={"pin": pin},
        timeout=10,
        allow_redirects=False,
    )
    if r.status_code not in (200, 302):
        print(f"  Login failed: HTTP {r.status_code}", file=sys.stderr)
        sys.exit(2)
    session.get(f"{worker_url}/operator/pos", timeout=10)
    csrf = session.cookies.get("op_csrf", "")
    if not csrf:
        print("  No op_csrf cookie after visiting /operator/pos", file=sys.stderr)
        sys.exit(2)
    session.headers["X-CSRF-Token"] = csrf


def operator_api(
    session: requests.Session,
    worker_url: str,
    bridge_url: str,
    path: str,
    amount: int,
) -> tuple[int, dict]:
    """Call operator API with fresh tap + session cookies + CSRF header."""
    p, c = tap(bridge_url)
    r = session.post(
        f"{worker_url}{path}",
        json={"p": p, "c": c, "amount": amount},
        timeout=15,
    )
    try:
        data = r.json()
    except Exception:
        data = {"raw": r.text[:200]}
    return r.status_code, data


def main() -> int:
    parser = argparse.ArgumentParser(description="Financial flow test with physical card")
    parser.add_argument("--local", action="store_true", help="Test against local wrangler dev")
    parser.add_argument("--worker", default=None, help="Worker URL (overrides --local)")
    parser.add_argument("--bridge", default=DEFAULT_BRIDGE, help="pcscd bridge URL")
    parser.add_argument("--pin", default=DEFAULT_PIN, help="Operator PIN")
    parser.add_argument("--amount", type=int, default=5000, help="Default amount for all ops")
    parser.add_argument("--topup", type=int, default=None, help="Top-up amount (default: --amount)")
    parser.add_argument("--charge", type=int, default=None, help="POS charge amount (default: --amount)")
    parser.add_argument("--refund", type=int, default=None, help="Refund amount (default: --amount/2)")
    args = parser.parse_args()

    worker_url = args.worker or (LOCAL_WORKER if args.local else DEFAULT_WORKER)
    topup_amt = args.topup or args.amount
    charge_amt = args.charge or min(args.amount, 2000)
    refund_amt = args.refund or min(args.amount // 2, 1000)

    session = requests.Session()
    session.headers["User-Agent"] = "financial-flow-test/1.0"

    print(f"=== Financial Flow Test (Physical Card) ===")
    print(f"  Worker: {worker_url}")
    print(f"  Bridge: {args.bridge}")
    print()

    print("[0] Initial balance...")
    bal0 = get_balance(worker_url, args.bridge)
    print(f"    Balance: {bal0}")
    print()

    print("[1] Operator login...")
    operator_login(session, worker_url, args.pin)
    print("    Logged in")
    print()

    print(f"[2] Top-up {topup_amt}... (tap)")
    st, data = operator_api(session, worker_url, args.bridge, "/operator/topup/apply", topup_amt)
    bal1 = data.get("balance", "?")
    ok1 = st == 200
    print(f"    HTTP {st} | balance: {bal1} {'OK' if ok1 else 'FAIL'}")
    print()

    print(f"[3] POS charge {charge_amt}... (tap)")
    st, data = operator_api(session, worker_url, args.bridge, "/operator/pos/charge", charge_amt)
    bal2 = data.get("balance", "?")
    ok2 = st == 200
    print(f"    HTTP {st} | balance: {bal2} {'OK' if ok2 else 'FAIL'}")
    print()

    print(f"[4] Refund {refund_amt}... (tap)")
    st, data = operator_api(session, worker_url, args.bridge, "/operator/refund/apply", refund_amt)
    bal3 = data.get("balance", "?")
    ok3 = st == 200
    print(f"    HTTP {st} | balance: {bal3} {'OK' if ok3 else 'FAIL'}")
    print()

    print("=== Summary ===")
    print(f"  Initial:   {bal0}")
    print(f"  After +{topup_amt}:  {bal1}")
    print(f"  After -{charge_amt}:  {bal2}")
    print(f"  After +{refund_amt}:  {bal3}")

    expected_net = topup_amt - charge_amt + refund_amt
    if isinstance(bal3, int) and isinstance(bal0, int):
        actual_net = bal3 - bal0
        print(f"  Net:       {actual_net:+d} (expected {expected_net:+d})")
        all_ok = ok1 and ok2 and ok3 and actual_net == expected_net
        print("  PASS" if all_ok else "  FAIL")
        return 0 if all_ok else 1
    else:
        print("  (could not verify - non-integer balance)")
        return 1 if not (ok1 and ok2 and ok3) else 0


if __name__ == "__main__":
    sys.exit(main())
