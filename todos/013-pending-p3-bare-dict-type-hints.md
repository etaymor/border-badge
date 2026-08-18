---
status: ready
priority: p3
issue_id: "013"
tags: [code-review, python, typing]
dependencies: []
---

# Bare `dict` Type Hints Should Be `dict[str, Any]`

## Problem Statement

Multiple files use bare `dict` type annotations without type parameters. The codebase convention is `dict[str, Any]`.

## Findings

- `backend/app/schemas/ad_events.py:11` — `properties: dict = {}`
- `backend/app/services/ad_events/service.py:20` — `properties: dict`
- `backend/app/services/ad_events/facebook_capi.py:61` — `properties: dict`
- `backend/app/services/ad_events/tiktok_events.py:38` — `properties: dict`
- `backend/app/services/ad_events/tiktok_events.py:56,63` — local `dict` annotations

## Proposed Solutions

Replace all `dict` with `dict[str, Any]` and use `Field(default_factory=dict)` for the schema default.

## Acceptance Criteria

- [ ] All `dict` annotations include type parameters
- [ ] Schema uses `Field(default_factory=dict)`
