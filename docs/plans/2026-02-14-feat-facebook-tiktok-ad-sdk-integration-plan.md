---
title: Integrate Facebook & TikTok Ad SDKs for Conversion Tracking
type: feat
status: completed
date: 2026-02-14
---

# Integrate Facebook & TikTok Ad SDKs for Conversion Tracking

## Overview

Add Facebook (Meta) and TikTok advertising SDK integration to track 5 key conversion events for ad campaign optimization. Uses a hybrid architecture: Facebook client-side SDK for real-time attribution + SKAdNetwork, with server-side APIs (Facebook Conversions API + TikTok Events API) for reliable event delivery. A unified ad events service on the mobile side and a fan-out endpoint on the backend keep the integration clean and centralized.

## Problem Statement / Motivation

To run paid acquisition campaigns on Facebook and TikTok, both platforms need conversion event data to optimize ad delivery. Without SDK integration, the ad platforms can't attribute installs or optimize for downstream events (registration, subscription, engagement). This means:

- No way to measure ROAS (return on ad spend)
- Ad platforms can't optimize for high-value users
- SKAdNetwork attribution is unavailable (iOS installs go unattributed)
- No conversion data for lookalike audience building

## Proposed Solution

### Architecture

```
                         Mobile App (Expo 54)
                    ┌──────────────────────────┐
                    │                          │
                    │  adEvents.ts (unified)   │
                    │    ├─ Facebook SDK ──────────► Meta (real-time + SKAN)
                    │    └─ POST /ad-events ───────► FastAPI Backend
                    │                          │        ├─► Facebook CAPI
                    └──────────────────────────┘        └─► TikTok Events API
```

**Why hybrid (client + server)?**

| Aspect | Client SDK (Facebook only) | Server APIs (both) |
|--------|---------------------------|-------------------|
| SKAdNetwork | Required — only way | Cannot participate |
| Reliability | Can fail (ATT denied, crash) | Reliable |
| Match quality | High (IDFA if consented) | Lower (email hash) |
| TikTok support | No mature RN SDK exists | Stable HTTP API |

**Decision: Facebook gets both client + server. TikTok gets server-only.**

TikTok's React Native SDKs (`react-native-tiktok-business`, `expo-tiktok-business`) have fewer than 200 weekly downloads and no corporate maintenance guarantees. The server-side Events API is stable and avoids adding a fragile native dependency. If TikTok SKAN attribution becomes critical later, the client SDK can be added incrementally.

### 5 Conversion Events

| # | Event | Facebook Event | TikTok Event | Trigger Location | First-Only? |
|---|-------|---------------|--------------|-----------------|-------------|
| 1 | App Open | `fb_mobile_activate_app` (automatic) | `LaunchAPP` | SDK auto-logs on init | No |
| 2 | Account Created | `fb_mobile_complete_registration` | `CompleteRegistration` | `useAuth.ts`, `useAppleAuth.ts`, `useGoogleAuth.ts` | Yes (per user) |
| 3a | Trial Started | `StartTrial` | `Subscribe` (with `is_trial=true`) | `usePaywallPresentation.ts` | Yes |
| 3b | Subscription Purchased | `Subscribe` + `logPurchase()` | `CompletePayment` | `usePaywallPresentation.ts` | No |
| 4 | First Trip Created | Custom `FirstTripCreated` | `AddToCart` (custom) | `useTrips.ts` | Yes |
| 5 | Photo Import Done | Custom `FirstPhotoImport` | `ViewContent` (custom) | `useWorkflowAnalytics.ts` | Yes |

**"First-only" tracking:** Events 2, 3a, 4, and 5 should only fire once per user lifetime to avoid inflating conversion counts. Use a simple `hasTrackedX` flag in AsyncStorage, checked before firing.

## Technical Approach

### Phase 1: Native Setup & ATT (Foundation)

**Install packages:**

```bash
cd mobile
npx expo install react-native-fbsdk-next expo-tracking-transparency
```

**Update `app.config.js` plugins array** (after line 65):

