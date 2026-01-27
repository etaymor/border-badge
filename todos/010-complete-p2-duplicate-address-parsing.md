---
status: complete
priority: p2
issue_id: "010"
tags: [code-review, simplicity, pr-76]
dependencies: []
---

# Duplicate address component parsing logic

## Problem Statement

`_normalize_text_search_result()` (lines 188-214) and `get_place_details()` (lines 387-418) in `google_places_client.py` contain identical logic for extracting city/country/country_code from `addressComponents`. Copy-paste duplication.

## Findings

- **Source:** code-simplicity-reviewer
- **Location:** `backend/app/services/place_extractor/google_places_client.py`

## Proposed Solutions

### Option A: Extract shared `_parse_address_components()` helper

- **Effort:** Small
- **Risk:** Low

Note: If `get_place_details()` is removed as dead code (see #009), this becomes moot.

## Acceptance Criteria

- [ ] Address parsing logic exists in one place only
- [ ] Both callers produce identical results

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-27 | Created from PR #76 simplicity review | Depends on outcome of #009 |
