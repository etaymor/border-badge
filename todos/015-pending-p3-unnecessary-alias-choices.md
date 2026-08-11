---
status: ready
priority: p3
issue_id: "015"
tags: [code-review, python, config]
dependencies: []
---

# Unnecessary `AliasChoices` on Brand New Field

## Problem Statement

`tiktok_events_access_token` uses `AliasChoices("TIKTOK_ACCESS_TOKEN", "TIKTOK_EVENTS_ACCESS_TOKEN")` but this is a brand new field with no backwards compatibility to maintain. The alias adds confusion about which env var is canonical.

## Findings

- **File:** `backend/app/core/config.py:180-186`
- **Flagged by:** Python Reviewer

## Proposed Solutions

Remove `AliasChoices`. Just use the field name `tiktok_events_access_token` (pydantic-settings resolves to `TIKTOK_EVENTS_ACCESS_TOKEN`). Update `.env.example` to match.

## Acceptance Criteria

- [ ] `AliasChoices` removed from `tiktok_events_access_token`
- [ ] `.env.example` uses consistent env var name
