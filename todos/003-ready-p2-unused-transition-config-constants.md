---
status: ready
priority: p2
issue_id: "003"
tags:
  - code-review
  - dead-code
  - cleanup
dependencies: []
---

# Unused Constants in transitionConfig.ts

## Problem Statement

12+ constants in `transitionConfig.ts` are defined but never used anywhere in the codebase. These "just in case" constants add confusion about what values are actually in use.

## Findings

**Agent:** code-simplicity-reviewer

**Location:** `/mobile/src/navigation/transitionConfig.ts`

**Unused Constants:**
- `SPRING_CONFIG_SNAPPY` (lines 38-42) - only in test file
- `TRANSITION_SPEC_SNAPPY` (lines 77-80) - only in test file
- `DURATION_MICRO` (line 93)
- `DURATION_STANDARD` (line 96)
- `DURATION_ELABORATE` (line 99)
- `STAGGER_DELAY_FAST` (line 110)
- `SCALE_LONG_PRESS` (line 124)
- `SCALE_BACKGROUND_SUBTLE` (line 127)
- `OPACITY_BACKGROUND` (line 132)
- `OPACITY_OVERLAY` (line 135)
- `GESTURE_VELOCITY_THRESHOLD` (line 140)
- `GESTURE_RESPONSE_DISTANCE` (line 143)
- `BORDER_RADIUS_CARD` (line 148)
- `BORDER_RADIUS_FULLSCREEN` (line 151)

**Evidence:** Grep search for each constant shows no usage outside the definition and test files.

## Proposed Solutions

### Option A: Remove unused constants (Recommended)
**Pros:** Clear what's actually used
**Cons:** Need to re-add if needed later
**Effort:** Low
**Risk:** Low

### Option B: Keep with comments marking as "reserved"
**Pros:** Documents intent
**Cons:** Still clutters the file
**Effort:** None
**Risk:** Low

## Recommended Action

Remove unused constants. Keep only what is actively imported elsewhere.

## Technical Details

**File:** `/mobile/src/navigation/transitionConfig.ts`
**Estimated LOC Reduction:** ~35 lines

**Constants to Keep:**
- `SPRING_FRICTION`, `SPRING_TENSION_IN`, `SPRING_TENSION_OUT`
- `SPRING_CONFIG_DEFAULT`, `SPRING_CONFIG_GENTLE`, `SPRING_CONFIG_BOUNCY`
- `TRANSITION_SPEC_DEFAULT`
- `STAGGER_DELAY_DEFAULT`, `STAGGER_MAX_DURATION`
- `SCALE_PREVIOUS_SCREEN`, `SCALE_PRESS`

**Acceptance Criteria:**
- [ ] Unused constants removed
- [ ] All imports still resolve
- [ ] Tests pass

## Work Log

### 2025-12-31 - Approved for Work
**By:** Claude Triage System
**Actions:**
- Issue approved during triage session
- Status changed from pending → ready
- Ready to be picked up and worked on

**Learnings:**
- Speculative constants add confusion
- Keep configuration focused on actual usage

## Resources

- PR #41: https://github.com/etaymor/border-badge/pull/41
- File: `/mobile/src/navigation/transitionConfig.ts`