```javascript
// Ad tracking
[
  'expo-tracking-transparency',
  {
    userTrackingPermission:
      'This identifier will be used to deliver personalized ads to you.',
  },
],
[
  'react-native-fbsdk-next',
  {
    appID: process.env.EXPO_PUBLIC_FB_APP_ID,
    clientToken: process.env.EXPO_PUBLIC_FB_CLIENT_TOKEN,
    displayName: 'Atlasi',
    scheme: `fb${process.env.EXPO_PUBLIC_FB_APP_ID}`,
    advertiserIDCollectionEnabled: false,
    autoLogAppEventsEnabled: true,
    isAutoInitEnabled: true,
    iosUserTrackingPermission: false,  // expo-tracking-transparency handles this
  },
],
```

**Add SKAdNetwork IDs** to `ios.infoPlist` (after line 35):

```javascript
SKAdNetworkItems: [
  // Meta / Facebook
  { SKAdNetworkIdentifier: 'v9wttpbfk9.skadnetwork' },
  { SKAdNetworkIdentifier: 'n38lu8286q.skadnetwork' },
  // TikTok / ByteDance
  { SKAdNetworkIdentifier: '238da6jt44.skadnetwork' },
  { SKAdNetworkIdentifier: '22mmun2rn5.skadnetwork' },
],
```

**Add Privacy Manifest** to `ios` config:

```javascript
privacyManifests: {
  NSPrivacyTracking: true,
  NSPrivacyTrackingDomains: [
    'graph.facebook.com',
    'analytics.tiktok.com',
  ],
  NSPrivacyCollectedDataTypes: [
    {
      NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeDeviceID',
      NSPrivacyCollectedDataTypeLinked: false,
      NSPrivacyCollectedDataTypeTracking: true,
      NSPrivacyCollectedDataTypePurposes: [
        'NSPrivacyCollectedDataTypePurposeThirdPartyAdvertising',
      ],
    },
  ],
  NSPrivacyAccessedAPITypes: [
    {
      NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
      NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
    },
  ],
},
```

**Add environment variables** to `mobile/src/config/env.ts`:

```typescript
// Facebook Ads
fbAppId: process.env.EXPO_PUBLIC_FB_APP_ID || '',
fbClientToken: process.env.EXPO_PUBLIC_FB_CLIENT_TOKEN || '',
```

**Files to create/modify:**

| File | Action |
|------|--------|
| `mobile/app.config.js` | Add plugins, SKAdNetwork, privacy manifest |
| `mobile/src/config/env.ts` | Add FB env vars |
| `mobile/.env.local` | Add `EXPO_PUBLIC_FB_APP_ID`, `EXPO_PUBLIC_FB_CLIENT_TOKEN` |

#### ATT Prompt Timing

Request ATT permission **after account creation, before the paywall**. This is the `EmotionalHook` screen in the post-signup flow — the user has just created an account and is about to see value propositions before the paywall. Alternatively, a dedicated interstitial screen between `AccountCreation` and `EmotionalHook`.

**Implementation approach:** Add ATT request to the `EmotionalHook` screen's `useEffect`. If the user has already responded (e.g., returning user), the prompt won't show again — iOS remembers the choice.

```typescript
// In EmotionalHookScreen.tsx or a new ATT interstitial
import { requestTrackingPermissionsAsync } from 'expo-tracking-transparency';
import { Settings } from 'react-native-fbsdk-next';

useEffect(() => {
  const requestTracking = async () => {
    const { status } = await requestTrackingPermissionsAsync();
    Settings.setAdvertiserTrackingEnabled(status === 'granted');
  };
  requestTracking();
}, []);
```

### Phase 2: Mobile Ad Events Service

**Create `mobile/src/services/adEvents.ts`:**

A thin service that fires events to Facebook SDK (client-side) and sends them to the backend for server-side fan-out. Follows the same singleton pattern as `analytics.ts`.

