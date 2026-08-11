---
status: ready
priority: p1
issue_id: "002"
tags: [code-review, security, rate-limiting]
dependencies: []
---

# No Rate Limiting on `/ad-events` Endpoint

## Problem Statement

The `POST /ad-events` endpoint has no rate limiting. Every other mutating endpoint in the codebase uses a `@limiter.limit()` decorator. An authenticated attacker (or compromised client) could call this endpoint in a tight loop, causing:

- **Fan-out amplification:** Each request triggers 2 outbound API calls (Facebook CAPI + TikTok Events API)
- **API quota exhaustion:** Rapid consumption of Facebook and TikTok API quotas/budgets
- **Cost implications:** Both APIs may bill per event
- **Analytics pollution:** Junk events distort conversion data

## Findings

- **File:** `backend/app/api/ad_events.py:20`
- **Flagged by:** Security Sentinel
- **Context:** These are lifecycle events that fire at most a few times per user. Expected legitimate rate is <10 events/minute per user.

## Proposed Solutions

### Option A: Add standard rate limit decorator (Recommended)
**Pros:** Consistent with codebase pattern, simple
**Cons:** None
**Effort:** Small
**Risk:** Low

```python
@limiter.limit("10/minute")
@router.post("")
async def post_ad_event(request: Request, body: AdEventRequest, user: CurrentUser) -> dict:
```

### Option B: Per-event-type deduplication on server
**Pros:** Prevents duplicate events even within the rate limit window
**Cons:** Requires database table, more complex
**Effort:** Medium
**Risk:** Low

## Recommended Action

Option A — add rate limiting immediately.

## Technical Details

**Affected files:**
- `backend/app/api/ad_events.py`

## Acceptance Criteria

- [ ] `POST /ad-events` has a rate limit decorator
- [ ] Rate limit is appropriate for expected usage (e.g., 10/minute)
- [ ] Verify the `request: Request` parameter is added for the limiter

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-14 | Identified during security review | All mutating endpoints should have rate limits |

## Resources

- PR #101: https://github.com/etaymor/border-badge/pull/101
