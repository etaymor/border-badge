# Missing DELETE RLS Policy for pending_invite Table

---
status: resolved
priority: p1
issue_id: "009"
tags: [code-review, security, database]
dependencies: []
---

## Problem Statement

The `pending_invite` table has INSERT, SELECT, and UPDATE policies but NO DELETE policy. This means users cannot cancel their pending invites - the API appears to succeed but the database silently ignores the delete.

## Findings

### Agent: security-sentinel

**Location:** `supabase/migrations/0033_social_tables.sql` (lines 125-139)

```sql
-- RLS Policies for pending_invite
CREATE POLICY "Users can view their own invites"
  ON pending_invite FOR SELECT
  USING (inviter_id = auth.uid());

CREATE POLICY "Users can create invites"
  ON pending_invite FOR INSERT
  WITH CHECK (inviter_id = auth.uid());

CREATE POLICY "Users can update their own invites"
  ON pending_invite FOR UPDATE
  USING (inviter_id = auth.uid());

-- NO DELETE POLICY!
```

**API Code That Fails Silently:**
```python
# backend/app/api/invites.py (lines 172-208)
await db.delete(
    "pending_invite",
    {
        "id": f"eq.{invite_id}",
        "inviter_id": f"eq.{user.id}",
    },
)
```

## Proposed Solutions

### Solution A: Add DELETE Policy (Recommended)
**Effort:** Tiny (10 minutes)
**Risk:** None
**Pros:** Fixes broken functionality
**Cons:** None

```sql
CREATE POLICY "Users can delete their own invites"
  ON pending_invite FOR DELETE
  USING (inviter_id = auth.uid());
```

## Recommended Action
**Solution A** - Add the missing DELETE policy.

## Technical Details

**Affected Files:**
- `supabase/migrations/0033_social_tables.sql` (or new migration)

## Acceptance Criteria

- [ ] DELETE policy exists for pending_invite
- [ ] Users can cancel their pending invites
- [ ] API delete endpoint works correctly

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2025-12-26 | Identified during security review | Always verify RLS policies for all CRUD operations |

## Resources

- PR #34: https://github.com/etaymor/border-badge/pull/34
