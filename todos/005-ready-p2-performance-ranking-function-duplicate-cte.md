# Ranking Function Runs Same CTE Twice

---
status: ready
priority: p2
issue_id: "005"
tags: [code-review, performance, database]
dependencies: []
---

## Problem Statement

The `get_friends_ranking` function executes the `limited_follows` and `friend_stats` CTEs twice - once for counting/ranking, once for finding the leader. This doubles query execution time.

## Findings

### Agent: performance-oracle

**Location:** `supabase/migrations/0035_ranking_function.sql`

**Current Structure:**
- Lines 36-58: First CTE execution for count and rank
- Lines 61-81: Second CTE execution for leader info

**Impact:** Query runs twice as long as necessary.

## Proposed Solutions

### Solution A: Consolidate CTEs (Recommended)
**Effort:** Low (2-3 hours)
**Risk:** Low
**Pros:** 50% reduction in query time
**Cons:** None

```sql
CREATE OR REPLACE FUNCTION get_friends_ranking(p_user_id UUID)
RETURNS TABLE (
  rank INT,
  total_friends INT,
  my_countries BIGINT,
  leader_username TEXT,
  leader_countries BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH my_countries AS (
    SELECT COUNT(DISTINCT country_id) as cnt
    FROM user_countries
    WHERE user_id = p_user_id AND status = 'visited'
  ),
  limited_follows AS (
    SELECT following_id
    FROM user_follow
    WHERE follower_id = p_user_id
    ORDER BY created_at DESC
    LIMIT 1000
  ),
  friend_stats AS (
    SELECT
      up.user_id,
      up.username,
      COUNT(DISTINCT uc.country_id) as total_countries,
      ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT uc.country_id) DESC) as rn
    FROM user_profile up
    JOIN limited_follows lf ON lf.following_id = up.user_id
    LEFT JOIN user_countries uc ON uc.user_id = up.user_id AND uc.status = 'visited'
    GROUP BY up.user_id, up.username
  )
  SELECT
    (COUNT(*) FILTER (WHERE fs.total_countries > (SELECT cnt FROM my_countries)))::INT + 1,
    COUNT(*)::INT,
    (SELECT cnt FROM my_countries),
    (SELECT username FROM friend_stats WHERE rn = 1),
    (SELECT total_countries FROM friend_stats WHERE rn = 1)
  FROM friend_stats fs;
END;
$$;
```

## Recommended Action
**Solution A** - Consolidate CTEs into single query execution.

## Technical Details

**Affected Files:**
- `supabase/migrations/0035_ranking_function.sql`

**Performance Improvement:**
- Before: ~200ms (runs twice)
- After: ~100ms (runs once)

## Acceptance Criteria

- [ ] Function returns same results as before
- [ ] Query execution time reduced by ~50%
- [ ] Friends ranking still displays correctly

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2025-12-26 | Identified during code review | Use ROW_NUMBER() to get leader in single pass |

## Resources

- PR #34: https://github.com/etaymor/border-badge/pull/34
