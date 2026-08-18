---
status: ready
priority: p2
issue_id: "005"
tags: [code-review, performance, architecture]
dependencies: ["001"]
---

# Endpoint Awaits Full Fan-Out Before Responding

## Problem Statement

The `POST /ad-events` endpoint awaits the full `asyncio.gather()` of both Facebook CAPI and TikTok Events API before returning. Combined with the blocking Facebook SDK issue (#001), this means the mobile client blocks for the max(Facebook RTT, TikTok RTT) — typically 300-1000ms.

Ad events are analytics-grade data where eventual consistency is acceptable. Fire-and-forget semantics are appropriate.

## Findings

- **File:** `backend/app/api/ad_events.py:23-29`
- **Flagged by:** Performance Oracle, Architecture Strategist
- **Mobile impact:** `sendToServer` in `adEvents.ts` awaits this response, adding latency to the sign-up flow

## Proposed Solutions

### Option A: Use FastAPI BackgroundTasks (Recommended)
**Pros:** Returns 200 immediately, processes asynchronously
**Cons:** Errors are less visible (only in logs)
**Effort:** Small
**Risk:** Low

```python
from fastapi import BackgroundTasks

@router.post("")
async def post_ad_event(
    body: AdEventRequest, user: CurrentUser, background_tasks: BackgroundTasks
) -> dict:
    background_tasks.add_task(track_ad_event, ...)
    return {"status": "ok"}
```

## Technical Details

**Affected files:**
- `backend/app/api/ad_events.py`

## Acceptance Criteria

- [ ] Endpoint returns 200 immediately without waiting for fan-out
- [ ] Fan-out still executes in the background
- [ ] Errors are still logged

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-14 | Identified during code review | Non-critical fan-out should use BackgroundTasks |
