#!/usr/bin/env python3
"""Thin shim — delegates to the nostr_publish package."""
from nostr_publish.blossom import compute_sha256, upload_to_blossom, guess_content_type
