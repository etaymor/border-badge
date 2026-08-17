# RevenueCat Paywall Integration

**Date:** 2026-01-28
**Status:** Ready for planning

## What We're Building

A subscription system using RevenueCat that gates premium features while offering a generous free tier with usage limits. The paywall appears during onboarding after name entry, with hard gates when free users attempt premium features.

### Core Requirements

1. **RevenueCat Integration** - SDK for purchases, webhooks for backend sync
2. **Paywall in Onboarding** - After name entry, before account creation
3. **7-Day Free Trial** - Full premium access, reverts to free tier after
4. **Free Tier with Limits** - Generous but capped usage
5. **Share Extension Gating** - Subscription status via App Group shared storage
6. **Backend Usage Tracking** - Server enforces limits, reliable across devices

## Why This Approach

**RevenueCat SDK + Backend Validation** was chosen over client-only because:

- Usage limits need to be reliable (backend enforcement prevents reinstall bypass)
- Multi-device support requires server-side tracking
- Existing FastAPI backend and Supabase RLS make webhook integration straightforward
- Share extension already uses App Group storage—can extend for subscription status

## Key Decisions

### 1. Paywall Placement

**Decision:** After name entry, before account creation

**Flow:** ProgressSummary → NameEntry → **Paywall** → AccountCreation

**Rationale:** Collect name first for personalization, then present paywall when user is invested but before they commit to creating an account.

### 2. Free Tier Limits

| Feature | Free Limit | Premium |
|---------|------------|---------|
| Passport (mark countries) | Unlimited | Unlimited |
| Trips | Unlimited | Unlimited |
| Entries per trip | 10 | Unlimited |
| Share extension uses | 5 total | Unlimited |
| Photo import trips | 1 trip | Unlimited |

**Enforcement:** Backend tracks usage per user. Client checks before allowing action and shows paywall when limit reached.

### 3. Paywall Decline Behavior

**Decision:** Hard gate at premium features

- "Maybe later" → Continues to account creation with free tier
- Paywall reappears when user attempts gated feature after limit exceeded
- Soft paywall shown every time user opens app after using share extension (reminder)

### 4. Share Extension Gating

**Decision:** Check status via App Group shared storage

- Main app writes subscription status + usage counts to App Group on each launch and after purchases
- Share extension reads from shared storage before allowing save
- If over limit or not subscribed, extension shows message directing to main app

### 5. Subscription Management

**Decision:** Full in-app management

- Restore purchases button in settings
- Subscription status display (active/trial/expired)
- Link to App Store subscription management
- Trial days remaining indicator

### 6. Trial Structure

- **Duration:** 7 days
- **Access:** Full premium features
- **After expiry:** Reverts to free tier (keeps data, loses premium features)
- **Pricing:** Configured in RevenueCat dashboard (TBD, currently ~$39.99/yr, $4.99/mo)

## Technical Components

### Mobile (New)

| Component | Purpose |
|-----------|---------|
| `subscriptionStore.ts` | Zustand store for subscription state |
| `useSubscription.ts` | RevenueCat SDK initialization and state sync |
| `usePremiumGate.ts` | Hook to check feature access |
| `useUsageLimits.ts` | Hook to check/increment usage counts |
| Updated PaywallScreen | Connect to RevenueCat purchase flow |
| SubscriptionSettings | In-app subscription management UI |

### Backend (New)

| Component | Purpose |
|-----------|---------|
| `/webhooks/revenuecat` | Webhook endpoint for subscription events |
| `user_subscription` table | Store subscription status, expiry, plan |
| `user_usage` table | Track feature usage counts |
| Usage limit middleware | Check limits on relevant endpoints |

### Share Extension (Updates)

| Component | Purpose |
|-----------|---------|
| `SubscriptionManager.swift` | Read subscription status from App Group |
| Updated save flow | Check limits before allowing save |

## Open Questions

1. **Pricing finalization** - What are the final yearly/monthly prices?
2. **Grace period** - Should expired subscriptions have a grace period before losing access?
3. **Usage reset** - Do free tier limits reset monthly or are they lifetime?
4. **Upgrade prompts** - Beyond paywall, where else should we prompt upgrades?

## Next Steps

Run `/workflows:plan` to create implementation plan with:
1. RevenueCat account setup and product configuration
2. Mobile SDK integration
3. Backend webhook and database setup
4. Feature gating implementation
5. Share extension updates
6. Testing and App Store review considerations
