---
status: ready
priority: p1
issue_id: "001"
tags:
  - code-review
  - accessibility
  - animation
dependencies: []
---

# Missing Reduced Motion Accessibility Support

## Problem Statement

The animation system does not check for `AccessibilityInfo.isReduceMotionEnabled()` or the iOS "Reduce Motion" setting. This is a WCAG 2.1 Level AA compliance issue that affects users with vestibular disorders or motion sensitivity.

## Findings

**Agent:** agent-native-reviewer

**Location:** All animation hooks:
- `/mobile/src/hooks/useAnimatedPress.ts`
- `/mobile/src/hooks/useBreathingAnimation.ts`
- `/mobile/src/hooks/useStaggeredEntrance.ts`
- `/mobile/src/hooks/usePassportAnimations.ts`
- `/mobile/src/hooks/useCountrySelectionAnimations.ts`

**Evidence:** Searched for `reduceMotion|Reduce.Motion|accessibilityReduceMotion|prefers-reduced-motion` - zero results in the codebase.

**Impact:**
- Users with vestibular disorders experience unwanted animations
- App fails WCAG 2.1 Level AA accessibility requirements
- Potential App Store accessibility issues

## Proposed Solutions

### Option A: Create useReducedMotion Hook (Recommended)
**Pros:** Centralized, reusable across all animation hooks
**Cons:** Requires updating all animation hooks to consume it
**Effort:** Medium
**Risk:** Low

```typescript
// hooks/useReducedMotion.ts
import { AccessibilityInfo } from 'react-native';
import { useEffect, useState } from 'react';

export function useReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion
    );
    return () => subscription.remove();
  }, []);

  return reduceMotion;
}
```

### Option B: Add disabled prop to each hook
**Pros:** Per-hook control
**Cons:** More boilerplate, requires consumers to handle
**Effort:** Low
**Risk:** Medium (easy to forget)

## Recommended Action

Implement Option A and update all animation hooks to respect the reduced motion setting.

## Technical Details

**Affected Files:**
- Create: `/mobile/src/hooks/useReducedMotion.ts`
- Update: All animation hooks to import and use `useReducedMotion`

**Acceptance Criteria:**
- [ ] `useReducedMotion` hook created
- [ ] All animations skip or use simplified versions when reduce motion is enabled
- [ ] Test with iOS "Reduce Motion" accessibility setting enabled
- [ ] Unit tests for the new hook

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2025-12-31 | Created during PR #41 review | Critical accessibility gap identified |

## Resources

- PR #41: https://github.com/etaymor/border-badge/pull/41
- WCAG 2.1 Motion Requirements: https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions
- React Native AccessibilityInfo: https://reactnative.dev/docs/accessibilityinfo
