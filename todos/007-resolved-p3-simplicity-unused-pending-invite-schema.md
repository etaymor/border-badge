# Unused PendingInvite Schema Class

---
status: resolved
priority: p3
issue_id: "007"
tags: [code-review, simplicity, cleanup]
dependencies: []
---

## Problem Statement

The `PendingInvite` class in the invites schema is defined but never used. Only `PendingInviteSummary` is used in the API.

## Findings

### Agent: code-simplicity-reviewer

**Location:** `backend/app/schemas/invites.py` (lines 25-36)

```python
class PendingInvite(BaseModel):  # Never imported or used
    id: UUID
    inviter_id: UUID
    email: str
    invite_type: Literal["follow", "trip_tag"]
    trip_id: UUID | None = None
    invite_code: str
    status: str
    created_at: datetime
    accepted_at: datetime | None = None

class PendingInviteSummary(BaseModel):  # Actually used
    id: str
    email: str
    invite_type: str
    status: str
    created_at: datetime
```

## Proposed Solutions

### Solution A: Remove Unused Class (Recommended)
**Effort:** Tiny (5 minutes)
**Risk:** None
**Pros:** Cleaner code
**Cons:** None

Delete lines 25-36.

## Recommended Action
**Solution A** - Remove unused `PendingInvite` class.

## Technical Details

**Affected Files:**
- `backend/app/schemas/invites.py`

**Lines to Remove:** 12 lines

## Acceptance Criteria

- [ ] Unused class removed
- [ ] No import errors
- [ ] Tests still pass

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2025-12-26 | Identified during code review | Remove unused code |

## Resources

- PR #34: https://github.com/etaymor/border-badge/pull/34
