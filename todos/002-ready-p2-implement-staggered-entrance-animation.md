---
status: ready
priority: p2
issue_id: "002"
tags:
  - code-review
  - animation
  - enhancement
  - ux
dependencies: []
---

# Implement Staggered Entrance Animation in ContinentCountryGridScreen

## Problem Statement

The `useStaggeredEntrance` hook (277 lines) is fully implemented and tested but never used. Meanwhile, `ContinentCountryGridScreen` fades in the entire country grid as one unit, missing an opportunity for polished card-by-card stagger animation like the main PassportScreen.

## Findings

**Agent:** code-simplicity-reviewer (modified during triage)

**Location:**
- **Hook:** `/mobile/src/hooks/useStaggeredEntrance.ts` (277 lines)
- **Target Screen:** `/mobile/src/screens/onboarding/ContinentCountryGridScreen.tsx` (lines 69-92, 279)

**Current Behavior:**
- Entire grid fades in with single `gridOpacity` animation
- No per-card stagger effect
- Less polished than PassportScreen's diagonal wave

**Opportunity:**
- Hook exists and is ready to use
- Would provide card-by-card stagger animation (fade + slide)
- Matches the premium animation quality of PassportScreen

## Proposed Solutions

### Option A: Implement useStaggeredEntrance in ContinentCountryGridScreen (Recommended)
**Pros:** Polished UX, leverages existing code, consistent with PassportScreen
**Cons:** Slightly more complex than current implementation
**Effort:** Medium (2-3 hours)
**Risk:** Low

### Option B: Delete the hook and keep simple fade
**Pros:** Clean codebase
**Cons:** Missed UX opportunity, wastes implemented code
**Effort:** Low
**Risk:** Low

## Recommended Action

Implement `useStaggeredEntrance` in `ContinentCountryGridScreen` to provide card-by-card stagger animation for country grid entrance.

## Technical Details

**Files to Modify:**
- `/mobile/src/screens/onboarding/ContinentCountryGridScreen.tsx`
- Export `useStaggeredEntrance` from `/mobile/src/hooks/index.ts` if not already exported

**Implementation Steps:**
1. Import `useStaggeredEntrance` in ContinentCountryGridScreen
2. Replace grid-level `gridOpacity` animation with per-card stagger
3. Wrap CountryCard components in Animated.View with staggered styles
4. Use `staggerDelay: 30-50ms` for smooth wave effect
5. Test with different continent sizes (Africa ~54 cards, Oceania ~14 cards)

**Acceptance Criteria:**
- [ ] Country cards animate in one-by-one with stagger effect
- [ ] Animation performance is smooth (60fps)
- [ ] Works across all continents (different card counts)
- [ ] Existing tests still pass
- [ ] Hook is exported from hooks/index.ts

## Work Log

### 2025-12-31 - Approved for Work (Modified During Triage)
**By:** Claude Triage System
**Actions:**
- Issue reviewed during triage session
- User identified ContinentCountryGridScreen as intended use case
- Status changed from pending → ready
- Changed from deletion to implementation task
- Ready to be picked up and worked on

**Learnings:**
- Context matters - what looks like dead code may be incomplete feature
- Onboarding grid would benefit from same polish as main passport screen

## Resources

- PR #41: https://github.com/etaymor/border-badge/pull/41
- Hook: `/mobile/src/hooks/useStaggeredEntrance.ts`
- Target: `/mobile/src/screens/onboarding/ContinentCountryGridScreen.tsx`
