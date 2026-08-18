---
status: ready
priority: p2
issue_id: "004"
tags: [code-review, performance, python]
dependencies: []
---

# New httpx.AsyncClient Created Per TikTok Request

## Problem Statement

Every TikTok event creates a fresh `httpx.AsyncClient`, which means a new TCP connection + TLS handshake (~50-150ms overhead) per call. The codebase already has a shared HTTP client with connection pooling at `backend/app/core/http_client.py`.

## Findings

- **File:** `backend/app/services/ad_events/tiktok_events.py:84`
- **Flagged by:** Performance Oracle, Python Reviewer
- **Existing pattern:** `get_http_client()` singleton in `app/core/http_client.py`

## Proposed Solutions

### Option A: Use existing shared HTTP client (Recommended)
**Pros:** Connection pooling, follows codebase pattern, zero new code
**Cons:** Shares timeout with other uses (override per-request)
**Effort:** Small
**Risk:** Low

```python
from app.core.http_client import get_http_client

client = get_http_client()
response = await client.post(TIKTOK_EVENTS_URL, ..., timeout=10.0)
```

## Technical Details

**Affected files:**
- `backend/app/services/ad_events/tiktok_events.py`

## Acceptance Criteria

- [ ] TikTok events reuse a shared httpx.AsyncClient
- [ ] Connection pooling is active (no per-request TLS handshake)
- [ ] Timeout is still 10 seconds for TikTok calls

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-14 | Identified during code review | Always reuse httpx clients for connection pooling |
