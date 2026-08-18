---
status: ready
priority: p2
issue_id: "003"
tags: [code-review, security, validation, python]
dependencies: []
---

# Unconstrained `event_name` Accepts Arbitrary Strings

## Problem Statement

The `event_name` field in `AdEventRequest` is an unconstrained `str`. Both Facebook and TikTok clients have a fallback that passes unrecognized names through verbatim to ad platforms:

```python
fb_event_name = EVENT_NAME_MAP.get(event_name, event_name)  # Falls through!
```

An attacker could send arbitrary event names, polluting ad analytics and potentially poisoning conversion optimization algorithms.

## Findings

- **File:** `backend/app/schemas/ad_events.py:9`
- **Flagged by:** Security Sentinel, Architecture Strategist, Python Reviewer
- **Only 5 valid events exist:** CompleteRegistration, StartTrial, Subscribe, FirstTripCreated, FirstPhotoImport

## Proposed Solutions

### Option A: Use `Literal` type constraint (Recommended)
**Pros:** Automatic 422 validation, zero additional code
**Cons:** None
**Effort:** Small
**Risk:** Low

```python
from typing import Literal

class AdEventRequest(BaseModel):
    event_name: Literal[
        "CompleteRegistration", "StartTrial", "Subscribe",
        "FirstTripCreated", "FirstPhotoImport",
    ]
```

## Technical Details

**Affected files:**
- `backend/app/schemas/ad_events.py`

## Acceptance Criteria

- [ ] `event_name` is constrained to the 5 known events
- [ ] Unknown event names return 422 from FastAPI
- [ ] Mobile client event names match the backend allowlist

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-14 | Identified during code review | Use Literal types for constrained string fields |
