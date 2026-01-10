---
status: done
priority: p2
issue_id: "004"
tags:
  - code-review
  - typescript
  - bug-risk
dependencies: []
---

# Stale isBreathing Return Value in useBreathingAnimation

## Problem Statement

The `isBreathing` return value from `useBreathingAnimation` returns a snapshot of `isBreathingRef.current` at render time, not a reactive value. Consumers will see stale state.

## Findings

**Agent:** kieran-typescript-reviewer

**Location:** `/mobile/src/hooks/useBreathingAnimation.ts` (lines 102-108)

**Code:**
```typescript
return {
  breathingScale,
  startBreathing,
  stopBreathing,
  isBreathing: isBreathingRef.current,  // <-- Problem
};
```

**Impact:**
- Any component using `isBreathing` to conditionally render will have incorrect state
- Could cause bugs if used for disabling buttons or showing indicators

## Proposed Solutions

### Option A: Remove isBreathing from return type (Recommended)
**Pros:** Prevents misuse
**Cons:** Consumers lose visibility into animation state
**Effort:** Low
**Risk:** Low (check for existing usages first)

### Option B: Convert to proper React state
**Pros:** Reactive and correct
**Cons:** Causes re-renders when animation starts/stops
**Effort:** Medium
**Risk:** Low

### Option C: Add JSDoc warning
**Pros:** Preserves current behavior with documentation
**Cons:** Doesn't fix the actual issue
**Effort:** Low
**Risk:** Medium (developers may ignore warning)

## Recommended Action

Search for usages of `isBreathing`. If none exist, remove it. If usages exist, convert to proper state.

## Technical Details

**File:** `/mobile/src/hooks/useBreathingAnimation.ts`

**To Find Usages:**
```bash
grep -r "isBreathing" mobile/src --include="*.tsx"
```

**If converting to state:**
```typescript
const [isBreathing, setIsBreathing] = useState(false);

const startBreathing = useCallback(() => {
  setIsBreathing(true);
  // ... existing animation code
}, [...]);

const stopBreathing = useCallback(() => {
  setIsBreathing(false);
  // ... existing cleanup code
}, [...]);
```

**Acceptance Criteria:**
- [x] Either removed or made reactive
- [x] Tests updated (no tests existed)
- [x] No consumer code broken

## Work Log

### 2025-12-31 - Resolved
**By:** Claude Code Resolution Agent
**Actions:**
- Searched for all usages of `isBreathing` in codebase
- Confirmed no consumers use the `isBreathing` return value
- Removed `isBreathing` from `UseBreathingAnimationResult` interface
- Removed `isBreathing: isBreathingRef.current` from return statement
- Added JSDoc note explaining the hook doesn't expose animation state
- Verified TypeScript compilation passes
- Verified Prettier formatting passes
- Verified no consumer code broken (CountryGridItem.tsx and StampCard.tsx only use breathingScale, startBreathing, stopBreathing)

**Solution:** Implemented Option A (Remove isBreathing from return type)

**Learnings:**
- Refs in return values cause stale state
- Hook APIs must return reactive values or nothing
- Always check for actual usage before removing API surface

## Resources

- PR #41: https://github.com/etaymor/border-badge/pull/41
- File: `/mobile/src/hooks/useBreathingAnimation.ts`
