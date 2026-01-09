---
status: completed
priority: p3
issue_id: "008"
tags:
  - code-review
  - dead-code
  - cleanup
dependencies: []
---

# Dead ensureRowVisible Function

## Problem Statement

The `ensureRowVisible` function in `usePassportAnimations` is a no-op that does nothing, but it's still exported and called 4 times in PassportScreen.tsx.

## Findings

**Agent:** code-simplicity-reviewer

**Location:** `/mobile/src/hooks/usePassportAnimations.ts` (lines 141-143)

**Code:**
```typescript
const ensureRowVisible = useCallback((_rowKey: string, _animValues: Animated.Value[]) => {
  // Not needed with new approach
}, []);
```

**Evidence:**
- Comment says "Not needed with new approach"
- Parameters are underscore-prefixed indicating intentional unused
- Function body is empty

## Proposed Solutions

### Option A: Remove function and call sites (Recommended)
**Pros:** Removes dead code
**Cons:** Slightly breaking change for external consumers (unlikely any)
**Effort:** Low
**Risk:** Low

### Option B: Keep for API stability
**Pros:** No breaking change
**Cons:** Dead code remains
**Effort:** None
**Risk:** Low

## Recommended Action

Remove the function and all 4 call sites in PassportScreen.tsx.

## Technical Details

**Files:**
- `/mobile/src/hooks/usePassportAnimations.ts` - remove function
- `/mobile/src/screens/passport/PassportScreen.tsx` - remove calls

**Acceptance Criteria:**
- [x] Function removed from hook
- [x] All call sites removed
- [x] Tests pass

## Work Log

### 2025-12-31 - Completed
**By:** Claude Code Review Resolution Agent
**Actions:**
- Removed ensureRowVisible function from usePassportAnimations.ts (lines 140-143)
- Removed function from return object (line 273)
- Removed destructuring from PassportScreen.tsx (line 57)
- Removed call site in renderStampRow function (line 236)
- Removed call site in renderUnvisitedRow function (line 247)
- Removed from dependency arrays in both callbacks
- Fixed pre-existing lint error in ContinentCountryGridScreen.tsx
- All PassportScreen tests pass (8/8)
- Lint passes with 0 errors (only 1 pre-existing warning in unrelated file)

**Learnings:**
- Dead code should be removed, not commented
- No-op functions create misleading APIs
- Always run lint --fix to catch auto-fixable issues

### 2025-12-31 - Approved for Work
**By:** Claude Triage System
**Actions:**
- Issue approved during triage session
- Status changed from pending → ready
- Ready to be picked up and worked on

**Learnings:**
- Dead code should be removed, not commented
- No-op functions create misleading APIs

## Resources

- PR #41: https://github.com/etaymor/border-badge/pull/41
- Hook: `/mobile/src/hooks/usePassportAnimations.ts`
- Screen: `/mobile/src/screens/passport/PassportScreen.tsx`
