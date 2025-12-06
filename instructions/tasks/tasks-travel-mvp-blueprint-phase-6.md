## Relevant Files

- `mobile/src/navigation/index.tsx` - Navigation entry point where paywall entry routes and premium-gated redirects are wired into the main flows (`docs/travel-mvp-blueprint.md` L495–505).
- `mobile/src/navigation/types.ts` - Route and param list types including any new `Paywall` or subscription-related screens.
- `mobile/src/screens/Paywall/PaywallScreen.tsx` - Main paywall screen, showing premium benefits, trial CTA, and “continue free” fallback (PRD paywall notes `docs/travel-prd.md` L217–231, L349–359; `docs/travel-mvp-blueprint.md` L495–505).
- `mobile/src/components/paywall/PaywallHero.tsx` - Optional subcomponent for headline, hero image, and primary CTA.
- `mobile/src/components/paywall/FeatureTeaser.tsx` - Component for listing premium features (social overlays, deeper journaling, AI tips, etc.).
- `mobile/src/state/subscriptionStore.ts` - Client-side store for subscription status (`none`, `in_trial`, `active`, `expired`) and product metadata.
- `mobile/src/api/hooks/useSubscription.ts` - Hook for querying/refreshing subscription status from RevenueCat and/or backend.
- `mobile/src/config/env.ts` - Environment configuration containing RevenueCat keys/app IDs and analytics keys (PRD technical considerations `docs/travel-prd.md` L337–347, L341–347).
- `mobile/src/lib/analytics.ts` - Mobile analytics helper for sending events to Google Analytics and PostHog following `docs/travel-technical-design.md` L587–595 and PRD analytics requirements L341–359.
- `backend/app/api/subscriptions.py` - Optional backend endpoint(s) for verifying subscription status for server-side gated operations.
- `backend/app/core/analytics.py` (or `backend/app/analytics.py`) - Centralized backend analytics helper for emitting events to analytics providers.
- `backend/app/core/config.py` - Configuration for analytics and RevenueCat-related environment variables and toggles.
- `backend/tests/test_subscriptions.py` - Tests for subscription verification endpoints and error cases.
- `backend/tests/test_analytics_events.py` - Tests that backend emits correctly shaped analytics events for key flows.
- `mobile/src/__tests__/screens/PaywallScreen.test.tsx` - Tests for paywall rendering, CTAs, and free vs premium branching.
- `mobile/src/__tests__/flows/PaywallAndSubscriptionFlow.test.tsx` - Integration-style tests for triggering paywall, subscribing, and unlocking premium features.

### Notes

- Phase 6 adds **paywall, subscriptions, and analytics** as described in `docs/travel-mvp-blueprint.md` §10 (L491–555) and implements PRD analytics and monetization requirements (`docs/travel-prd.md` L299–359, L337–347, L541–545).
- RevenueCat is the primary subscription provider per PRD §8.1 (`docs/travel-prd.md` L337–347); analytics rely on Google Analytics and PostHog (`docs/travel-prd.md` L341–347; `docs/travel-technical-design.md` L587–595).
- Paywall surfaces should be **tightly scoped** but placed at high-intent moments (e.g., passport reveal, premium feature usage) as outlined in `docs/travel-mvp-blueprint.md` L497–505.
- Analytics events must be **explicit, user-triggered, and privacy-conscious**, avoiding passive tracking while still covering the key funnel events listed in PRD L349–359 and the technical design’s analytics section L587–595.

## Tasks

