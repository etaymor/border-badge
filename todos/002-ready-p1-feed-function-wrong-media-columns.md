# Feed Function References Wrong Media Columns

---
status: ready
priority: p1
issue_id: "002"
tags: [code-review, database, migration, critical]
dependencies: []
---

## Problem Statement

The feed functions reference `mf.url` and use status value `'completed'` which do not exist. The actual column is `file_path` and the status enum values are `'processing'`, `'uploaded'`, `'failed'`.

## Findings

### Agent: data-migration-expert

**Location:**
- `supabase/migrations/0034_feed_function.sql` (lines 89-95)
- `supabase/migrations/0039_user_activity_feed.sql` (lines 100-106)

**Current Code:**
```sql
SELECT mf.url FROM media_files mf
WHERE mf.entry_id = e.id
  AND mf.status = 'completed'
```

**Problems:**
1. `mf.url` does not exist - the column is `file_path`
2. `'completed'` is not a valid enum value - valid values are `'processing'`, `'uploaded'`, `'failed'`

**Evidence from schema:**
```sql
CREATE TYPE media_status AS ENUM ('processing', 'uploaded', 'failed');

CREATE TABLE media_files (
  ...
  file_path TEXT NOT NULL,   -- NOT url
  ...
  status media_status NOT NULL DEFAULT 'processing',
  ...
);
```

**Impact:** Entry images will always be NULL in the feed.

## Proposed Solutions

### Solution A: Fix Column and Enum References (Recommended)
**Effort:** Small (30 minutes)
**Risk:** Low
**Pros:** Direct fix
**Cons:** None

```sql
-- Change:
SELECT mf.url FROM media_files mf
WHERE mf.entry_id = e.id
  AND mf.status = 'completed'
-- To:
SELECT mf.file_path FROM media_files mf
WHERE mf.entry_id = e.id
  AND mf.status = 'uploaded'
```

## Recommended Action
**Solution A** - Fix column and enum references.

## Technical Details

**Affected Files:**
- `supabase/migrations/0034_feed_function.sql`
- `supabase/migrations/0039_user_activity_feed.sql`

**Database Changes:**
- Modify `get_activity_feed` function
- Modify `get_user_activity_feed` function

## Acceptance Criteria

- [ ] `mf.url` replaced with `mf.file_path` in both functions
- [ ] `mf.status = 'completed'` replaced with `mf.status = 'uploaded'`
- [ ] Entry images appear correctly in feed
- [ ] Mobile app displays entry images

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2025-12-26 | Identified during code review | Must verify enum values match schema |

## Resources

- PR #34: https://github.com/etaymor/border-badge/pull/34
- Media schema: `supabase/migrations/0001_init_schema.sql`
