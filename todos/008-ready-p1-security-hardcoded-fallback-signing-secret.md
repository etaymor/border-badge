# Hardcoded Fallback Signing Secret in Production

---
status: ready
priority: p1
issue_id: "008"
tags: [code-review, security, critical]
dependencies: []
---

## Problem Statement

The `INVITE_SIGNING_SECRET` property falls back to a hardcoded value `"dev-secret-change-in-production"` if environment variables are not set. This allows attackers to forge valid invite codes.

## Findings

### Agent: security-sentinel

**Location:** `backend/app/core/config.py` (lines 58-65)

```python
@property
def INVITE_SIGNING_SECRET(self) -> str:
    """Get invite signing secret, fallback to affiliate secret or default."""
    return (
        self.invite_signing_secret
        or self.affiliate_signing_secret
        or "dev-secret-change-in-production"
    )
```

**Impact:**
- Attackers can forge valid invite codes
- Can create fake invite links that auto-follow users
- Potential access to private trip data via trip_tag invites

## Proposed Solutions

### Solution A: Fail Fast in Production (Recommended)
**Effort:** Small (30 minutes)
**Risk:** None
**Pros:** Prevents insecure deployment
**Cons:** Requires env var to be set

```python
@property
def INVITE_SIGNING_SECRET(self) -> str:
    secret = self.invite_signing_secret or self.affiliate_signing_secret
    if not secret and self.env == "production":
        raise ValueError("INVITE_SIGNING_SECRET must be set in production")
    return secret or "dev-secret-change-in-production"
```

## Recommended Action
**Solution A** - Fail fast if secret is missing in production.

## Technical Details

**Affected Files:**
- `backend/app/core/config.py`

## Acceptance Criteria

- [ ] Production deployment fails without proper secret
- [ ] Development still works with fallback
- [ ] Secret is properly configured in production

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2025-12-26 | Identified during security review | Never use hardcoded fallback secrets in production |

## Resources

- PR #34: https://github.com/etaymor/border-badge/pull/34