```typescript
// mobile/src/services/adEvents.ts

import { AppEventsLogger } from 'react-native-fbsdk-next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { isProduction } from '@config/env';

const FIRST_EVENT_PREFIX = '@adEvents:tracked:';

async function hasTrackedOnce(key: string): Promise<boolean> {
  const val = await AsyncStorage.getItem(`${FIRST_EVENT_PREFIX}${key}`);
  return val === 'true';
}

async function markTrackedOnce(key: string): Promise<void> {
  await AsyncStorage.setItem(`${FIRST_EVENT_PREFIX}${key}`, 'true');
}

function generateEventId(event: string): string {
  return `${event}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function sendToServer(
  eventName: string,
  eventId: string,
  properties?: Record<string, unknown>
): Promise<void> {
  try {
    await api.post('/ad-events', {
      event_name: eventName,
      event_id: eventId,
      properties: properties ?? {},
      timestamp: Math.floor(Date.now() / 1000),
    });
  } catch (error) {
    // Non-critical — log but don't block
    console.warn('[AdEvents] Server-side event failed:', error);
  }
}

export const AdEvents = {
  /** Event 2: Account created (first time only) */
  async accountCreated(method: 'email' | 'apple' | 'google'): Promise<void> {
    if (await hasTrackedOnce('account_created')) return;
    if (!isProduction) {
      console.log('[AdEvents] accountCreated', { method });
      return;
    }

    const eventId = generateEventId('complete_registration');

    // Client: Facebook SDK
    AppEventsLogger.logEvent('fb_mobile_complete_registration', {
      fb_registration_method: method,
    });

    // Server: FB CAPI + TikTok
    await sendToServer('CompleteRegistration', eventId, { method });
    await markTrackedOnce('account_created');
  },

  /** Event 3a: Trial started */
  async trialStarted(plan: string): Promise<void> {
    if (await hasTrackedOnce('trial_started')) return;
    if (!isProduction) {
      console.log('[AdEvents] trialStarted', { plan });
      return;
    }

    const eventId = generateEventId('start_trial');

    AppEventsLogger.logEvent('StartTrial', {
      fb_content_id: plan,
      fb_currency: 'USD',
    });

    await sendToServer('StartTrial', eventId, { plan, is_trial: true });
    await markTrackedOnce('trial_started');
  },

  /** Event 3b: Subscription purchased */
  async subscriptionPurchased(plan: string, price: number, currency: string): Promise<void> {
    if (!isProduction) {
      console.log('[AdEvents] subscriptionPurchased', { plan, price, currency });
      return;
    }

    const eventId = generateEventId('subscribe');

    AppEventsLogger.logPurchase(price, currency, {
      fb_content_type: 'subscription',
      fb_content_id: plan,
    });
    AppEventsLogger.logEvent('Subscribe', price, {
      fb_currency: currency,
      fb_content_id: plan,
    });

    await sendToServer('Subscribe', eventId, { plan, price, currency });
  },

  /** Event 4: First trip created */
  async firstTripCreated(countryCode: string): Promise<void> {
    if (await hasTrackedOnce('first_trip')) return;
    if (!isProduction) {
      console.log('[AdEvents] firstTripCreated', { countryCode });
      return;
    }

    const eventId = generateEventId('first_trip_created');

    AppEventsLogger.logEvent('FirstTripCreated', { country_code: countryCode });

    await sendToServer('FirstTripCreated', eventId, { country_code: countryCode });
    await markTrackedOnce('first_trip');
  },

  /** Event 5: First photo import completed */
  async firstPhotoImportDone(clusterCount: number): Promise<void> {
    if (await hasTrackedOnce('first_photo_import')) return;
    if (!isProduction) {
      console.log('[AdEvents] firstPhotoImportDone', { clusterCount });
      return;
    }

    const eventId = generateEventId('first_photo_import');

    AppEventsLogger.logEvent('FirstPhotoImport', { cluster_count: clusterCount });

    await sendToServer('FirstPhotoImport', eventId, { cluster_count: clusterCount });
    await markTrackedOnce('first_photo_import');
  },

  /** Set Facebook user ID for better matching */
  setUserId(userId: string): void {
    if (!isProduction) return;
    AppEventsLogger.setUserID(userId);
  },

  /** Clear on sign-out */
  clearUserId(): void {
    if (!isProduction) return;
    AppEventsLogger.clearUserID();
    AppEventsLogger.clearUserData();
  },
};
```

**Hook into existing event sites:**

| Location | Change |
|----------|--------|
| `useAuth.ts:118` (onSuccess) | Add `AdEvents.accountCreated('email')` |
| `useAppleAuth.ts:146` (onSuccess) | Add `AdEvents.accountCreated('apple')` |
| `useGoogleAuth.ts:173` (onSuccess) | Add `AdEvents.accountCreated('google')` |
| `usePaywallPresentation.ts:85` (purchase success) | Add `AdEvents.trialStarted(plan)` or `AdEvents.subscriptionPurchased(plan, price, currency)` based on whether it's a trial or purchase |
| `useTrips.ts:115` (createTrip onSuccess) | Add `AdEvents.firstTripCreated(countryCode)` |
| `useWorkflowAnalytics.ts:132` (workflow completed) | Add `AdEvents.firstPhotoImportDone(totalClusters)` |
| `useAuthSession.ts` (identify) | Add `AdEvents.setUserId(userId)` alongside existing `identifyUser(userId)` |
| Sign-out flow | Add `AdEvents.clearUserId()` alongside existing `resetUser()` |

**Files to create/modify:**

| File | Action |
|------|--------|
| `mobile/src/services/adEvents.ts` | **Create** — unified ad events service |
| `mobile/src/hooks/useAuth.ts` | Add `AdEvents.accountCreated()` call |
| `mobile/src/hooks/useAppleAuth.ts` | Add `AdEvents.accountCreated()` call |
| `mobile/src/hooks/useGoogleAuth.ts` | Add `AdEvents.accountCreated()` call |
| `mobile/src/hooks/usePaywallPresentation.ts` | Add trial/purchase ad events |
| `mobile/src/hooks/useTrips.ts` | Add `AdEvents.firstTripCreated()` call |
| `mobile/src/screens/photos/useWorkflowAnalytics.ts` | Add `AdEvents.firstPhotoImportDone()` call |
| `mobile/src/hooks/useAuthSession.ts` | Add `AdEvents.setUserId()` |
| `mobile/src/screens/onboarding/EmotionalHookScreen.tsx` | Add ATT request |

### Phase 3: Backend Server-Side Events

**Add dependencies:**

```bash
cd backend
poetry add facebook-business httpx  # httpx already present
```

Note: `httpx` is already in the project (used by `SupabaseClient`). Only `facebook-business` is new.

**Create `backend/app/services/ad_events/` module:**

```
backend/app/services/ad_events/
├── __init__.py
├── facebook_capi.py    # Facebook Conversions API client
├── tiktok_events.py    # TikTok Events API client
└── service.py          # Fan-out orchestrator
```

**`facebook_capi.py`** — sends events to Meta's Conversions API:

- Endpoint: `POST https://graph.facebook.com/v21.0/{PIXEL_ID}/events`
- Hashes email with SHA-256 before sending
- Sets `action_source: "app"` and includes `app_data`
- Passes `event_id` for deduplication with client-side SDK

