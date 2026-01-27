---
status: complete
priority: p2
issue_id: "003"
tags: [code-review, quality, pr-76]
dependencies: []
---

# Bare exception swallowing at startup

## Problem Statement

The spaCy model loading in `main.py` lifespan uses `except Exception` which silently swallows all errors. If the model fails to load, NER silently stops working with no clear signal beyond a warning log.

## Findings

- **Source:** kieran-python-reviewer, architecture-strategist
- **Location:** `backend/app/main.py` line ~120
- **Evidence:** `except Exception:` with only `logger.error(...)` — no `exc_info=True`, no specific exception types

## Proposed Solutions

### Option A: Log with exc_info and differentiate exception types (Recommended)

```python
except ImportError as e:
    logger.warning(f"spaCy not installed: {e} — NER disabled")
except Exception as e:
    logger.error(f"spaCy model load failed: {e} — NER disabled", exc_info=True)
```

- **Effort:** Small
- **Risk:** Low

## Technical Details

**Affected files:**
- `backend/app/main.py`

## Acceptance Criteria

- [ ] Exception types are differentiated (ImportError vs other)
- [ ] `exc_info=True` included for unexpected exceptions
- [ ] Log level appropriate (warning for expected, error for unexpected)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-27 | Created from PR #76 code review | Identified by multiple agents |

## Resources

- PR #76: feat: upgrade place extraction with Text Search API and spaCy NER
