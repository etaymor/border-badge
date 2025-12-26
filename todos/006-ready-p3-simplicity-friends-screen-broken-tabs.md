# FriendsScreen Tab UI Doesn't Work

---
status: ready
priority: p3
issue_id: "006"
tags: [code-review, ui, mobile, simplicity]
dependencies: []
---

## Problem Statement

The FriendsScreen has tab UI for "following"/"followers" but clicking the tabs doesn't change the displayed data. The list always shows "following" data regardless of which tab is selected.

## Findings

### Agent: code-simplicity-reviewer

**Location:** `mobile/src/screens/friends/FriendsScreen.tsx`

**Issues:**
- Line 21: `activeTab` state defined
- Lines 103-124, 138-153: Tab UI rendered
- Line 171: FlatList always shows `following` data regardless of tab

**Impact:** Confusing UX - tabs appear interactive but don't work.

## Proposed Solutions

### Solution A: Remove Broken Tab UI (Recommended)
**Effort:** Small (30 minutes)
**Risk:** Low
**Pros:** Simplifies code, removes broken feature
**Cons:** None

Remove ~35 lines of unused tab code.

### Solution B: Fix Tab Functionality
**Effort:** Medium (2-3 hours)
**Risk:** Low
**Pros:** Tabs work as expected
**Cons:** More code complexity

Implement data switching when tabs are clicked.

## Recommended Action
**Solution A** - Remove broken tabs. There are already separate FollowersListScreen and FollowingListScreen for this functionality.

## Technical Details

**Affected Files:**
- `mobile/src/screens/friends/FriendsScreen.tsx`

**Lines to Remove:** ~35 lines

## Acceptance Criteria

- [ ] Tab UI removed OR functioning correctly
- [ ] No confusing non-functional UI elements
- [ ] Screen displays following list clearly

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2025-12-26 | Identified during code review | Don't ship non-functional UI |

## Resources

- PR #34: https://github.com/etaymor/border-badge/pull/34
