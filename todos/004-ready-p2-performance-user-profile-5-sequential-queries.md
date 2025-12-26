# User Profile Endpoint Makes 5 Sequential Queries

---
status: ready
priority: p2
issue_id: "004"
tags: [code-review, performance, backend]
dependencies: []
---

## Problem Statement

The `get_user_profile` endpoint makes 5 sequential database queries to build a single user profile response, resulting in ~150-300ms response times.

## Findings

### Agent: performance-oracle

**Location:** `backend/app/api/users.py` (lines 212-314)

**Sequential Queries:**
1. Get user profile
2. Check for blocks (bidirectional)
3. Get country count
4. Get follower count
5. Get following count
6. Check if viewer is following

**Impact:** ~150-300ms response time due to sequential round-trips.

## Proposed Solutions

### Solution A: Create Consolidated Database Function (Recommended)
**Effort:** Medium (4-6 hours)
**Risk:** Low
**Pros:** Single query, significant performance improvement
**Cons:** More complex SQL function

```sql
CREATE OR REPLACE FUNCTION get_user_profile_full(
  p_viewer_id UUID,
  p_username TEXT
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  country_count BIGINT,
  follower_count BIGINT,
  following_count BIGINT,
  is_following BOOLEAN,
  is_blocked BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    up.id,
    up.user_id,
    up.username,
    up.display_name,
    up.avatar_url,
    (SELECT COUNT(*) FROM user_countries uc WHERE uc.user_id = up.user_id AND uc.status = 'visited'),
    (SELECT COUNT(*) FROM user_follow uf WHERE uf.following_id = up.user_id),
    (SELECT COUNT(*) FROM user_follow uf WHERE uf.follower_id = up.user_id),
    EXISTS(SELECT 1 FROM user_follow WHERE follower_id = p_viewer_id AND following_id = up.user_id),
    EXISTS(SELECT 1 FROM user_block WHERE
      (blocker_id = p_viewer_id AND blocked_id = up.user_id) OR
      (blocker_id = up.user_id AND blocked_id = p_viewer_id)
    )
  FROM user_profile up
  WHERE LOWER(up.username) = LOWER(p_username);
END;
$$;
```

### Solution B: Parallel Query Execution
**Effort:** Medium (3-4 hours)
**Risk:** Medium - more complex error handling
**Pros:** No database changes
**Cons:** Still 5 round-trips, just parallel

## Recommended Action
**Solution A** - Create consolidated database function.

## Technical Details

**Affected Files:**
- `backend/app/api/users.py`
- New migration for `get_user_profile_full` function

**Performance Improvement:**
- Before: 5 queries × 30ms = ~150ms
- After: 1 query × 30ms = ~30ms

## Acceptance Criteria

- [ ] User profile endpoint uses single database call
- [ ] Response time < 50ms for profile lookups
- [ ] All profile data still returned correctly

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2025-12-26 | Identified during code review | Consolidate multiple queries into single function |

## Resources

- PR #34: https://github.com/etaymor/border-badge/pull/34
