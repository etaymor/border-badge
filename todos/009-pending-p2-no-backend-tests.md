---
status: ready
priority: p2
issue_id: "009"
tags: [code-review, testing, python]
dependencies: []
---

# No Backend Tests for Ad Events Module

## Problem Statement

There are no tests for any of the new backend files. For a feature that touches external APIs, billing-adjacent data (purchase events), and PII (email hashing), this needs coverage.

## Findings

- **Flagged by:** Python Reviewer
- **New files with zero tests:**
  - `backend/app/api/ad_events.py`
  - `backend/app/schemas/ad_events.py`
  - `backend/app/services/ad_events/service.py`
  - `backend/app/services/ad_events/facebook_capi.py`
  - `backend/app/services/ad_events/tiktok_events.py`

## Proposed Solutions

### Tests to write:
1. Unit tests for `_hash_sha256` (verify normalization: whitespace trimming, lowercasing)
2. Unit tests for `EVENT_NAME_MAP` lookups and fallback behavior
3. Tests for `send_event` when credentials are not configured (early return path)
4. Tests for `track_ad_event` fan-out: one platform fails, the other still succeeds
5. Tests for `AdEventRequest` schema validation
6. Integration test for `POST /ad-events` endpoint

**Existing patterns to follow:** `backend/tests/services/test_email.py`, `backend/tests/test_skimlinks.py`

## Technical Details

**Affected files:**
- Create `backend/tests/services/test_ad_events.py` (or similar)

## Acceptance Criteria

- [ ] `_hash_sha256` normalization verified
- [ ] Both platform clients tested with mock HTTP responses
- [ ] Fan-out tested: one failure doesn't block the other
- [ ] Schema validation tested
- [ ] Endpoint returns 200 with valid input

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-14 | Identified during code review | External API integrations need mock-based tests |
