#!/usr/bin/env python3
"""
Shared Nostr publisher for hackathon-tooling. Supports NIP-94 file metadata
and NIP-78 app data. Uses nak CLI for signing.

DEPRECATED: The NIP-90 DVM mode (kinds 5xxx/6xxx/7000/31989) is deprecated
per ADR-007. This file is kept at root because ble-publish/ imports it for
NIP-94 (1063) and NIP-78 (30078) publishing. The NIP-90 functions below
should not be called by new code. Use the ContextVM Gateway and mcp_server/
for all tool-call workflows. See:
  - docs/decision-log.md (ADR-007)
  - patterns/contextvm/migration-from-nip-90.md

Event kinds:
  NIP-94 + NIP-78 mode (test results dashboards):
    - 1063:  NIP-94 File Metadata. BlossomFS uses these to populate /nip94/.
             Each event advertises a single file (URL, sha256, MIME, etc.).
    - 30078: Application-specific data (parameterized replaceable). Used as a
             per-run "index" event: d-tag is the run_id, tags list all file URLs.

  NIP-90 DVM mode (DEPRECATED — do not use in new code):
    - 31989: NIP-89 service announcement (DVM discoverability)
    - 7000:  Job feedback (status: processing, success, error, partial)
    - 6500:  Job result (request kind + 1000 per NIP-90 convention)
    - 1:     Text note (human-visible in regular Nostr clients)

Uses the nak CLI (https://github.com/fiatjaf/nak) for signing + publishing.
The nsec is read from a file and passed via NOSTR_SECRET_KEY env var — never
visible in the process list.

Project-agnostic — callers must provide relay URLs and any project-specific
content (names, tags, etc.). No hardcoded values.
"""

import json
import os
import re
import subprocess
import sys
import time
from typing import Any

# --- Constants ---

DEFAULT_RELAYS: list[str] = []

KIND_TEXT_NOTE = 1
KIND_NIP94_FILE_METADATA = 1063
KIND_APP_DATA = 30078
KIND_NIP89_ANNOUNCE = 31989
KIND_JOB_FEEDBACK = 7000

KIND_JOB_REQUEST = 5500
KIND_JOB_RESULT = 6500

KIND_BCR_REQUEST = KIND_JOB_REQUEST
KIND_BCR_RESULT = KIND_JOB_RESULT

STATUS_PROCESSING = "processing"
STATUS_SUCCESS = "success"
STATUS_ERROR = "error"
STATUS_PARTIAL = "partial"


# --- Shared core ---


def _nostr_now() -> int:
    """Current Unix timestamp (Nostr convention)."""
    return int(time.time())


def _nak_available() -> bool:
    """Check if nak CLI is installed and on PATH."""
    result = subprocess.run(["which", "nak"], capture_output=True, text=True)
    return result.returncode == 0


def _parse_nak_publish_output(stderr: str) -> dict[str, Any]:
    """Parse nak stderr for per-relay acceptance/rejection status.

    nak exits 0 even when relays reject events (e.g. whitelist blocks, rate
    limits). The relay status lines (``publishing to <relay>... success|failed``)
    appear on stderr. This function extracts them into a structured dict so
    callers can detect silent rejections.
    """
    relay_results: dict[str, dict[str, Any]] = {}
    pattern = re.compile(r"^publishing to (.+?)\.\.\. (success\.|failed:)\s*(.*)$")
    for line in stderr.splitlines():
        line = line.strip()
        m = pattern.match(line)
        if not m:
            continue
        relay, status_raw, message = m.group(1), m.group(2), m.group(3).strip()
        accepted = status_raw.startswith("success")
        relay_results[relay] = {
            "accepted": accepted,
            "message": message if message else ("" if accepted else "unknown"),
        }
    any_accepted = any(r["accepted"] for r in relay_results.values())
    all_rejected_reasons = [
        f"{relay}: {r['message']}" for relay, r in relay_results.items() if not r["accepted"]
    ]
    return {
        "relay_results": relay_results,
        "any_accepted": any_accepted,
        "all_rejected_reasons": all_rejected_reasons,
    }


