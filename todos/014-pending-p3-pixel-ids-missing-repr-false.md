---
status: ready
priority: p3
issue_id: "014"
tags: [code-review, security, config]
dependencies: []
---

# Pixel IDs Missing `repr=False` in Config

## Problem Statement

`facebook_pixel_id` and `tiktok_pixel_code` are declared as plain `str = ""` without `repr=False`. While less sensitive than access tokens, they are still confidential identifiers that should not appear in debug logs.

## Findings

- **File:** `backend/app/core/config.py:176,187`
- Access tokens correctly have `repr=False`, but pixel IDs do not

## Proposed Solutions

```python
facebook_pixel_id: str = Field(default="", repr=False)
tiktok_pixel_code: str = Field(default="", repr=False)
```

## Acceptance Criteria

- [ ] Both pixel IDs use `repr=False`
