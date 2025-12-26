# Race Condition in Follow Operation

---
status: ready
priority: p2
issue_id: "011"
tags: [code-review, data-integrity, backend]
dependencies: []
---

## Problem Statement

The follow operation has a Time-Of-Check-To-Time-Of-Use (TOCTOU) race condition. Between checking if a follow exists and creating a new one, another request could create the follow, causing an HTTP 500 error.

## Findings

### Agent: data-integrity-guardian

**Location:** `backend/app/api/follows.py` (lines 89-124)

```python
# Line 89-99: Check exists
existing = await db.get(
    "user_follow",
    {
        "select": "id",
        "follower_id": f"eq.{user.id}",
        "following_id": f"eq.{user_id}",
    },
)

if existing:
    return FollowResponse(status="already_following", following_id=str(user_id))

# Gap here allows race condition!

# Line 117-124: Create follow
await db.post(
    "user_follow",
    {
        "follower_id": str(user.id),
        "following_id": str(user_id),
    },
)
```

**Impact:**
- Concurrent requests both pass existence check
- One succeeds, one fails with constraint violation (HTTP 500)
- Poor user experience with duplicate tap

## Proposed Solutions

### Solution A: Use Upsert (ON CONFLICT) (Recommended)
**Effort:** Medium (2-3 hours)
**Risk:** Low
**Pros:** Atomic operation, no race condition
**Cons:** Requires database function or raw SQL

```sql
INSERT INTO user_follow (follower_id, following_id)
VALUES ($1, $2)
ON CONFLICT (follower_id, following_id) DO NOTHING
RETURNING id;
```

### Solution B: Catch Constraint Violation
**Effort:** Small (1 hour)
**Risk:** Low
**Pros:** Simple code change
**Cons:** Not as clean

```python
try:
    await db.post(...)
except UniqueViolation:
    return FollowResponse(status="already_following", ...)
```

## Recommended Action
**Solution A** - Use upsert for atomic operation.

## Technical Details

**Affected Files:**
- `backend/app/api/follows.py`
- Possibly new migration for RPC function

## Acceptance Criteria

- [ ] Follow operation is atomic
- [ ] Duplicate follows don't cause HTTP 500
- [ ] Idempotent behavior maintained

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2025-12-26 | Identified during data integrity review | Use upsert for idempotent operations |

## Resources

- PR #34: https://github.com/etaymor/border-badge/pull/34
