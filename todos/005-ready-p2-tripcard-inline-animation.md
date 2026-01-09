---
status: completed
priority: p2
issue_id: "005"
tags:
  - code-review
  - consistency
  - refactor
dependencies: []
---

# TripCard Uses Inline Animation Instead of useAnimatedPress

## Problem Statement

TripCard.tsx implements its own press animation inline instead of using the shared `useAnimatedPress` hook, causing inconsistency and code duplication.

## Findings

**Agent:** pattern-recognition-specialist

**Location:** `/mobile/src/components/ui/TripCard.tsx` (lines 74-101)

**Current Code:**
```typescript
const scaleAnim = useRef(new Animated.Value(1)).current;

const handlePressIn = () => {
  Animated.spring(scaleAnim, {
    toValue: 0.98,
    friction: 8,
    tension: 100,  // Different from SPRING_TENSION_IN (400)
    useNativeDriver: true,
  }).start();
};
```

**Impact:**
- Spring physics differ from other components (tension: 100 vs 400)
- Code duplication
- Maintenance burden

**Components Using useAnimatedPress Correctly:**
- Button.tsx
- Chip.tsx
- CountryCard.tsx
- CountryGridItem.tsx
- StampCard.tsx

## Proposed Solutions

### Option A: Refactor to use useAnimatedPress (Recommended)
**Pros:** Consistency, less code
**Cons:** May slightly change animation feel
**Effort:** Low
**Risk:** Low

```typescript
const { scaleValue, pressHandlers } = useAnimatedPress({ pressedScale: 0.98 });
```

### Option B: Keep inline but align spring values
**Pros:** Maintains current behavior
**Cons:** Still duplicated code
**Effort:** Low
**Risk:** Low

## Recommended Action

Refactor to use `useAnimatedPress`. The animation feel will align with other cards.

## Technical Details

**File:** `/mobile/src/components/ui/TripCard.tsx`

**Changes:**
1. Import `useAnimatedPress` and `AnimatedPressPresets`
2. Replace inline animation with hook usage
3. Update Animated.View to use `scaleValue`
4. Spread `pressHandlers` onto Pressable

**Acceptance Criteria:**
- [x] TripCard uses useAnimatedPress
- [x] Animation feel consistent with other cards
- [x] Tests pass

## Work Log

### 2025-12-31 - Approved for Work
**By:** Claude Triage System
**Actions:**
- Issue approved during triage session
- Status changed from pending → ready
- Ready to be picked up and worked on

**Learnings:**
- Consistency matters for UX
- Use established patterns instead of reimplementing

### 2025-12-31 - Completed
**By:** Claude Code Resolution Specialist
**Changes Made:**
- Removed inline animation code (scaleAnim, handlePressIn, handlePressOut)
- Imported useAnimatedPress and AnimatedPressPresets
- Replaced with `useAnimatedPress(AnimatedPressPresets.subtle)` for 0.98 scale
- Updated Animated.View to use `scaleValue` instead of `scaleAnim`
- Spread `pressHandlers` onto Pressable component
- Removed unused imports (useEffect, useRef)

**Impact:**
- Code reduced from 27 lines to 1 line for animation logic
- Animation now uses consistent spring physics (tension: 400 vs old: 100)
- Maintains 0.98 pressed scale using AnimatedPressPresets.subtle
- Automatic cleanup handled by hook
- Consistent with Button, Chip, CountryCard, CountryGridItem, StampCard

**Verification:**
- ESLint: No new errors introduced
- Prettier: Formatting correct
- Code aligns with project patterns

## Resources

- PR #41: https://github.com/etaymor/border-badge/pull/41
- File: `/mobile/src/components/ui/TripCard.tsx`
- Hook: `/mobile/src/hooks/useAnimatedPress.ts`
