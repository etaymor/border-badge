# Subscription System Documentation

This document covers how to set up, test, and troubleshoot the Border Badge subscription system powered by RevenueCat.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Apple Developer Account Setup](#apple-developer-account-setup)
3. [App Store Connect Configuration](#app-store-connect-configuration)
4. [RevenueCat Dashboard Setup](#revenuecat-dashboard-setup)
5. [Local Development Setup](#local-development-setup)
6. [Testing Subscription Flows](#testing-subscription-flows)
7. [Webhook Configuration & Testing](#webhook-configuration--testing)
8. [Troubleshooting Guide](#troubleshooting-guide)

---

## Architecture Overview

The subscription system has three main components:

```
┌─────────────────────────────────────────────────────────────────┐
│                         MOBILE APP                               │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ subscriptionStore│  │ useSubscription │  │ usePremiumGate  │ │
│  │    (Zustand)     │  │    (Hook)       │  │    (Hook)       │ │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘ │
│           │                    │                    │           │
│           ▼                    ▼                    ▼           │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │               RevenueCat SDK (react-native-purchases)        ││
│  └─────────────────────────────────────────────────────────────┘│
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────┐                                           │
│  │  App Group      │◄──────── Write on launch + purchase        │
│  │  (Shared Data)  │                                           │
│  └────────┬────────┘                                           │
└───────────┼─────────────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────┐
│   iOS Share Extension │
│   Reads subscription  │
│   + usage from App    │
│   Group storage       │
└───────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         BACKEND                                  │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ /webhooks/      │  │ /subscriptions  │  │ Usage Limit     │ │
│  │ revenuecat      │  │ /status         │  │ Enforcement     │ │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘ │
│           │                    │                    │           │
│           ▼                    ▼                    ▼           │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Supabase (PostgreSQL)                     ││
│  │  user_profile.subscription_status, user_profile.usage_*     ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
            ▲
            │ Webhooks
            │
┌───────────────────────┐
│      RevenueCat       │
│   (Subscription       │
│    Management)        │
└───────────────────────┘
```

### Key Files

| Component | File | Purpose |
|-----------|------|---------|
| Mobile SDK | `mobile/src/services/revenueCat.ts` | SDK initialization and helpers |
| Mobile Store | `mobile/src/stores/subscriptionStore.ts` | Zustand state management |
| Mobile Hook | `mobile/src/hooks/useSubscription.ts` | Subscription operations |
| Mobile Sync | `mobile/src/services/appGroupSync.ts` | App Group synchronization |
| Backend Webhook | `backend/app/api/webhooks.py` | RevenueCat event handler |
| Backend API | `backend/app/api/subscriptions.py` | Status and usage endpoints |
| Swift Storage | `mobile/plugins/share-extension/Utilities/AppGroupStorage.swift` | Share Extension access |
| DB Migration | `supabase/migrations/0040_add_subscription_fields.sql` | Schema changes |

---

## Apple Developer Account Setup

### 1. App Groups (Required for Share Extension)

The Share Extension needs to read subscription status from the main app via App Groups.

1. Log in to [Apple Developer Portal](https://developer.apple.com/account)
2. Go to **Certificates, Identifiers & Profiles** > **Identifiers**
3. Click **App Groups** in the sidebar
4. Click **+** to register a new App Group:
   - **Description**: Atlasi App Group
   - **Identifier**: `group.com.atlasi.app`
5. Click **Continue** > **Register**

### 2. Configure App ID Entitlements

For **both** the main app and Share Extension:

1. Go to **Identifiers** > **App IDs**
2. Select `com.atlasi.app` (main app)
3. Scroll to **Capabilities** and enable:
   - **App Groups** - Select `group.com.atlasi.app`
   - **In-App Purchase** (should be enabled by default)
4. Click **Save**
5. Repeat for `com.atlasi.app.ShareExtension`

### 3. Regenerate Provisioning Profiles

After modifying entitlements, regenerate provisioning profiles:

1. Go to **Profiles**
2. Select each profile for `com.atlasi.app` and `com.atlasi.app.ShareExtension`
3. Click **Edit** > **Save** to regenerate
4. Download and install the new profiles

**In Xcode** (after `npx expo prebuild`):
1. Open `mobile/ios/AtlasI.xcworkspace`
2. Select the project, then each target
3. Go to **Signing & Capabilities**
4. Ensure App Groups shows `group.com.atlasi.app`

---

## App Store Connect Configuration

### 1. Create Subscription Group

1. Log in to [App Store Connect](https://appstoreconnect.apple.com)
2. Select your app
3. Go to **Monetization** > **Subscriptions**
4. Click **+** to create a **Subscription Group**:
   - **Reference Name**: Premium Access
   - **Subscription Group ID**: `premium_access` (auto-generated, note this)

### 2. Create Subscription Products

Create the following products in your subscription group:

| Reference Name | Product ID | Duration | Price (USD) | Free Trial |
|----------------|------------|----------|-------------|------------|
| Weekly Premium | `com.atlasi.app.Weekly` | 1 Week | $4.99 | 7 days |
| Monthly Premium | `com.atlasi.app.Monthly` | 1 Month | $9.99 | 7 days |
| Annual Premium | `com.atlasi.app.Annual` | 1 Year | $49.99 | 7 days |

For each product:
1. Click **+** > **Create Subscription**
2. Fill in:
   - **Reference Name**: e.g., "Annual Premium"
   - **Product ID**: e.g., `com.atlasi.app.Annual`
   - **Subscription Duration**: Select appropriate duration
3. Add **Subscription Prices** (click + under Pricing)
4. Add **Localizations** for App Store display
5. For Monthly and Annual, add **Introductory Offers**:
   - **Type**: Free Trial
   - **Duration**: 7 days

### 3. Submit for Review

New in-app purchases require review. You can:
- Submit them with your next app update, OR
- Submit for standalone review (if app is already live)

### 4. Sandbox Testing Setup

1. Go to **Users and Access** > **Sandbox** > **Testers**
2. Click **+** to add a sandbox tester:
   - Use a unique email (can be fake, e.g., `test@example.com`)
   - Create a simple password
   - Select your region
3. On your test device:
   - Go to **Settings** > **Developer** (scroll down)
   - Under **Sandbox Account**, sign in with your sandbox credentials
   - Keep your regular Apple ID signed in under Settings > Apple ID

**Sandbox Behavior:**
- Subscriptions renew rapidly for testing:
  - Weekly: Every 3 minutes
  - Monthly: Every 5 minutes
  - Annual: Every 1 hour
- Subscriptions auto-cancel after 6 renewals
- Free trials last a maximum of 5 minutes

---

## RevenueCat Dashboard Setup

### 1. Create Project

1. Sign up at [RevenueCat](https://www.revenuecat.com)
2. Create a new project: "Atlasi"
3. Add **Apple App Store** as a platform

### 2. Configure Apple App Store

1. Go to **Project Settings** > **Apps** > **Apple App Store**
2. Provide:
   - **Bundle ID**: `com.atlasi.app`
   - **App Store Connect API Key** (recommended for server-to-server):
     - In App Store Connect, go to **Users and Access** > **Keys**
     - Create an **App Store Connect API** key with "App Manager" role
     - Download the `.p8` file
     - Enter the Key ID, Issuer ID, and upload the key
   - OR use **App-Specific Shared Secret** (legacy):
     - In App Store Connect, go to your app > **General** > **App Information**
     - Find **App-Specific Shared Secret** and generate/copy it

### 3. Create Products

1. Go to **Products** in RevenueCat
2. Click **+ New** for each subscription:

| Identifier | App Store Product ID | Type |
|------------|---------------------|------|
| `weekly` | `com.atlasi.app.Weekly` | Subscription |
| `monthly` | `com.atlasi.app.Monthly` | Subscription |
| `annual` | `com.atlasi.app.Annual` | Subscription |

### 4. Create Entitlement

1. Go to **Entitlements**
2. Click **+ New**:
   - **Identifier**: `Full Access`
   - Add all three products to this entitlement

### 5. Create Offering

1. Go to **Offerings**
2. Click **+ New**:
   - **Identifier**: `default`
   - Set as **Current Offering**
3. Add packages:
   - **Weekly**: Associate with `weekly` product
   - **Monthly**: Associate with `monthly` product
   - **Annual**: Associate with `annual` product

### 6. Get API Keys

1. Go to **Project Settings** > **API Keys**
2. Copy the **Public app-specific API keys**:
   - iOS: `appl_XXXXXXXXXXXX`
   - Android (if applicable): `goog_XXXXXXXXXXXX`
3. Copy the **Secret API key** (starts with `sk_`) for server-side verification

---

## Local Development Setup

### 1. Mobile Environment Variables

Create or update `mobile/.env.local`:

```bash
# RevenueCat API Keys
EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=appl_XXXXXXXXXXXX
EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY=goog_XXXXXXXXXXXX
```

### 2. Backend Environment Variables

Add to `backend/.env`:

```bash
# RevenueCat Configuration
REVENUECAT_WEBHOOK_AUTH_HEADER=your-secure-random-string-here
REVENUECAT_API_KEY=sk_XXXXXXXXXXXX
```

Generate a secure webhook auth header:
```bash
openssl rand -base64 32
```

### 3. Database Migration

Ensure the subscription schema is applied:

```bash
# Check if migration exists
ls supabase/migrations/0040_add_subscription_fields.sql
ls supabase/migrations/0041_add_subscription_functions.sql

# Apply via Supabase dashboard or CLI
supabase db push
```

**Important:** Migration `0056_fix_service_role_guard.sql` fixes a bug where the `update_subscription_if_newer` RPC function incorrectly checked `session_user != 'service_role'`. Since PostgREST uses the `authenticator` role (not `service_role`), this check always failed, silently preventing all webhook and `/subscriptions/verify` subscription updates. The fix removes the in-function check and relies on proper REVOKE/GRANT permissions instead.

### Subscription Backfill

If existing users have purchases in RevenueCat that aren't reflected in the database (due to the migration 0056 bug), use the one-time backfill script:

```bash
cd backend
poetry run python scripts/backfill_subscriptions.py
```

This script queries the RevenueCat API for all subscribers and updates their `user_profile` records in Supabase. It validates UUIDs before querying and provides a dry-run summary.

### 4. Build Development App

RevenueCat requires a development build (not Expo Go):

```bash
cd mobile

# Create development build
npx expo prebuild --clean
npx expo run:ios

# OR use EAS Build for device testing
eas build --profile development --platform ios
```

---

## Testing Subscription Flows

### 1. Sandbox Testing on Device

1. **Configure sandbox account** on your device (see [Sandbox Testing Setup](#4-sandbox-testing-setup))

2. **Run the app** on a physical device (simulators can't test real purchases):
   ```bash
   npx expo run:ios --device
   ```

3. **Test purchase flow**:
   - Navigate to paywall
   - Select a subscription (Annual recommended for trials)
   - Complete sandbox purchase
   - Verify subscription status updates

4. **Verify in RevenueCat Dashboard**:
   - Go to **Customers** > search by App User ID
   - Check entitlements and transaction history

### 2. Test Scenarios Checklist

**Onboarding Flow:**
- [ ] Paywall shows after account creation (AccountCreation → EmotionalHook → FunctionalHook → Paywall)
- [ ] "Start Trial" initiates purchase
- [ ] "Maybe Later" continues as free user
- [ ] Purchase completes and grants premium
- [ ] Restore purchases works

**Free Tier Limits:**
- [ ] Can create 10 entries per trip
- [ ] 11th entry shows paywall
- [ ] Can use share extension 5 times
- [ ] 6th share shows limit message
- [ ] Can import 1 photo trip
- [ ] 2nd import shows paywall

**Share Extension:**
- [ ] Premium users can save unlimited
- [ ] Free users see usage countdown
- [ ] Limit reached shows upgrade prompt

**Subscription Management:**
- [ ] Settings shows current plan
- [ ] Expiration date displayed
- [ ] "Manage Subscription" opens App Store
- [ ] Restore purchases works

### 3. Testing Without Real Purchases

For development without Apple sandbox:

1. **Bypass subscription check** (development only):
   ```typescript
   // In mobile/src/stores/subscriptionStore.ts (temporarily)
   // Change initial status for testing:
   status: __DEV__ ? 'premium' : 'loading',
   ```

2. **Use RevenueCat Sandbox Mode**:
   - Debug logs are automatically enabled in development
   - Check console for `[RevenueCat]` logs

3. **Test webhook handling** with simulated events (see below)

---

## Webhook Configuration & Testing

### 1. Configure Webhook in RevenueCat

1. Go to **Project Settings** > **Integrations** > **Webhooks**
2. Click **+ New Webhook**:
   - **Name**: Backend Webhook
   - **Webhook URL**: `https://your-api-domain.com/webhooks/revenuecat`
   - **Authorization header**: Paste the value from `REVENUECAT_WEBHOOK_AUTH_HEADER`

### 2. Test Webhooks Locally with ngrok

For local development, expose your backend:

```bash
# Install ngrok
brew install ngrok

# Start your backend
cd backend && poetry run uvicorn app.main:app --reload --host 0.0.0.0

# In another terminal, expose it
ngrok http 8000
```

Copy the ngrok URL (e.g., `https://abc123.ngrok.io`) and configure it in RevenueCat:
- **Webhook URL**: `https://abc123.ngrok.io/webhooks/revenuecat`

### 3. Use RevenueCat's Webhook Testing Tool

1. In RevenueCat Dashboard, go to **Webhooks**
2. Select your webhook
3. Click **Send Test Event**
4. Choose event type (e.g., `INITIAL_PURCHASE`)
5. Enter a test `app_user_id` (user's Supabase UUID)
6. Click **Send**

### 4. Simulate Webhook Events with curl

```bash
# Set variables
WEBHOOK_URL="http://localhost:8000/webhooks/revenuecat"
AUTH_HEADER="your-secure-random-string-here"
USER_ID="your-test-user-uuid"

# Simulate INITIAL_PURCHASE
curl -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: $AUTH_HEADER" \
  -d '{
    "api_version": "1.0",
    "event": {
      "type": "INITIAL_PURCHASE",
      "id": "test-event-'$(date +%s)'",
      "app_user_id": "'$USER_ID'",
      "original_app_user_id": "'$USER_ID'",
      "product_id": "com.atlasi.app.Annual",
      "period_type": "TRIAL",
      "expiration_at_ms": '$(date -v+7d +%s000)',
      "event_timestamp_ms": '$(date +%s000)'
    }
  }'

# Simulate EXPIRATION
curl -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: $AUTH_HEADER" \
  -d '{
    "api_version": "1.0",
    "event": {
      "type": "EXPIRATION",
      "id": "test-event-'$(date +%s)'",
      "app_user_id": "'$USER_ID'",
      "product_id": "com.atlasi.app.Annual",
      "event_timestamp_ms": '$(date +%s000)'
    }
  }'
```

### 5. Verify Webhook Processing

Check your backend logs:
```bash
tail -f backend/logs/app.log | grep -i revenuecat
```

Query the database:
```sql
SELECT id, subscription_status, subscription_plan, subscription_expires_at
FROM user_profile
WHERE id = 'your-test-user-uuid';
```

---

## Troubleshooting Guide

### Common Issues

#### 1. "RevenueCat not configured" Warning

**Symptom:** Console shows `[RevenueCat] No API key configured for platform: ios`

**Cause:** Missing environment variable

**Solution:**
1. Check `mobile/.env.local` has `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`
2. Rebuild the app (env vars are embedded at build time):
   ```bash
   npx expo prebuild --clean
   npx expo run:ios
   ```

#### 2. Purchases Fail with "Cannot make payments"

**Symptom:** Purchase throws error about StoreKit configuration

**Causes:**
- Running in Expo Go (not supported)
- Running in Simulator without StoreKit configuration
- App not properly signed

**Solutions:**
1. Use a development build on a physical device
2. For Simulator testing, add a StoreKit configuration file:
   - In Xcode: **File** > **New** > **File** > **StoreKit Configuration File**
   - Add your subscription products
   - In your scheme, set **Options** > **StoreKit Configuration**

#### 3. Share Extension Can't Read Subscription Status

**Symptom:** Share Extension always shows "free" even for premium users

**Causes:**
- App Group not configured correctly
- Main app hasn't synced subscription to App Group
- Entitlements mismatch between app and extension

**Solutions:**
1. Verify App Group in entitlements:
   ```bash
   # Check main app
   cat mobile/ios/Atlasi/Atlasi.entitlements | grep -A2 "com.apple.security.application-groups"

   # Check extension
   cat mobile/ios/ShareExtension/ShareExtension.entitlements | grep -A2 "com.apple.security.application-groups"
   ```
2. Both should show `group.com.atlasi.app`
3. Force a sync by opening the main app before using Share Extension

#### 4. Webhook Returns 401 Unauthorized

**Symptom:** RevenueCat webhook fails with 401

**Causes:**
- Authorization header mismatch
- Header not configured in backend

**Solutions:**
1. Verify backend has `REVENUECAT_WEBHOOK_AUTH_HEADER` set
2. Verify RevenueCat dashboard has the same value in webhook configuration
3. Ensure no trailing whitespace/newlines in the secret

#### 5. Subscription Status Not Updating After Purchase

**Symptom:** User purchases but app still shows "free"

**Causes:**
- Webhook not delivered
- Webhook processing failed
- CustomerInfo listener not firing

**Solutions:**
1. Check RevenueCat Dashboard > **Customers** > search user > **Event History**
2. Check backend logs for webhook errors
3. Force refresh in app:
   ```typescript
   // Call from settings or a debug menu
   const { refetch } = useSubscription();
   await refetch();
   ```
4. Add fallback verification endpoint:
   ```typescript
   // Verify subscription directly with RevenueCat API
   await api.post('/subscriptions/verify');
   ```

#### 6. "Product not available" Error

**Symptom:** RevenueCat returns empty offerings or products

**Causes:**
- Products not approved in App Store Connect
- Products not linked in RevenueCat
- Using wrong environment (production vs sandbox)

**Solutions:**
1. Check App Store Connect: products should be "Ready to Submit" or approved
2. Verify RevenueCat Products match App Store Product IDs exactly
3. Check offering has packages with products attached
4. Ensure using correct API key (sandbox vs production)

#### 7. Trial Not Showing / Trial Already Used

**Symptom:** User doesn't see free trial option

**Causes:**
- User already used trial (Apple tracks this per Apple ID)
- Introductory offer not configured
- Using sandbox account that exhausted trial

**Solutions:**
1. In App Store Connect, verify introductory offers are configured
2. Create a new sandbox tester account (trials are per-account)
3. Check RevenueCat offering includes product with trial

#### 8. Database Constraint Violation on Subscription Update

**Symptom:** Backend returns 500 when processing webhook

**Cause:** Invalid subscription_plan value

**Solution:** Check migration includes all plan values:
```sql
-- Should include 'weekly' if using weekly subscriptions
CHECK (subscription_plan IN ('weekly', 'monthly', 'yearly') OR subscription_plan IS NULL)
```

### Debug Checklist

When debugging subscription issues:

1. **Check RevenueCat Dashboard:**
   - Customer exists?
   - Correct entitlement active?
   - Transactions showing?

2. **Check Mobile Logs:**
   ```bash
   # Filter for RevenueCat logs
   xcrun simctl spawn booted log stream --predicate 'subsystem == "com.atlasi.app"' 2>&1 | grep -i revenue
   ```

3. **Check Backend Logs:**
   ```bash
   tail -f backend/logs/app.log | grep -E "(revenuecat|subscription|webhook)"
   ```

4. **Check Database State:**
   ```sql
   SELECT
     id,
     subscription_status,
     subscription_plan,
     subscription_expires_at,
     usage_share_extension_count,
     usage_photo_import_count,
     last_webhook_timestamp_ms
   FROM user_profile
   WHERE id = 'user-uuid';
   ```

5. **Check App Group State (on device):**
   - Use a debug menu to call `getSubscriptionFromAppGroup()`
   - Log the result to verify sync

### Getting Help

- **RevenueCat Documentation**: https://docs.revenuecat.com
- **RevenueCat Community**: https://community.revenuecat.com
- **Apple StoreKit Docs**: https://developer.apple.com/documentation/storekit
- **App Store Review Guidelines (IAP)**: https://developer.apple.com/app-store/review/guidelines/#in-app-purchase

---

## Quick Reference

### Environment Variables Summary

**Mobile (`mobile/.env.local`):**
```bash
EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=appl_xxx
EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY=goog_xxx  # Optional
```

**Backend (`backend/.env`):**
```bash
REVENUECAT_WEBHOOK_AUTH_HEADER=secure-random-string
REVENUECAT_API_KEY=sk_xxx
```

### Product IDs

| Plan | Product ID |
|------|------------|
| Weekly | `com.atlasi.app.Weekly` |
| Monthly | `com.atlasi.app.Monthly` |
| Annual | `com.atlasi.app.Annual` |

### Entitlement ID

```
Full Access
```

### App Group ID

```
group.com.atlasi.app
```

### Free Tier Limits

| Feature | Limit |
|---------|-------|
| Share Extension Uses | 5 per month |
| Photo Import Trips | 1 (lifetime) |
| Entries per Trip | 10 |

These limits are defined in:
- TypeScript: `mobile/src/stores/subscriptionStore.ts` (`FREE_LIMITS`)
- Python: `backend/app/api/subscriptions.py` (`FREE_LIMITS`)
- Swift: `mobile/plugins/share-extension/Utilities/AppGroupStorage.swift` (`freeShareExtensionLimit`)
