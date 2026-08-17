# Ad Tracking & Attribution Setup

Manual setup steps required to activate the ad tracking and attribution integrations on this branch.

## Prerequisites

You need accounts and credentials from these platforms before proceeding:

- **Facebook/Meta**: App at [developers.facebook.com](https://developers.facebook.com)
- **TikTok**: Business account at [ads.tiktok.com](https://ads.tiktok.com)
- **RevenueCat**: Project at [revenuecat.com](https://www.revenuecat.com)
- **Apple Search Ads**: Account at [searchads.apple.com](https://searchads.apple.com)

## 1. Facebook/Meta App Setup

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps)
2. Create an app (or use existing) and get:
   - **App ID** -> `EXPO_PUBLIC_FB_APP_ID` in `mobile/.env.local`
   - **Client Token** (Settings > Advanced) -> `EXPO_PUBLIC_FB_CLIENT_TOKEN` in `mobile/.env.local`
3. Set up a Pixel/Dataset in [Events Manager](https://business.facebook.com/events_manager):
   - **Pixel ID** (also called Dataset ID) -> `FACEBOOK_PIXEL_ID` in `backend/.env`
   - Generate a **System User Access Token** with `ads_management` scope -> `FACEBOOK_CAPI_ACCESS_TOKEN` in `backend/.env`

## 2. TikTok Events API Setup

1. Go to [ads.tiktok.com](https://ads.tiktok.com) and apply for Marketing API access (~2 day approval)
2. Create a Pixel in Events Manager:
   - **Pixel Code** -> `TIKTOK_PIXEL_CODE` in `backend/.env`
   - Generate an **Access Token** -> `TIKTOK_ACCESS_TOKEN` in `backend/.env`

## 3. RevenueCat Dashboard Integrations

### Apple Search Ads

1. Go to RevenueCat Dashboard > your project > Integrations
2. Enable **Apple Search Ads** (listed as "Apple Ads Services")
3. For Standard attribution: no additional credentials needed — the SDK automatically collects the AdServices token
4. For Advanced attribution (keyword-level data): add your Apple Ads API credentials:
   - Client ID, Team ID, Key ID from [searchads.apple.com](https://searchads.apple.com) > Account Settings > API

### Meta Ads

1. Go to RevenueCat Dashboard > your project > Integrations
2. Enable **Meta Ads**
3. Enter your **Datasource ID** (same as Facebook Pixel ID from step 1)
4. Enter your **Client Token** (from Facebook app settings)
5. Choose revenue reporting format (gross vs net)
6. RevenueCat will send subscription lifecycle events (trial start, purchase, renewal, cancellation) to Meta Conversions API server-side — even when the app isn't running

## 4. Verify SKAdNetwork IDs

Before shipping, verify the SKAdNetwork IDs in `mobile/app.config.js` are current:

- Meta: Check [developers.facebook.com/docs/SKAdNetwork](https://developers.facebook.com/docs/SKAdNetwork)
- TikTok: Check [ads.tiktok.com/help/article/about-skan-4-0-and-tiktok](https://ads.tiktok.com/help/article/about-skan-4-0-and-tiktok)

Current IDs in `app.config.js`:
```
v9wttpbfk9.skadnetwork  (Meta)
n38lu8286q.skadnetwork  (Meta)
238da6jt44.skadnetwork  (TikTok)
22mmun2rn5.skadnetwork  (TikTok)
```

## 5. Build & Deploy

This branch adds native plugins (`react-native-fbsdk-next`, `expo-tracking-transparency`) and changes SDK initialization behavior. **A new EAS build is required** — EAS Update is not sufficient.

```bash
cd mobile
npx expo prebuild --clean    # Verify config plugin output
eas build --profile production --platform ios
```

## Environment Variables Summary

### Mobile (`mobile/.env.local`)

| Variable | Source | Required |
|----------|--------|----------|
| `EXPO_PUBLIC_FB_APP_ID` | Facebook App Dashboard > Settings > Basic | Yes |
| `EXPO_PUBLIC_FB_CLIENT_TOKEN` | Facebook App Dashboard > Settings > Advanced | Yes |

### Backend (`backend/.env`)

| Variable | Source | Required |
|----------|--------|----------|
| `FACEBOOK_PIXEL_ID` | Meta Events Manager > Datasource Settings | Yes (for CAPI) |
| `FACEBOOK_CAPI_ACCESS_TOKEN` | Meta Events Manager > System User Token | Yes (for CAPI) |
| `TIKTOK_PIXEL_CODE` | TikTok Ads Manager > Events > Pixel | Yes (for TikTok) |
| `TIKTOK_ACCESS_TOKEN` | TikTok Ads Manager > Marketing API | Yes (for TikTok) |

## Verification Checklist

After deploying, verify the full pipeline:

- [ ] ATT prompt appears after account creation (EmotionalHookScreen)
- [ ] `fb_mobile_activate_app` fires on app open (automatic via Facebook SDK)
- [ ] `CompleteRegistration` appears in Facebook Events Manager (Test Events tool)
- [ ] `StartTrial` / `Subscribe` events fire on subscription
- [ ] Server-side events appear in Facebook Events Manager with matching `event_id` (dedup)
- [ ] Server-side events appear in TikTok Events Manager
- [ ] RevenueCat subscriber shows `$fbAnonId` attribute (Meta Ads attribution)
- [ ] RevenueCat subscriber shows `$idfa` / `$idfv` attributes (device identifiers)
- [ ] RevenueCat debug logs show "AdServices attribution token collected" (Apple Search Ads)
- [ ] Events do NOT fire in development mode
- [ ] RevenueCat Charts show attribution data after enabling dashboard integrations
