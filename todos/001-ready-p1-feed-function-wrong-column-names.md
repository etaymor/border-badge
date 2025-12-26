# Feed Function References Non-Existent Columns

---
status: ready
priority: p1
issue_id: "001"
tags: [code-review, database, migration, critical]
dependencies: []
---

## Problem Statement

The `get_activity_feed` and `get_user_activity_feed` database functions reference columns that do not exist on the `entry` table. This will cause **100% of feed queries to fail** with "column does not exist" errors.

## Findings

### Agent: data-migration-expert

**Location:**
- `supabase/migrations/0034_feed_function.sql` (lines 86-88)
- `supabase/migrations/0039_user_activity_feed.sql` (lines 97-99)

**Wrong Column References:**

| Referenced Column | Actual Column |
|-------------------|---------------|
| `e.name` | `e.title` |
| `e.entry_type` | `e.type` |
| `e.location_name` | Does not exist |

**Evidence:**
The `entry` table schema from `0001_init_schema.sql`:
```sql
CREATE TABLE entry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  type entry_type NOT NULL,  -- NOT entry_type as referenced
  title TEXT NOT NULL,       -- NOT name as referenced
  notes TEXT,
  metadata JSONB,
  date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

There is **no `location_name` column** on the entry table.

## Proposed Solutions

### Solution A: Fix Column References (Recommended)
**Effort:** Small (1-2 hours)
**Risk:** Low
**Pros:** Direct fix, clear solution
**Cons:** None

Update both migration files:
```sql
-- In both 0034_feed_function.sql and 0039_user_activity_feed.sql:
-- Change:
e.name as entry_name,
e.entry_type::TEXT,
e.location_name,
-- To:
e.title as entry_name,
e.type::TEXT as entry_type,
NULL::TEXT as location_name,  -- or derive from place table if needed
```

### Solution B: Add Missing Column
**Effort:** Medium (3-4 hours)
**Risk:** Medium - requires data backfill
**Pros:** Location data would be available
**Cons:** Requires schema change and potentially backfilling data

Add `location_name` column to entry table.

## Recommended Action
**Solution A** - Fix column references in migration files.

## Technical Details

**Affected Files:**
- `supabase/migrations/0034_feed_function.sql`
- `supabase/migrations/0039_user_activity_feed.sql`

**Affected Components:**
- Activity feed endpoint (`GET /feed`)
- User feed endpoint (`GET /feed/user/{user_id}`)
- FeedScreen component
- UserProfileScreen feed section

**Database Changes:**
- Modify `get_activity_feed` function
- Modify `get_user_activity_feed` function

## Acceptance Criteria

- [ ] `e.name` replaced with `e.title` in both functions
- [ ] `e.entry_type` replaced with `e.type` in both functions
- [ ] `e.location_name` replaced with `NULL::TEXT` or derived value
- [ ] Feed endpoint returns data without errors
- [ ] User feed endpoint returns data without errors
- [ ] Mobile app displays feed correctly

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2025-12-26 | Identified during code review | Column names in migrations must match schema |

## Resources

- PR #34: https://github.com/etaymor/border-badge/pull/34
- Entry schema: `supabase/migrations/0001_init_schema.sql`
