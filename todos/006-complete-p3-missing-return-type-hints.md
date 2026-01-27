---
status: complete
priority: p3
issue_id: "006"
tags: [code-review, quality, pr-76]
dependencies: []
---

# Missing -> None return type hints on test methods

## Problem Statement

Test functions in the new/modified test files lack `-> None` return type annotations.

## Findings

- **Source:** kieran-python-reviewer
- **Location:** Test files in `backend/tests/services/`

## Proposed Solutions

### Option A: Add -> None to all test functions

- **Effort:** Small
- **Risk:** None

## Technical Details

**Affected files:**
- `backend/tests/services/test_ner_extraction.py`
- `backend/tests/services/test_candidate_extraction.py`
- `backend/tests/services/test_scoring.py`
- `backend/tests/services/test_place_extractor.py`

## Acceptance Criteria

- [ ] All test functions have `-> None` return type hint

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-27 | Created from PR #76 code review | Identified by kieran-python-reviewer |
