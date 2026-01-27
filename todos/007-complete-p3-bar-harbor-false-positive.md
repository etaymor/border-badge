---
status: complete
priority: p3
issue_id: "007"
tags: [code-review, quality, pr-76]
dependencies: []
---

# "Bar Harbor" false positive in type inference

## Problem Statement

The regex `r"\b(bar|cafe|restaurant|...)\b"` for inferring place type matches place names like "Bar Harbor" as a food establishment. The word-boundary match is too broad for short common words.

## Findings

- **Source:** kieran-python-reviewer
- **Location:** `backend/app/services/place_extractor/ner_extraction.py`
- **Evidence:** `bar` in regex matches "Bar Harbor" → incorrectly inferred as food type

## Proposed Solutions

### Option A: Require keyword at entity start or as sole word

```python
# Only match if keyword is the first word or the entire entity
re.compile(r"^(bar|cafe|restaurant|...)\b", re.IGNORECASE)
```

- **Effort:** Small
- **Risk:** Low (may miss some valid cases like "The Bar")

### Option B: Exclude known geographic false positives
Maintain a small exclusion list for common geographic names containing food words.

- **Effort:** Small
- **Risk:** Low

## Technical Details

**Affected files:**
- `backend/app/services/place_extractor/ner_extraction.py`

## Acceptance Criteria

- [ ] "Bar Harbor" no longer inferred as food type
- [ ] Legitimate food places like "Joe's Bar" still detected

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-27 | Created from PR #76 code review | Identified by kieran-python-reviewer |
