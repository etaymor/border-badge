---
status: resolved
priority: p3
issue_id: "009"
tags:
  - code-review
  - consistency
  - api-design
dependencies: []
---

# SharedEntryPressable Missing onPressIn/onPressOut Props

## Problem Statement

`SharedEntryPressable` is missing `onPressIn` and `onPressOut` handlers that exist in `SharedTripPressable` and `SharedCountryPressable`, creating API inconsistency.

## Findings

**Agent:** architecture-strategist, pattern-recognition-specialist

**Location:** `/mobile/src/components/transitions/SharedEntryImage.tsx` (lines 53-90)

**Comparison:**
- `SharedCountryPressable` has `onPressIn` and `onPressOut` props
- `SharedTripPressable` has `onPressIn` and `onPressOut` props
- `SharedEntryPressable` does NOT have these props

## Proposed Solutions

### Option A: Add missing props (Recommended)
**Pros:** Consistent API across all shared element components
**Cons:** Slightly more code
**Effort:** Low
**Risk:** Low

### Option B: Create shared base interface
**Pros:** Prevents future inconsistencies
**Cons:** More abstraction
**Effort:** Medium
**Risk:** Low

## Recommended Action

Add `onPressIn` and `onPressOut` props to `SharedEntryPressable` for consistency.

## Technical Details

**File:** `/mobile/src/components/transitions/SharedEntryImage.tsx`

**Add to Interface:**
```typescript
interface SharedEntryPressableProps extends SharedEntryImageProps {
  onPress?: () => void;
  onLongPress?: () => void;
  onPressIn?: () => void;   // Add
  onPressOut?: () => void;  // Add
  accessibilityRole?: 'button' | 'link' | 'none';
  accessibilityLabel?: string;
}
```

**Add to Component:**
```typescript
<Transition.Pressable
  ...
  onPressIn={onPressIn}
  onPressOut={onPressOut}
>
```

**Acceptance Criteria:**
- [x] Props added to interface
- [x] Props passed to Transition.Pressable
- [x] Consistent with other SharedPressable components

## Work Log

### 2025-12-31 - Resolved
**By:** Claude Code Review Resolution
**Actions:**
- Added onPressIn and onPressOut to SharedEntryPressableProps interface
- Updated SharedEntryPressable component to destructure and pass new props
- Added comprehensive tests for new handlers
- Verified consistency with SharedCountryPressable and SharedTripPressable
- All tests passing (10/10)
- Formatting verified with Prettier

**Files Changed:**
- /Users/emerson/Sites/border-badge/mobile/src/components/transitions/SharedEntryImage.tsx
- /Users/emerson/Sites/border-badge/mobile/src/__tests__/components/transitions/SharedEntryImage.test.tsx

**Verification:**
- Interface now matches SharedCountryPressable and SharedTripPressable
- Props are correctly passed to Transition.Pressable component
- Test coverage added for onPressIn and onPressOut handlers
- Code formatted and linted

### 2025-12-31 - Approved for Work
**By:** Claude Triage System
**Actions:**
- Issue approved during triage session
- Status changed from pending → ready
- Ready to be picked up and worked on

**Learnings:**
- API consistency matters for DX
- Shared component families should have uniform interfaces

## Resources

- PR #41: https://github.com/etaymor/border-badge/pull/41
- File: `/mobile/src/components/transitions/SharedEntryImage.tsx`
