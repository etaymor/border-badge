# Follow Stats Endpoint Fetches All Rows to Count

---
status: resolved
priority: p2
issue_id: "003"
tags: [code-review, performance, backend]
dependencies: []
---

## Problem Statement

The follow stats endpoint fetches ALL follow relationship rows just to count them in Python. For users with many followers, this transfers thousands of UUIDs over the network just to return a count.

## Findings

### Agent: performance-oracle

**Location:** `backend/app/api/follows.py` (lines 203-234)

**Current Implementation:**
```python
# Get follower count
followers = await db.get(
    "user_follow",
    {
        "select": "id",
        "following_id": f"eq.{user.id}",
    },
)
# Get following count
following = await db.get(
    "user_follow",
    {
        "select": "id",
        "follower_id": f"eq.{user.id}",
    },
)
return FollowStats(
    follower_count=len(followers) if followers else 0,
    following_count=len(following) if following else 0,
)
```

**Impact at Scale:**
- User with 10,000 followers: transfers 10,000 UUIDs just to return `10000`
- Linear memory cost O(n)
- Network latency increases with follower count

## Proposed Solutions

### Solution A: Use Database COUNT (Recommended)
**Effort:** Small (1-2 hours)
**Risk:** Low
**Pros:** Efficient, no data transfer overhead
**Cons:** None

```python
# Use Supabase RPC or count feature
result = await db.rpc(
    "get_follow_stats",
    {"p_user_id": str(user.id)},
)
```

With database function:
```sql
CREATE OR REPLACE FUNCTION get_follow_stats(p_user_id UUID)
RETURNS TABLE (follower_count BIGINT, following_count BIGINT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    (SELECT COUNT(*) FROM user_follow WHERE following_id = p_user_id),
    (SELECT COUNT(*) FROM user_follow WHERE follower_id = p_user_id);
$$;
```

### Solution B: Use Supabase HEAD Count
**Effort:** Small (1 hour)
**Risk:** Low
**Pros:** Uses existing API features
**Cons:** May not be supported by custom client

## Recommended Action
**Solution A** - Create database function for follow stats.

## Technical Details

**Affected Files:**
- `backend/app/api/follows.py`
- New migration for `get_follow_stats` function

**Performance Improvement:**
- Before: O(n) memory and network transfer
- After: O(1) - single integer returned

## Acceptance Criteria

- [ ] Follow stats endpoint returns count without fetching all rows
- [ ] Response time < 50ms for users with 10,000+ followers
- [ ] Memory usage constant regardless of follower count

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2025-12-26 | Identified during code review | Always use COUNT in database, not len() in Python |

## Resources

- PR #34: https://github.com/etaymor/border-badge/pull/34