**`tiktok_events.py`** — sends events to TikTok's Events API:

- Endpoint: `POST https://business-api.tiktok.com/open_api/v1.3/event/track/`
- Bearer token auth via `Access-Token` header
- Hashes email/user_id with SHA-256

**`service.py`** — orchestrator that fans out to both platforms concurrently:

```python
async def track_ad_event(
    event_name: str,
    event_id: str,
    user_email: str | None,
    user_id: str,
    properties: dict,
) -> None:
    """Fan out ad event to Facebook CAPI and TikTok Events API."""
    await asyncio.gather(
        facebook_capi.send_event(event_name, event_id, user_email, user_id, properties),
        tiktok_events.send_event(event_name, user_email, user_id, properties),
        return_exceptions=True,  # Don't let one failure block the other
    )
```

**Create API route `backend/app/api/ad_events.py`:**

```python
router = APIRouter(prefix="/ad-events", tags=["ad-events"])

@router.post("")
async def track_ad_event(body: AdEventRequest, user: CurrentUser = Depends()):
    """Receive ad event from mobile, fan out to FB CAPI + TikTok."""
    # Look up user email from profile for matching
    profile = await get_user_profile(user.id)

    await ad_events_service.track_ad_event(
        event_name=body.event_name,
        event_id=body.event_id,
        user_email=profile.email if profile else None,
        user_id=str(user.id),
        properties=body.properties,
    )
    return {"status": "ok"}
```

