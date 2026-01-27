---
status: complete
priority: p2
issue_id: "005"
tags: [code-review, testing, pr-76]
dependencies: []
---

# Missing pytest.mark.asyncio decorators on async tests

## Problem Statement

Async test functions may be missing `@pytest.mark.asyncio` decorators. Without them, pytest won't properly execute the coroutines.

## Findings

- **Source:** kieran-python-reviewer
- **Location:** `backend/tests/services/test_candidate_extraction.py`, `backend/tests/services/test_place_extractor.py`

## Proposed Solutions

### Option A: Add decorators to async tests (Recommended)
Add `@pytest.mark.asyncio` to all `async def test_*` functions.

- **Effort:** Small
- **Risk:** Low

### Option B: Configure asyncio_mode = "auto"
Add `asyncio_mode = "auto"` to `pyproject.toml` pytest config.

- **Effort:** Small
- **Risk:** Low (may affect other tests)

## Technical Details

**Affected files:**
- `backend/tests/services/test_candidate_extraction.py`
- `backend/tests/services/test_place_extractor.py`

## Acceptance Criteria

- [ ] All async test functions have `@pytest.mark.asyncio` or auto mode enabled
- [ ] `poetry run pytest` passes

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-27 | Created from PR #76 code review | Identified by kieran-python-reviewer |

## Resources

- PR #76: feat: upgrade place extraction with Text Search API and spaCy NER
