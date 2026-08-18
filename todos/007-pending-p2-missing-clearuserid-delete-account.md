---
status: ready
priority: p2
issue_id: "007"
tags: [code-review, typescript, privacy]
dependencies: []
---

# Missing `AdEvents.clearUserId()` in `useDeleteAccount`

## Problem Statement

`AdEvents.clearUserId()` is called in `useSignOut` but not in `useDeleteAccount`. When a user deletes their account, the Facebook user ID remains associated until the next `clearUserId` call. User data should be cleared on account deletion for privacy compliance.

## Findings

- **File:** `mobile/src/hooks/useAuth.ts` — `useDeleteAccount` handler (around line 263)
- **Flagged by:** TypeScript Reviewer
- **Parity issue:** `useSignOut` (line 236) calls `AdEvents.clearUserId()` but `useDeleteAccount` does not

## Proposed Solutions

### Option A: Add `AdEvents.clearUserId()` to `useDeleteAccount` (Recommended)
**Effort:** Small

Add `AdEvents.clearUserId()` to the `useDeleteAccount` `onSuccess` handler, matching the pattern in `useSignOut`.

## Technical Details

**Affected files:**
- `mobile/src/hooks/useAuth.ts`

## Acceptance Criteria

- [ ] `AdEvents.clearUserId()` is called when a user deletes their account
- [ ] Facebook user data is cleared on account deletion

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-14 | Identified during code review | Privacy cleanup must cover both sign-out AND account deletion paths |
