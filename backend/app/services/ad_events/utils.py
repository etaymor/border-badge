"""Shared utilities for ad event services."""

import hashlib


def hash_pii_sha256(value: str) -> str:
    """Hash PII value for ad platform advanced matching."""
    return hashlib.sha256(value.strip().lower().encode("utf-8")).hexdigest()
