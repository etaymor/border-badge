---
status: ready
priority: p1
issue_id: "001"
tags: [code-review, performance, python, blocking]
dependencies: []
---

# Facebook SDK `execute()` Blocks asyncio Event Loop

## Problem Statement

The `facebook-business` Python SDK's `EventRequest.execute()` is a **synchronous blocking call** that uses the `requests` library internally. Because `send_event()` is declared `async`, this call runs directly on the asyncio event loop, **blocking all other request handling** for the duration of the Facebook API round-trip (typically 200-1000ms).

This means every ad event will stall the entire FastAPI server. The `asyncio.gather()` in `service.py` provides no concurrency benefit because one of the two gathered coroutines blocks the thread — TikTok events won't begin sending until the Facebook call completes.

## Findings

- **File:** `backend/app/services/ad_events/facebook_capi.py:108`
- **Call chain:** `EventRequest.execute()` → `AdsPixel.create_event()` → `FacebookRequest.execute()` → `FacebookAdsApi.call()` → `self._session.requests.request()` (synchronous `requests` library)
- **Flagged by:** Performance Oracle, Architecture Strategist, Python Reviewer (all three reviewers independently identified this)
- **Impact:** Under load, a single slow Facebook response (2-3s during Meta API degradation) will stall the entire worker, affecting all endpoints

## Proposed Solutions

### Option A: Wrap in `asyncio.to_thread()` (Recommended)
**Pros:** One-line fix, minimal risk, keeps SDK
**Cons:** Still depends on the heavy facebook-business SDK
**Effort:** Small
**Risk:** Low

```python
import asyncio
response = await asyncio.to_thread(event_request.execute)
```

### Option B: Replace SDK with direct httpx calls
**Pros:** Eliminates blocking issue AND ~88ms cold start overhead AND ~15MB dependency, matches TikTok pattern
**Cons:** More code to write, must handle Facebook CAPI manually
**Effort:** Medium
**Risk:** Low (TikTok integration already proves the pattern works)

### Option C: Use FastAPI BackgroundTasks (complements A or B)
**Pros:** Returns 200 immediately, processes in background
**Cons:** Doesn't fix the blocking issue within the background task itself
**Effort:** Small
**Risk:** Low

## Recommended Action

Option A is the quickest fix. Option B is the best long-term solution.

## Technical Details

**Affected files:**
- `backend/app/services/ad_events/facebook_capi.py` (line 108)

## Acceptance Criteria

- [ ] `event_request.execute()` no longer blocks the asyncio event loop
- [ ] Facebook CAPI and TikTok events execute concurrently (verify with timing logs)
- [ ] All existing backend tests pass

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-14 | Identified during code review | facebook-business SDK is sync-only; asyncio.to_thread() is the standard workaround |

## Resources

- PR #101: https://github.com/etaymor/border-badge/pull/101
- Facebook Business SDK source: uses `requests` internally
- Python docs: [asyncio.to_thread](https://docs.python.org/3/library/asyncio-task.html#asyncio.to_thread)
