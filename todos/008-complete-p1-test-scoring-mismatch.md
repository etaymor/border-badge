---
status: complete
priority: p1
issue_id: "008"
tags: [code-review, testing, bug, pr-76]
dependencies: []
---

# Test/code mismatch in country penalty scoring

## Problem Statement

`test_scoring.py` line ~237 expects a -0.15 country mismatch penalty, but `scoring.py` may apply a different value (-0.25). If so, the test will fail against production code. This needs verification — either the test or the code is wrong.

## Findings

- **Source:** code-simplicity-reviewer
- **Location:** `backend/tests/services/test_scoring.py` line ~237, `backend/app/services/place_extractor/scoring.py` line ~293
- **Evidence:** Test docstring says "-0.15 penalty (reduced from -0.5)" but code may apply -0.25

## Proposed Solutions

### Option A: Verify and align test with code
Run the test to confirm whether it passes or fails, then fix whichever is wrong.

- **Effort:** Small
- **Risk:** Low

## Acceptance Criteria

- [ ] Test and code agree on country mismatch penalty value
- [ ] `poetry run pytest backend/tests/services/test_scoring.py` passes

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-27 | Created from PR #76 simplicity review | Potential bug found by code-simplicity-reviewer |