def _publish_event(
    nsec_file: str,
    kind: int,
    content: str,
    tags: list,
    relays: list = None,
) -> dict:
    """Sign and publish a Nostr event via nak CLI.

    nak exits 0 even when relays reject events (e.g. whitelist blocks).
    The relay status lines (``publishing to <relay>... success|failed``)
    are printed to stderr — stdout contains only the signed event JSON.
    stderr is parsed to detect silent rejections.

    Args:
        nsec_file: Path to file containing hex Nostr private key.
        kind: Nostr event kind (e.g. 1063, 30078, 7000).
        content: Event content string.
        tags: List of tag lists (e.g. [["d", "run-001"], ["t", "test-run"]]).
        relays: List of relay URLs. Defaults to DEFAULT_RELAYS (empty — caller
                must provide relays or set DEFAULT_RELAYS before calling).

    Returns:
        Dict with keys: success, event_id, event, relay_status.
        On failure: success=False, error=... (plus event_id/event/relay_status
        if the event was signed but rejected by relays).
    """
    if relays is None:
        relays = DEFAULT_RELAYS

    if not relays:
        return {
            "success": False,
            "error": "No relays configured. Pass relays=[...] or set DEFAULT_RELAYS.",
        }

    if not _nak_available():
        return {
            "success": False,
            "error": "nak CLI not found. Install: https://github.com/fiatjaf/nak",
        }

    with open(nsec_file) as f:
        nsec_hex = f.read().strip()

    cmd = [
        "nak", "event",
        "-k", str(kind),
        "-c", content,
    ]

    for tag in tags:
        tag_key = tag[0]
        tag_vals = ";".join(str(t) for t in tag[1:])
        cmd.extend(["-t", f"{tag_key}={tag_vals}"])

    cmd.extend(relays)

    env = os.environ.copy()
    env["NOSTR_SECRET_KEY"] = nsec_hex

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, env=env)

    if result.returncode != 0:
        return {
            "success": False,
            "error": f"nak event failed: {result.stderr.strip()[:300]}",
        }

    nak_status = _parse_nak_publish_output(result.stderr)

    event: dict = {}
    event_id = ""
    try:
        event = json.loads(result.stdout.strip().split("\n")[-1])
        event_id = event.get("id", "")
    except (json.JSONDecodeError, IndexError):
        pass

    if not nak_status["any_accepted"]:
        reasons = "; ".join(nak_status["all_rejected_reasons"]) or "all relays rejected (no detail)"
        return {
            "success": False,
            "error": f"Event signed but rejected by all relays: {reasons}",
            "event_id": event_id,
            "event": event,
            "relay_status": nak_status,
        }

    return {
        "success": True,
        "event_id": event_id,
        "event": event,
        "relay_status": nak_status,
    }


# --- NIP-94 + NIP-78 mode (test results dashboards) ---


def publish_nip94_event(
    nsec_file: str,
    filename: str,
    blossom_url: str,
    sha256: str,
    mime_type: str,
    metadata_tags: dict = None,
    relays: list = None,
) -> dict:
    """Publish a NIP-94 file metadata event (kind 1063) for BlossomFS.

    This makes the file discoverable by BlossomFS under:
        /nip94/<pubkey>/<filename>
        /metadata/<pubkey>/<filename>

    Required NIP-94 tags:
        - url:      Blossom blob URL
        - x:        SHA-256 (also "ox" for the "original" sha256)
        - m:        MIME type
        - filename: display name

    Optional metadata_tags keys (added if present):
        - architecture (goes to "A" tag)
        - version      (goes to "v" tag)
        - package_name (goes to "n" tag)
        - compression  (goes to "compression" tag)
        - format       (goes to "format" tag)
        - size         (goes to "size" tag, in bytes)
        - summary      (goes to "summary" tag)
    """
    if metadata_tags is None:
        metadata_tags = {}

    tags = [
        ["url", blossom_url],
        ["x", sha256],
        ["ox", sha256],
        ["m", mime_type],
        ["filename", filename],
    ]

    if "architecture" in metadata_tags:
        tags.append(["A", metadata_tags["architecture"]])
    if "version" in metadata_tags:
        tags.append(["v", metadata_tags["version"]])
    if "package_name" in metadata_tags:
        tags.append(["n", metadata_tags["package_name"]])
    if "compression" in metadata_tags:
        tags.append(["compression", metadata_tags["compression"]])
    if "format" in metadata_tags:
        tags.append(["format", metadata_tags["format"]])
    if "size" in metadata_tags:
        tags.append(["size", str(metadata_tags["size"])])
    if "summary" in metadata_tags:
        tags.append(["summary", metadata_tags["summary"]])

    content = json.dumps({
        "filename": filename,
        "url": blossom_url,
        "sha256": sha256,
        "mime_type": mime_type,
    })

    return _publish_event(nsec_file, KIND_NIP94_FILE_METADATA, content, tags, relays)