- [ ] 1.0 Implement paywall surfaces and entry points across the mobile app
  - [ ] 1.1 Define when and where users should see the paywall based on PRD guidance (`docs/travel-prd.md` L217–231, L349–359) and the blueprint (e.g., after passport reveal, on attempting premium-only actions), and document these triggers.
  - [ ] 1.2 Add a `Paywall` route to `mobile/src/navigation/types.ts` and configure it in `mobile/src/navigation/index.tsx`, ensuring it can be reached both modally and via deep-link-style navigation from key flows.
  - [ ] 1.3 Implement `PaywallScreen` with content matching `docs/travel-mvp-blueprint.md` §10.1 (L495–505): headline, bullet list of benefits, primary “Start Free Trial” CTA, and secondary “Continue with Free Plan” option.
  - [ ] 1.4 Add paywall triggers in relevant screens:
    - After passport summary when user crosses an activation threshold.
    - When attempting to access clearly premium features (e.g., deeper journaling, AI tips) as defined in the PRD.
  - [ ] 1.5 Ensure that free users can always continue using core free features after dismissing the paywall and that the UI clearly distinguishes free vs premium value without dark patterns.
  - [ ] 1.6 Integrate basic analytics calls in `PaywallScreen` (via `analytics.track`) to log paywall viewed, primary CTA tapped, and secondary CTA tapped events (details fleshed out in Task 4.0).

- [ ] 2.0 Integrate RevenueCat SDK on mobile and manage subscription state
  - [ ] 2.1 Add RevenueCat dependencies to `mobile/package.json` according to the provider’s React Native/Expo integration guidance, and configure any native modules or plugins required for iOS.
  - [ ] 2.2 Extend `mobile/src/config/env.ts` to include RevenueCat app identifiers and product IDs for at least one subscription product (e.g., monthly plan), sourced from environment variables.
  - [ ] 2.3 Implement `mobile/src/state/subscriptionStore.ts` to hold subscription status (e.g., `none`, `in_trial`, `active`, `expired`), current product details, and last refreshed timestamp.
  - [ ] 2.4 Implement `mobile/src/api/hooks/useSubscription.ts` to:
    - Initialize the RevenueCat SDK with keys from `env`.
    - Query current entitlement/active subscription state on app startup or when returning to foreground.
    - Update `subscriptionStore` accordingly and expose a hook API like `useSubscriptionStatus()` for the rest of the app.
  - [ ] 2.5 Wire `PaywallScreen` buttons to RevenueCat purchase flows:
    - “Start Free Trial” → initiate purchase for the configured product.
    - Handle success (update subscription store, dismiss paywall) and error/cancellation cases gracefully.
  - [ ] 2.6 Optionally, implement a minimal backend verification endpoint (`backend/app/api/subscriptions.py`) to validate RevenueCat webhooks or subscription status for server-side gated behavior.

- [ ] 3.0 Gate premium features using subscription status and feature flags
  - [ ] 3.1 Identify which features are premium vs free from the PRD and blueprint (e.g., social overlays, deeper trip journaling, AI tips, advanced analytics surfaces) and create a small matrix mapping feature → gating rule.
  - [ ] 3.2 Extend `mobile/src/config/env.ts` with feature flags (e.g., `FEATURE_PAYWALL_ENABLED`, `FEATURE_AI_TIPS_ENABLED`) so environments can enable or disable premium gating without code changes.
  - [ ] 3.3 Implement a `usePremiumGate` helper or simple utility that, given a feature identifier, returns whether it is allowed for the current subscription status and environment settings.
  - [ ] 3.4 Update relevant screens and components (e.g., areas identified in previous phases as “premium”) to:
    - Check `useSubscriptionStatus` and `usePremiumGate`.
    - Redirect to `PaywallScreen` when a non-entitled user attempts to access premium functionality.
    - Allow immediate access for users with `active` or `in_trial` status.
  - [ ] 3.5 If backend validation is implemented, ensure server-side endpoints for premium-only actions verify subscription status (e.g., via `backend/app/api/subscriptions.py`) and return 403 for unauthorized access.
  - [ ] 3.6 Add clear UI copy for gated actions explaining that they are part of the premium experience and offer a way to learn more (link to paywall) without breaking core flows.

