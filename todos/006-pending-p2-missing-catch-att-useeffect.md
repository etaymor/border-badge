---
status: ready
priority: p2
issue_id: "006"
tags: [code-review, typescript, error-handling]
dependencies: []
---

# Missing `.catch()` on ATT useEffect in EmotionalHookScreen

## Problem Statement

The async ATT tracking request in `EmotionalHookScreen.tsx` has no `.catch()`. If `requestTrackingPermissionsAsync()` throws (which can happen on older iOS versions or edge cases), this produces an unhandled promise rejection that can crash the app.

## Findings

- **File:** `mobile/src/screens/onboarding/EmotionalHookScreen.tsx:47`
- **Flagged by:** TypeScript Reviewer
- **Current code:** `requestTracking();` — fire-and-forget with no error handling

## Proposed Solutions

### Option A: Add `.catch()` (Recommended)
**Effort:** Small

```typescript
requestTracking().catch((error) => {
  console.warn('[ATT] Failed to request tracking permission:', error);
});
```

## Technical Details

**Affected files:**
- `mobile/src/screens/onboarding/EmotionalHookScreen.tsx`

## Acceptance Criteria

- [ ] `requestTracking()` has a `.catch()` handler
- [ ] ATT failures are logged, not thrown

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-14 | Identified during code review | Always handle promise rejections in useEffect |
