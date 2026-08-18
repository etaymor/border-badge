---
status: ready
priority: p3
issue_id: "012"
tags: [code-review, python, dry]
dependencies: []
---

# Duplicated `_hash_sha256` Function

## Problem Statement

`_hash_sha256` is identically defined in both `facebook_capi.py` (line 51) and `tiktok_events.py` (line 29). DRY violation — if normalization logic changes, both must be updated.

## Proposed Solutions

Extract to `backend/app/services/ad_events/utils.py`:

```python
import hashlib

def hash_pii_sha256(value: str) -> str:
    return hashlib.sha256(value.strip().lower().encode("utf-8")).hexdigest()
```

## Acceptance Criteria

- [ ] Single `_hash_sha256` implementation shared by both clients
