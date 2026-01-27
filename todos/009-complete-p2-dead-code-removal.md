---
status: complete
priority: p2
issue_id: "009"
tags: [code-review, simplicity, pr-76]
dependencies: []
---

# Dead code candidates after Text Search migration

## Problem Statement

The migration from Autocomplete + Details to Text Search may have left dead code:

1. **`search_places()`** (Autocomplete API) in `google_places_client.py` — ~130 LOC, potentially unused
2. **`get_place_details()`** in `google_places_client.py` — ~100 LOC, potentially unused (Text Search returns full details)
3. **`LOCATION_INDICATORS`** set in `candidate_extraction.py` — ~70 LOC, defined but never referenced
4. **`HIGH_CONFIDENCE_THRESHOLD` / `MEDIUM_CONFIDENCE_THRESHOLD`** in `scoring.py` — defined but unused

Estimated ~350 LOC reduction if confirmed dead.

## Findings

- **Source:** code-simplicity-reviewer
- **Locations:**
  - `backend/app/services/place_extractor/google_places_client.py` lines 33-165, 347-446
  - `backend/app/services/place_extractor/candidate_extraction.py` lines 140-211
  - `backend/app/services/place_extractor/scoring.py`

## Proposed Solutions

### Option A: Grep for usage, remove confirmed dead code
Search for all callers. Remove functions/constants with zero references outside tests and `__init__.py`.

- **Effort:** Medium
- **Risk:** Low (verify no external callers first)

## Acceptance Criteria

- [ ] Each function/constant verified as unused before removal
- [ ] `__init__.py` exports reduced to public API only
- [ ] All tests still pass after removal

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-27 | Created from PR #76 simplicity review | ~350 LOC potential reduction |
