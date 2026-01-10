---
status: ready
priority: p3
issue_id: "007"
tags:
  - code-review
  - react-patterns
  - cleanup
dependencies:
  - "002"
---

# Side Effect in useMemo (useStaggeredEntrance)

## Problem Statement

`useStaggeredEntrance` uses `useMemo` for its side effect (mutating an array), not for memoization. This is an anti-pattern because React may skip executing the memo callback in certain situations.

## Findings

**Agent:** kieran-typescript-reviewer

**Location:** `/mobile/src/hooks/useStaggeredEntrance.ts` (lines 94-103)

**Code:**
```typescript
useMemo(() => {
  // Add new values if needed
  while (animationValues.length < itemCount) {
    animationValues.push(new Animated.Value(0));  // Side effect!
  }
  // Remove extra values if count decreased
  while (animationValues.length > itemCount) {
    animationValues.pop();  // Side effect!
  }
}, [itemCount, animationValues]);
```

## Note

This issue is blocked by TODO #002. If `useStaggeredEntrance` is deleted (recommended), this issue becomes moot.

## Proposed Solutions

### Option A: Delete the file (if TODO #002 is accepted)
**Pros:** Removes the problem entirely
**Cons:** None if hook isn't used
**Effort:** N/A
**Risk:** N/A

### Option B: Fix if keeping the hook
**Pros:** Correct React patterns
**Cons:** May change behavior subtly
**Effort:** Medium
**Risk:** Medium

```typescript
const animationValues = useMemo(() => {
  return Array.from({ length: itemCount }, () => new Animated.Value(0));
}, [itemCount]);
```

## Recommended Action

Resolve TODO #002 first. If hook is deleted, close this as N/A. If keeping, implement Option B.

## Technical Details

**File:** `/mobile/src/hooks/useStaggeredEntrance.ts`

**Acceptance Criteria:**
- [ ] Either file deleted or pattern fixed
- [ ] No useMemo used for side effects

## Work Log

### 2025-12-31 - Approved for Work
**By:** Claude Triage System
**Actions:**
- Issue approved during triage session
- Status changed from pending → ready
- Depends on TODO #002 being implemented first
- Ready to be picked up after dependency resolved

**Learnings:**
- useMemo is for memoization, not side effects
- Should only work on this after implementing useStaggeredEntrance in ContinentCountryGridScreen

## Resources

- PR #41: https://github.com/etaymor/border-badge/pull/41
- React useMemo docs: https://react.dev/reference/react/useMemo
- File: `/mobile/src/hooks/useStaggeredEntrance.ts`
