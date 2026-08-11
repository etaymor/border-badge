---
status: ready
priority: p3
issue_id: "011"
tags: [code-review, simplification, python]
dependencies: []
---

# Dead `timestamp` Field in Schema (Accepted but Never Used)

## Problem Statement

`AdEventRequest.timestamp` is a required field that the mobile sends, but neither `facebook_capi.py` nor `tiktok_events.py` reads it. Both generate their own `int(time.time())`. The field is dead code that creates confusion.

## Findings

- **Files:** `backend/app/schemas/ad_events.py:12`, `mobile/src/services/adEvents.ts:43`
- **Flagged by:** Architecture Strategist, Simplicity Reviewer

## Proposed Solutions

Remove `timestamp` from `AdEventRequest` and from the mobile `sendToServer` call.

## Acceptance Criteria

- [ ] `timestamp` field removed from schema
- [ ] `timestamp` removed from mobile `sendToServer` payload
