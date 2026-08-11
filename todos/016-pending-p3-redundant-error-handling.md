---
status: ready
priority: p3
issue_id: "016"
tags: [code-review, architecture, python]
dependencies: []
---

# Redundant Error Handling (try/except in Clients + return_exceptions in Gather)

## Problem Statement

Both platform clients (`facebook_capi.py`, `tiktok_events.py`) catch all exceptions internally with `try/except Exception`. The `service.py` orchestrator also uses `asyncio.gather(..., return_exceptions=True)` with a result-checking loop. Since the clients never raise, `return_exceptions=True` is meaningless and the loop in `service.py` (lines 37-40) is dead code.

## Findings

- **Flagged by:** Architecture Strategist
- **Files:** `service.py:31-40`, `facebook_capi.py:114`, `tiktok_events.py:100`

## Proposed Solutions

### Option A: Remove try/except from clients, let service.py handle errors (Recommended)
Centralizes error handling policy in the orchestrator.

### Option B: Remove return_exceptions and the result loop from service.py
Simpler, but distributes error handling to clients.

## Acceptance Criteria

- [ ] Error handling is in one place, not duplicated across layers
