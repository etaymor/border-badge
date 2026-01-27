---
status: complete
priority: p2
issue_id: "004"
tags: [code-review, quality, pr-76]
dependencies: []
---

# assert used for runtime validation

## Problem Statement

`assert _nlp is not None` is used to check that the spaCy model is loaded. Asserts are stripped when Python runs with `-O`, making this a no-op in optimized production builds.

## Findings

- **Source:** kieran-python-reviewer, security-sentinel
- **Location:** `backend/app/services/place_extractor/ner_extraction.py` line ~99
- **Evidence:** `assert _nlp is not None` instead of proper runtime check

## Proposed Solutions

### Option A: Replace with RuntimeError (Recommended)

```python
if _nlp is None:
    raise RuntimeError("spaCy model not loaded — call load_model() first")
```

- **Effort:** Small
- **Risk:** Low

## Technical Details

**Affected files:**
- `backend/app/services/place_extractor/ner_extraction.py`

## Acceptance Criteria

- [ ] `assert` replaced with explicit `if/raise RuntimeError`
- [ ] Error message is descriptive

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-27 | Created from PR #76 code review | Identified by kieran-python-reviewer and security-sentinel |

## Resources

- PR #76: feat: upgrade place extraction with Text Search API and spaCy NER