- [ ] 4.0 Define and implement analytics event schema for key product actions
  - [ ] 4.1 Based on PRD analytics requirements (`docs/travel-prd.md` L341–359, L541–545) and the technical design (`docs/travel-technical-design.md` L587–595), draft a concise event schema document detailing:
    - Event names (e.g., `onboarding_started`, `country_added`, `trip_created`, `friend_request_sent`, `trip_tag_approved`, `paywall_viewed`, `subscription_started`).
    - Required and optional properties for each event (e.g., `source`, `country_count`, `trial_length`, `plan_type`).
  - [ ] 4.2 Implement `mobile/src/lib/analytics.ts` as a thin wrapper around configured analytics providers (Google Analytics, PostHog), taking event name + payload and dispatching to the underlying SDKs.
  - [ ] 4.3 Implement `backend/app/core/analytics.py` (or similar) to provide a consistent interface for backend-triggered events (e.g., account creation, GDPR delete, subscription changes), ensuring event naming aligns with the mobile side.
  - [ ] 4.4 Update key mobile flows from earlier phases to emit events:
    - Onboarding started/completed (Phase 3).
    - Country added / wishlist added (Phases 3–4).
    - Trip created, entry added (Phases 4–5).
    - Friend request sent/accepted, trip tag approved (Phase 5).
    - Paywall viewed and subscription started (Phase 6).
  - [ ] 4.5 Update backend flows where events are critical and easier to emit server-side (e.g., GDPR delete, account created, subscription validated), using `backend/app/core/analytics.py`.
  - [ ] 4.6 Ensure that all analytics calls are **explicit and user-action based**, and avoid adding any hidden or passive tracking beyond what is described in PRD and technical design.

- [ ] 5.0 Wire Google Analytics and PostHog instrumentation to emit events
  - [ ] 5.1 Configure Google Analytics and PostHog project keys and endpoints in `mobile/src/config/env.ts` and `backend/app/core/config.py`, ensuring they are environment-specific and not hard-coded.
  - [ ] 5.2 Integrate the official or recommended SDKs for Google Analytics and PostHog on mobile, and ensure they are initialized early in the app lifecycle (e.g., in `App.tsx` or an analytics provider wrapper).
  - [ ] 5.3 Integrate corresponding clients on the backend (e.g., HTTP APIs or client libraries) in `backend/app/core/analytics.py`, with error handling that logs but does not fail the main request on analytics errors.
  - [ ] 5.4 Update `mobile/src/lib/analytics.ts` to send events to both Google Analytics and PostHog, handling provider differences (e.g., event naming, property shape) internally so calling code remains simple.
  - [ ] 5.5 Implement sampling or environment flags (e.g., disabling analytics in local dev) to avoid noisy or test data polluting production dashboards.
  - [ ] 5.6 Validate in a staging environment that key events appear correctly in Google Analytics and PostHog dashboards, and adjust payloads or naming as needed for clarity.

- [ ] 6.0 Add tests to validate paywall behavior, subscription flows, and analytics event emission
  - [ ] 6.1 Implement `backend/tests/test_analytics_events.py` to assert that representative backend actions (e.g., trip creation, friend acceptance, subscription verification) call the analytics helper with the expected event names and properties.
  - [ ] 6.2 Implement `backend/tests/test_subscriptions.py` (if backend subscription verification endpoints are used) to cover happy paths, invalid tokens, and expired/invalid subscription scenarios.
  - [ ] 6.3 Implement `mobile/src/__tests__/screens/PaywallScreen.test.tsx` to verify that:
    - The correct copy and CTAs render for free vs premium users.
    - Tapping CTAs triggers navigation and (mocked) RevenueCat purchase functions as expected.
  - [ ] 6.4 Implement `mobile/src/__tests__/flows/PaywallAndSubscriptionFlow.test.tsx` to simulate:
    - A free user hitting a premium gate and being redirected to the paywall.
    - A successful subscription (mocking RevenueCat responses) and return to the gated feature with access granted.
  - [ ] 6.5 Add unit tests for `mobile/src/lib/analytics.ts` to verify that provider-specific calls are correctly formed and that events are dropped or gracefully handled when analytics is disabled.
  - [ ] 6.6 Run both backend and mobile test suites to confirm Phase 6 changes do not regress existing functionality and that paywall + analytics behaviors are covered by automated tests.
