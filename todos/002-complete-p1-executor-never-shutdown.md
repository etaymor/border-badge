---
status: complete
priority: p1
issue_id: "002"
tags: [code-review, performance, pr-76]
dependencies: []
---

# ThreadPoolExecutor never shut down

## Problem Statement

`_ner_executor = ThreadPoolExecutor(max_workers=2)` is created at module level in `ner_extraction.py` but never shut down. This leaks threads on application shutdown.

## Findings

- **Source:** performance-oracle, architecture-strategist
- **Location:** `backend/app/services/place_extractor/ner_extraction.py` line 19
- **Evidence:** No `shutdown()` call anywhere in the codebase for `_ner_executor`

## Proposed Solutions

### Option A: Add shutdown function called from lifespan (Recommended)

```python
# ner_extraction.py
def shutdown_executor() -> None:
    _ner_executor.shutdown(wait=False)

# main.py lifespan
yield
shutdown_executor()
```

- **Pros:** Simple, clean resource management
- **Cons:** None
- **Effort:** Small
- **Risk:** Low

## Recommended Action
<!-- Filled during triage -->

## Technical Details

**Affected files:**
- `backend/app/services/place_extractor/ner_extraction.py`
- `backend/app/main.py`

## Acceptance Criteria

- [ ] `_ner_executor.shutdown()` is called during app shutdown
- [ ] No thread leak on graceful shutdown

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-27 | Created from PR #76 code review | Identified by performance-oracle and architecture-strategist |

## Resources

- PR #76: feat: upgrade place extraction with Text Search API and spaCy NER