**Register router** in `backend/app/api/__init__.py`.

**Add environment variables** to `backend/app/core/config.py`:

```python
# Facebook Conversions API
FACEBOOK_PIXEL_ID: str = ""
FACEBOOK_CAPI_ACCESS_TOKEN: str = ""

# TikTok Events API
TIKTOK_ACCESS_TOKEN: str = ""
TIKTOK_PIXEL_CODE: str = ""
```

**Event name mapping (server-side):**

| Internal Event | Facebook CAPI Event | TikTok Event |
|---------------|--------------------|--------------|
| `CompleteRegistration` | `CompleteRegistration` | `CompleteRegistration` |
| `StartTrial` | `StartTrial` | `Subscribe` |
| `Subscribe` | `Purchase` | `CompletePayment` |
| `FirstTripCreated` | `Lead` | `AddToCart` |
| `FirstPhotoImport` | `ViewContent` | `ViewContent` |

**Files to create/modify:**

| File | Action |
|------|--------|
| `backend/app/services/ad_events/__init__.py` | **Create** |
| `backend/app/services/ad_events/facebook_capi.py` | **Create** — FB Conversions API client |
| `backend/app/services/ad_events/tiktok_events.py` | **Create** — TikTok Events API client |
| `backend/app/services/ad_events/service.py` | **Create** — fan-out orchestrator |
| `backend/app/api/ad_events.py` | **Create** — API route |
| `backend/app/api/__init__.py` | Register ad_events router |
| `backend/app/schemas/ad_events.py` | **Create** — Pydantic request model |
| `backend/app/core/config.py` | Add FB/TikTok env vars |
| `backend/.env` | Add credential values |

### Phase 4: Build & Testing

**This requires a new EAS build** because native plugins are being added. Not just an EAS Update.

1. Bump `version` in `app.config.js` (e.g., `1.0.7` -> `1.0.8`) since `runtimeVersion` is tied to `appVersion`
2. Run `npx expo prebuild --clean` to verify config plugin output
3. Build: `eas build --profile development --platform ios`
4. Test ATT prompt appears correctly
5. Test events appear in Facebook Events Manager (Test Events tool)
6. Test events appear in TikTok Events Manager
7. Production build: `eas build --profile production --platform ios`

**Verification checklist:**

- [ ] ATT prompt shows after account creation
- [ ] `fb_mobile_activate_app` fires on app open (automatic via SDK)
- [ ] `CompleteRegistration` fires once per account creation
- [ ] `StartTrial` fires on trial start, `Purchase` fires on subscription
- [ ] `FirstTripCreated` fires only on first trip, not subsequent trips
- [ ] `FirstPhotoImport` fires only on first photo import completion
- [ ] Server-side events appear in Facebook Events Manager with matching `event_id`
- [ ] Server-side events appear in TikTok Events Manager
- [ ] Events do NOT fire in development mode
- [ ] Sign-out clears Facebook user ID

## Acceptance Criteria

### Functional Requirements

- [ ] App Tracking Transparency prompt appears during post-signup flow
- [ ] Facebook SDK initializes on app start and logs `fb_mobile_activate_app` automatically
- [ ] 5 conversion events fire to Facebook (client + server) and TikTok (server only)
- [ ] "First-only" events (registration, trial, first trip, first photo import) fire exactly once per user
- [ ] Facebook events are deduplicated via shared `event_id` between client SDK and CAPI
- [ ] Server-side events include SHA-256 hashed user email for matching
- [ ] All ad events are gated behind `isProduction` — no firing in development

### Non-Functional Requirements

- [ ] Ad event failures are caught and logged, never block the user flow
- [ ] Server-side fan-out runs both platforms concurrently
- [ ] No new native dependencies for TikTok (server-only approach)
- [ ] iOS Privacy Manifest declares tracking domains and data types
- [ ] SKAdNetwork IDs for both Meta and TikTok are in Info.plist

