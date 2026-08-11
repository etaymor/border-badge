---
status: ready
priority: p2
issue_id: "010"
tags: [code-review, architecture, ad-tracking]
dependencies: []
---

# Placeholder $0/USD Price Distorts Ad Platform Revenue Metrics

## Problem Statement

`usePaywallPresentation.ts` sends `AdEvents.subscriptionPurchased(plan, 0, 'USD')` with a placeholder price of $0. This flows to Facebook CAPI as `CustomData(value=0.0)` and to TikTok as `"value": "0"`. This distorts ROAS (Return on Ad Spend) calculations and confuses bidding algorithms that optimize for revenue.

The comment says "Facebook CAPI receives the real revenue from RevenueCat webhooks" — but there is no RevenueCat-to-CAPI integration in this PR.

## Findings

- **File:** `mobile/src/hooks/usePaywallPresentation.ts:100`
- **Flagged by:** Architecture Strategist, TypeScript Reviewer, Security Sentinel

## Proposed Solutions

### Option A: Omit price fields when value is 0 (Recommended)
**Pros:** No misleading data, event still tracks the conversion signal
**Effort:** Small

### Option B: Defer Subscribe event to RevenueCat webhook handler
**Pros:** Real price available from webhook payload
**Cons:** Requires modifying webhook handler in `backend/app/api/webhooks.py`
**Effort:** Medium

### Option C: Extract price from RevenueCat CustomerInfo on mobile
**Pros:** Real price at the source
**Cons:** CustomerInfo doesn't expose price reliably
**Effort:** High (may not be possible)

## Technical Details

**Affected files:**
- `mobile/src/hooks/usePaywallPresentation.ts`
- `mobile/src/services/adEvents.ts` (conditionally skip price fields)
- `backend/app/services/ad_events/facebook_capi.py` (skip CustomData when price=0)
- `backend/app/services/ad_events/tiktok_events.py` (skip value when price=0)

## Acceptance Criteria

- [ ] No $0 purchase events sent to Facebook or TikTok
- [ ] Subscribe conversion signal is still tracked (just without revenue value)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-14 | Identified during code review | Zero-value purchases confuse ad platform bidding algorithms |