def publish_test_run_event(
    nsec_file: str,
    run_id: str,
    timestamp: int = None,
    file_urls: list = None,
    summary: str = "",
    relays: list = None,
    project_tag: str = "test-run",
) -> dict:
    """Publish a kind 30078 parameterized replaceable test-run index event.

    This is the "index" event that reader pages fetch to discover all
    artifacts belonging to a test run. The d-tag is set to run_id, making it
    replaceable (publishing again with the same run_id replaces the old event).

    Each file URL is added as a separate "file" tag so consumers can enumerate
    them. The summary goes into the event content.

    Args:
        project_tag: Project identifier for dashboard filtering (e.g. "tollgate", "fips", "ble-experiment").
    """
    if timestamp is None:
        timestamp = _nostr_now()
    if file_urls is None:
        file_urls = []

    tags = [
        ["d", run_id],
        ["t", project_tag],
        ["timestamp", str(timestamp)],
    ]

    for url in file_urls:
        tags.append(["file", url])

    content = summary if summary else f"Test run {run_id} at {timestamp}"

    return _publish_event(nsec_file, KIND_APP_DATA, content, tags, relays)


# --- NIP-90 DVM mode (compute-as-a-service) ---


def publish_job_feedback(
    nsec_file: str,
    status: str,
    job_request_id: str = "",
    customer_pubkey: str = "",
    extra_info: str = "",
    content: str = "",
    relays: list = None,
    extra_tags: list = None,
) -> dict:
    """Publish NIP-90 job feedback (kind 7000).

    Args:
        nsec_file: Path to file containing hex Nostr private key.
        status: One of STATUS_PROCESSING, STATUS_SUCCESS, STATUS_ERROR,
                STATUS_PARTIAL.
        job_request_id: Event ID of the job request being referenced.
        customer_pubkey: Pubkey of the customer who submitted the job.
        extra_info: Human-readable detail appended to the status tag
                    (e.g. "Scraping workshop data", error message).
        content: Event content (defaults to JSON with status + extra_info).
        relays: Relay list override.
        extra_tags: Additional tags to append.

    Returns:
        Result dict from _publish_event.
    """
    tags: list[list[str]] = [
        ["status", status, extra_info] if extra_info else ["status", status],
    ]

    if job_request_id:
        tags.append(["e", job_request_id])
    if customer_pubkey:
        tags.append(["p", customer_pubkey])
    if extra_tags:
        tags.extend(extra_tags)

    if not content:
        content = json.dumps({"status": status, "info": extra_info} if extra_info else {"status": status})

    return _publish_event(nsec_file, KIND_JOB_FEEDBACK, content, tags, relays)


def publish_job_result(
    nsec_file: str,
    request_kind: int = KIND_JOB_REQUEST,
    job_request_id: str = "",
    customer_pubkey: str = "",
    content: str = "",
    result_url: str = "",
    *,
    workshop_id: str = None,
    report_url: str = None,
    pr_title: str = "",
    pr_url: str = "",
    summary: str = "",
    metrics: dict = None,
    relays: list = None,
    extra_tags: list = None,
) -> dict:
    """Publish a NIP-90 job result event.

    Per NIP-90, the result kind is request_kind + 1000 (e.g. 5500 → 6500).

    Supports two calling conventions:

    Generic NIP-90 (preferred):
        publish_job_result(nsec_file, request_kind=5500,
                           job_request_id="evt123...", content="Done",
                           result_url="https://...")

    BCR-agent compat (keyword args):
        publish_job_result(nsec_file,
                           workshop_id="33300",
                           report_url="https://blossom.../report.md",
                           pr_title="Add BIP-...", metrics={"coverage": 95})

    When ``workshop_id`` is provided it is used as the job identifier tag.
    When ``report_url`` is provided it is used as the result URL.
    """
    if workshop_id is not None and not job_request_id:
        job_request_id = workshop_id
    if report_url is not None and not result_url:
        result_url = report_url

    result_kind = request_kind + 1000

    tags: list[list[str]] = [
        ["status", STATUS_SUCCESS],
        ["output", "text/markdown"],
    ]

    if job_request_id:
        tags.append(["e", job_request_id])
    if customer_pubkey:
        tags.append(["p", customer_pubkey])
    if result_url:
        tags.append(["i", result_url, "url"])
    if workshop_id is not None:
        tags.append(["param", "workshop_id", workshop_id])
    if pr_url:
        tags.append(["param", "pr_url", pr_url])

    if metrics:
        for key, value in metrics.items():
            tags.append(["param", key, str(value)])

    if extra_tags:
        tags.extend(extra_tags)

    if not content:
        parts: list[str] = []
        if workshop_id is not None:
            parts.append(f"Analysis complete for workshop #{workshop_id}.")
        if result_url:
            parts.append(f"Report: {result_url}")
        if pr_title:
            parts.append(f"PR: {pr_title}")
        if summary:
            parts.append(f"\n{summary}")
        content = "\n".join(parts) if parts else "Job complete."

    return _publish_event(nsec_file, result_kind, content, tags, relays)


