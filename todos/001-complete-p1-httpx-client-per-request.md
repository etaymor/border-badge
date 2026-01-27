---
status: complete
priority: p1
issue_id: "001"
tags: [code-review, performance, pr-76]
dependencies: []
---

# httpx.AsyncClient created per request — no connection pooling

## Problem Statement

`text_search_place()` in `google_places_client.py` creates a new `httpx.AsyncClient()` on every call. This means no HTTP connection reuse, no connection pooling, and unnecessary TLS handshake overhead for each Google Places API request. The same pattern exists in `search_places()` and `get_place_details()`.

At scale (10+ concurrent users), this causes ~2,700 client instantiations/minute and significant latency overhead (5-10ms per instantiation).

## Findings

- **Source:** performance-oracle, security-sentinel
- **Location:** `backend/app/services/place_extractor/google_places_client.py` lines 287-318 (and similar in `search_places`, `get_place_details`)
- **Evidence:** `async with httpx.AsyncClient(timeout=API_TIMEOUT_SECONDS) as client:` creates a new client per call

## Proposed Solutions

### Option A: Module-level shared client (Recommended)
Create a module-level `httpx.AsyncClient` with connection pooling, cleaned up in FastAPI lifespan.

```python
_http_client: httpx.AsyncClient | None = None

async def get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(
            timeout=API_TIMEOUT_SECONDS,
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=50)
        )
    return _http_client
```

- **Pros:** Simple, reuses connections, 30-50% latency reduction
- **Cons:** Global mutable state (acceptable for singleton pattern)
- **Effort:** Small
- **Risk:** Low

### Option B: FastAPI dependency injection
Pass client via `app.state` and inject into route handlers.

- **Pros:** More testable, explicit lifecycle
- **Cons:** Requires plumbing through multiple layers
- **Effort:** Medium
- **Risk:** Low

## Recommended Action
<!-- Filled during triage -->

## Technical Details

**Affected files:**
- `backend/app/services/place_extractor/google_places_client.py`
- `backend/app/main.py` (add cleanup in lifespan)

## Acceptance Criteria

- [ ] All Google Places API functions use a shared httpx.AsyncClient
- [ ] Client is properly closed during app shutdown
- [ ] Connection pooling is verified (keepalive connections reused)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-27 | Created from PR #76 code review | Identified by performance-oracle and security-sentinel agents |

## Resources

- PR #76: feat: upgrade place extraction with Text Search API and spaCy NER
- [httpx connection pooling docs](https://www.python-httpx.org/advanced/clients/)