## Dependencies & Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| `react-native-fbsdk-next` compatibility with Expo 54 / New Arch | Build failure | Package has Expo config plugin, actively maintained, 20k+ weekly downloads. Test in dev build first. |
| Facebook App Review required for advanced features | Events may not optimize fully | Standard app events work without review. Only custom audiences require review. |
| TikTok Events API rate limits | Events dropped | Batch up to 50 events/request. For 5 events at current scale, this is not a concern. |
| ATT denial rate (~75% of users deny) | Reduced match quality | Server-side CAPI with email hash provides a backup signal. SKAN still works regardless of ATT. |
| SKAdNetwork conversion value conflicts between SDKs | Incorrect attribution | Only Facebook SDK manages SKAN values. TikTok is server-only. |
| AsyncStorage `hasTrackedOnce` flags lost on reinstall | Duplicate "first" events | Acceptable — reinstall is a new user journey from the ad platform's perspective. |

## Environment Variables Summary

### Mobile (`mobile/.env.local`)

```
EXPO_PUBLIC_FB_APP_ID=<facebook-app-id>
EXPO_PUBLIC_FB_CLIENT_TOKEN=<facebook-client-token>
```

### Backend (`backend/.env`)

```
FACEBOOK_PIXEL_ID=<pixel-or-dataset-id>
FACEBOOK_CAPI_ACCESS_TOKEN=<system-user-access-token>
TIKTOK_ACCESS_TOKEN=<tiktok-api-access-token>
TIKTOK_PIXEL_CODE=<tiktok-pixel-code>
```

## Pre-Implementation Setup

Before writing code, you need credentials from both platforms:

1. **Facebook**: Create app at [developers.facebook.com](https://developers.facebook.com), get App ID + Client Token. Set up a Pixel/Dataset for CAPI. Generate a System User Access Token with `ads_management` scope.
2. **TikTok**: Create business account at [ads.tiktok.com](https://ads.tiktok.com), apply for Marketing API access (~2 day approval), create a Pixel, generate Access Token.
3. **SKAdNetwork IDs**: Verify the latest IDs from [Meta](https://developers.facebook.com/docs/SKAdNetwork) and [TikTok](https://ads.tiktok.com/help/article/about-skan-4-0-and-tiktok) documentation before shipping.

## References

### Internal

- Existing analytics service: [analytics.ts](mobile/src/services/analytics.ts)
- PostHog initialization: [analytics.ts:18-49](mobile/src/services/analytics.ts#L18-L49)
- RevenueCat pattern: [revenueCat.ts](mobile/src/services/revenueCat.ts)
- App config plugins: [app.config.js:49-66](mobile/app.config.js#L49-L66)
- Auth hooks: [useAuth.ts](mobile/src/hooks/useAuth.ts)
- Paywall events: [usePaywallPresentation.ts](mobile/src/hooks/usePaywallPresentation.ts)
- Trip creation: [useTrips.ts](mobile/src/hooks/useTrips.ts)
- Photo import workflow: [useWorkflowAnalytics.ts](mobile/src/screens/photos/useWorkflowAnalytics.ts)
- Environment config: [env.ts](mobile/src/config/env.ts)
- Share Extension config plugin (reference pattern): [withShareExtension.js](mobile/plugins/withShareExtension.js)

### External

- [react-native-fbsdk-next](https://github.com/thebergamo/react-native-fbsdk-next) — Facebook SDK with Expo config plugin
- [expo-tracking-transparency](https://docs.expo.dev/versions/latest/sdk/tracking-transparency/) — ATT prompt
- [Facebook Conversions API](https://developers.facebook.com/docs/marketing-api/conversions-api/) — Server-side events
- [TikTok Events API](https://ads.tiktok.com/help/article/events-api) — Server-side events
- [facebook-business Python SDK](https://github.com/facebook/facebook-python-business-sdk) — CAPI Python client
- [Apple SKAdNetwork](https://developer.apple.com/documentation/storekit/skadnetwork) — iOS attribution framework
- [Expo Privacy Manifests](https://docs.expo.dev/guides/apple-privacy/) — iOS 17+ requirements