def publish_nip89_announcement(
    nsec_file: str,
    name: str = "",
    about: str = "",
    handled_kinds: list = None,
    picture: str = "",
    website: str = "",
    lud16: str = "",
    relays: list = None,
    extra_tags: list = None,
) -> dict:
    """Publish a NIP-89 service announcement (kind 31989).

    Makes the DVM discoverable to Nostr clients. Should be published once
    (or periodically).

    Args:
        nsec_file: Path to file containing hex Nostr private key.
        name: Service display name.
        about: Service description.
        handled_kinds: List of request kind numbers this DVM handles
                       (e.g. [5500]). Each becomes a ["k", "<kind>"] tag.
        picture: Profile picture URL.
        website: Website URL.
        lud16: Lightning address for NIP-90 payments.
        relays: Relay list override.
        extra_tags: Additional tags (e.g. topic tags like ["t", "bitcoin"]).
    """
    if handled_kinds is None:
        handled_kinds = [KIND_JOB_REQUEST]

    content = json.dumps({
        "name": name,
        "about": about,
        "picture": picture,
        "banner": "",
        "website": website,
        "lud16": lud16,
    })

    tags: list[list[str]] = []
    for k in handled_kinds:
        tags.append(["k", str(k)])

    if extra_tags:
        tags.extend(extra_tags)

    return _publish_event(nsec_file, KIND_NIP89_ANNOUNCE, content, tags, relays)


def publish_text_note(
    nsec_file: str,
    content: str,
    relays: list = None,
    extra_tags: list = None,
) -> dict:
    """Publish a kind 1 text note (human-visible in regular Nostr clients).

    Most Nostr clients (Damus, Amethyst, Iris, etc.) only render kind 1 events.
    Use this alongside NIP-90 result events for maximum visibility.
    """
    tags = list(extra_tags) if extra_tags else []
    return _publish_event(nsec_file, KIND_TEXT_NOTE, content, tags, relays)


# --- BCR-agent compatibility wrappers ---


def publish_processing_status(
    nsec_file: str,
    workshop_id: str,
    stage: str,
    relays: list = None,
) -> dict:
    """Publish job feedback: processing (kind 7000).

    Convenience wrapper around publish_job_feedback for the processing status.
    """
    return publish_job_feedback(
        nsec_file=nsec_file,
        status=STATUS_PROCESSING,
        extra_info=stage,
        content=json.dumps({"workshop_id": workshop_id, "stage": stage}),
        relays=relays,
        extra_tags=[["param", "workshop_id", workshop_id]],
    )


def publish_error(
    nsec_file: str,
    workshop_id: str,
    error_message: str,
    relays: list = None,
) -> dict:
    """Publish job feedback: error (kind 7000).

    Convenience wrapper around publish_job_feedback for the error status.
    """
    return publish_job_feedback(
        nsec_file=nsec_file,
        status=STATUS_ERROR,
        extra_info=error_message[:200],
        content=error_message,
        relays=relays,
        extra_tags=[["param", "workshop_id", workshop_id]],
    )


def announce_completion(
    nsec_file: str,
    workshop_id: str,
    report_url: str,
    pr_title: str = "",
    pr_url: str = "",
    metrics: dict = None,
    relays: list = None,
) -> list:
    """Full announcement sequence: publish job result + text note.

    This is the main entry point called by pipelines after completion.

    Returns:
        List of result dicts from each published event.
    """
    results: list[dict] = []

    result = publish_job_result(
        nsec_file=nsec_file,
        workshop_id=workshop_id,
        report_url=report_url,
        pr_title=pr_title,
        pr_url=pr_url,
        metrics=metrics,
        relays=relays,
    )
    results.append({"event": "job_result", **result})

    note_lines = [
        f"Analysis complete for workshop #{workshop_id}.",
    ]
    if pr_title:
        note_lines.append(f"PR: {pr_title}")
    note_lines.append(f"Full report: {report_url}")

    if metrics:
        note_lines.append("")
        for key, value in metrics.items():
            note_lines.append(f"  {key}: {value}")

    result = publish_text_note(
        nsec_file=nsec_file,
        content="\n".join(note_lines),
        relays=relays,
    )
    results.append({"event": "text_note", **result})

    return results


# --- CLI entry point ---

if __name__ == "__main__":
    nsec_file = os.environ.get("NSEC_FILE", "")
    if not nsec_file:
        print("Set NSEC_FILE env var pointing to your hex private key file")
        sys.exit(1)

    relays_env = os.environ.get("NOSTR_RELAYS", "")
    if relays_env:
        cli_relays = [r.strip() for r in relays_env.split(",") if r.strip()]
    else:
        cli_relays = ["wss://relay.damus.io"]

    result = publish_text_note(
        nsec_file=nsec_file,
        content="nostr_publisher smoke test",
        relays=cli_relays,
    )
    print(json.dumps(result, indent=2))
