#!/usr/bin/env python3
"""
Publish test evidence to Blossom + Nostr.

Takes Playwright test results, uploads screenshots to Blossom,
rewrites the dashboard HTML with Blossom URLs, uploads the HTML,
and publishes Nostr kind 30078 summary event for discoverability.

Usage:
    python3 scripts/publish/publish_evidence.py
    python3 scripts/publish/publish_evidence.py --nsec-file ~/.config/prta/nsec
    python3 scripts/publish/publish_evidence.py --blossom-server https://blossom.psbt.me
"""

import json
import os
import sys
import time
import mimetypes
from pathlib import Path

try:
    import certifi
    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
except ImportError:
    pass

sys.path.insert(0, str(Path(__file__).parent))
from blossom_publisher import compute_sha256, upload_to_blossom, guess_content_type
from nostr_publisher import publish_test_run_event, publish_nip94_event

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
RESULTS_DIR = REPO_ROOT / "test-results"
REPORT_PATH = RESULTS_DIR / "report.json"
DASHBOARD_HTML = RESULTS_DIR / "dashboard" / "index.html"

DEFAULT_NSEC = os.path.expanduser("~/.config/prta/nsec")
DEFAULT_BLOSSOM = os.environ.get("BLOSSOM_SERVER", "https://blossom.psbt.me")
DEFAULT_RELAYS = [r.strip() for r in os.environ.get("NOSTR_RELAYS", "wss://relay.damus.io,wss://nos.lol").split(",") if r.strip()]


def flatten_screenshot_paths(suites, parent=""):
    paths = []
    if not suites:
        return paths
    for suite in suites:
        if suite.get("specs"):
            for spec in suite["specs"]:
                for test in (spec.get("tests") or []):
                    for result in (test.get("results") or []):
                        for att in (result.get("attachments") or []):
                            p = att.get("path")
                            ct = att.get("contentType", "")
                            if p and ct.startswith("image/") and os.path.exists(p):
                                paths.append(p)
        if suite.get("suites"):
            paths.extend(flatten_screenshot_paths(suite["suites"], parent))
    return paths


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Publish test evidence to Blossom + Nostr")
    parser.add_argument("--nsec-file", default=DEFAULT_NSEC, help="Path to nsec file")
    parser.add_argument("--blossom-server", default=DEFAULT_BLOSSOM)
    parser.add_argument("--relays", default=",".join(DEFAULT_RELAYS))
    parser.add_argument("--max-screenshots", type=int, default=50, help="Max screenshots to upload")
    args = parser.parse_args()

    relays = [r.strip() for r in args.relays.split(",") if r.strip()]

    if not REPORT_PATH.exists():
        print(f"ERROR: No report at {REPORT_PATH}")
        print("Run: npm run test:evidence")
        sys.exit(1)

    if not os.path.exists(args.nsec_file):
        print(f"ERROR: nsec file not found: {args.nsec_file}")
        print("Create one with: nak key generate > ~/.config/prta/nsec")
        sys.exit(1)

    if not DASHBOARD_HTML.exists():
        print("ERROR: Dashboard not rendered. Run: node scripts/render-test-dashboard.mjs")
        sys.exit(1)

    report = json.loads(REPORT_PATH.read_text())
    tests_count = len(report.get("stats", {}))
    passed = report.get("stats", {}).get("expected", 0)
    failed = report.get("stats", {}).get("unexpected", 0)

    screenshot_paths = list(dict.fromkeys(flatten_screenshot_paths(report.get("suites", []))))
    screenshot_paths = screenshot_paths[:args.max_screenshots]

    print(f"Report: {passed} passed, {failed} failed")
    print(f"Screenshots to upload: {len(screenshot_paths)}")
    print(f"Blossom server: {args.blossom_server}")
    print(f"Relays: {', '.join(relays)}")
    print()

    blossom_urls = {}
    for i, screenshot_path in enumerate(screenshot_paths):
        filename = os.path.basename(screenshot_path)
        ct = guess_content_type(screenshot_path)
        print(f"  [{i+1}/{len(screenshot_paths)}] {filename}...", end=" ", flush=True)
        try:
            result = upload_to_blossom(
                screenshot_path, args.nsec_file, args.blossom_server, ct
            )
            url = result.get("url", "")
            if url:
                blossom_urls[screenshot_path] = url
                print(f"OK ({url.split('/')[-1][:12]}...)")
            else:
                print(f"SKIP (no URL)")
        except Exception as e:
            print(f"FAIL ({e})")

    print(f"\nUploaded {len(blossom_urls)}/{len(screenshot_paths)} screenshots")

    dashboard = DASHBOARD_HTML.read_text()
    for original_path, blossom_url in blossom_urls.items():
        rel_path = original_path.replace(str(REPO_ROOT) + "/", "")
        rel_path_test = original_path.replace(str(REPO_ROOT) + "/test-results/", "")
        dashboard = dashboard.replace(rel_path, blossom_url)
        dashboard = dashboard.replace(rel_path_test, blossom_url)

    dashboard = dashboard.replace("▶ Video</a>", "▶ Video (local only)</span>")

    run_id = time.strftime("%Y%m%dT%H%M%SZ")
    published_html_path = RESULTS_DIR / f"dashboard-{run_id}.html"
    published_html_path.write_text(dashboard)
    print(f"\nRewritten dashboard: {published_html_path}")

    print(f"\nUploading dashboard HTML to Blossom...", end=" ", flush=True)
    try:
        result = upload_to_blossom(
            str(published_html_path), args.nsec_file, args.blossom_server, "text/html"
        )
        dashboard_url = result.get("url", "")
        if dashboard_url:
            print(f"OK")
            print(f"\n{'='*60}")
            print(f"DASHBOARD URL: {dashboard_url}")
            print(f"{'='*60}\n")
        else:
            print("FAIL")
            dashboard_url = None
    except Exception as e:
        print(f"FAIL ({e})")
        dashboard_url = None

    all_urls = list(blossom_urls.values())
    if dashboard_url:
        all_urls.append(dashboard_url)

    summary = f"Test evidence: {passed} passed, {failed} failed. Dashboard: {dashboard_url or 'upload failed'}"

    print(f"\nPublishing Nostr kind 30078 summary...", end=" ", flush=True)
    try:
        result = publish_test_run_event(
            nsec_file=args.nsec_file,
            run_id=f"boltcard-{run_id}",
            file_urls=all_urls,
            summary=summary,
            relays=relays,
        )
        if result.get("success"):
            print(f"OK (event: {result.get('event_id', '?')[:16]}...)")
        else:
            print(f"FAIL ({result.get('error', 'unknown')})")
    except Exception as e:
        print(f"FAIL ({e})")

    print(f"\nDone. Dashboard: {dashboard_url or '(not published)'}")


if __name__ == "__main__":
    main()
