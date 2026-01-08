# Border Badge Launch Readiness Checklist

## Pre-Launch Requirements

### Backend Infrastructure

- [ ] Supabase project configured for production
- [ ] Database migrations applied
- [ ] Row Level Security (RLS) policies verified
- [ ] Storage buckets configured with correct permissions
- [ ] Edge functions deployed (if applicable)
- [ ] Environment variables set in production
- [ ] Database backups configured

### Mobile App Configuration

- [ ] App identifiers set (bundle ID / package name)
- [ ] App icons and splash screens finalized
- [ ] EAS project linked (`eas init`)
- [ ] `app.json` version and build numbers updated
- [ ] Deep linking configured (if applicable)

### Testing

- [ ] All backend tests passing (`poetry run pytest`)
- [ ] All mobile tests passing (`npm test`)
- [ ] Manual smoke test on iOS device
- [ ] Manual smoke test on Android device
- [ ] E2E tests passing (`npm run e2e:ios` / `npm run e2e:android`)

### Security

- [ ] API keys rotated for production
- [ ] Supabase anon key is read-only appropriate
- [ ] No hardcoded secrets in codebase
- [ ] HTTPS enforced on all endpoints
- [ ] Auth token handling verified

---

## OAuth Provider Publishing

### Google OAuth (Required for Google Sign-In)

Before launch, your Google OAuth app must be published for all users to sign in.

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **APIs & Services** → **OAuth consent screen**
3. Review the current status (Testing vs Production)

**Publishing Steps:**

- [ ] OAuth consent screen information complete:
  - [ ] App name
  - [ ] User support email
  - [ ] App logo (optional but recommended)
  - [ ] App homepage link
  - [ ] App privacy policy link
  - [ ] App terms of service link (optional)
  - [ ] Authorized domains (your app domain)
  - [ ] Developer contact email
- [ ] Scopes configured (email, profile, openid)
- [ ] Click **PUBLISH APP** button
- [ ] Confirm publishing (app moves from "Testing" to "In production")

**Notes:**
- While in "Testing" mode, only emails added to test users list can sign in (max 100)
- Publishing to production allows any Google user to sign in
- If requesting sensitive/restricted scopes, Google verification may be required (can take weeks)
- For basic scopes (email, profile, openid), no verification needed

**Verification:**
- [ ] Test Google Sign-In with an email NOT in test users list
- [ ] Confirm sign-in works for new users

### Facebook OAuth (If Applicable)

Before launch, your Facebook app must be in Live mode.

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Select your app
3. Navigate to **App Review** → **Permissions and Features**

**Publishing Steps:**

- [ ] App Settings → Basic complete:
  - [ ] Display name
  - [ ] App icon (1024x1024)
  - [ ] Privacy Policy URL
  - [ ] Terms of Service URL (optional)
  - [ ] App category
  - [ ] Business verification (if required)
- [ ] Facebook Login product added and configured:
  - [ ] Valid OAuth Redirect URIs includes Supabase callback
  - [ ] Client OAuth settings configured
- [ ] Data Use Checkup completed (if prompted)
- [ ] App Mode switched from **Development** to **Live**:
  - Go to top of dashboard, toggle **App Mode** to **Live**

**Notes:**
- While in "Development" mode, only app admins/developers/testers can log in
- Switching to Live mode requires Privacy Policy URL
- Some permissions require App Review before going live
- Basic permissions (email, public_profile) don't require review

**Verification:**
- [ ] Test Facebook Sign-In with an account NOT added as tester
- [ ] Confirm sign-in works for new users

### Apple Sign-In

Apple Sign-In doesn't have a separate publishing step - it works automatically once configured in:
- [ ] Apple Developer Portal (App ID with Sign In with Apple capability)
- [ ] Supabase (Apple provider with Services ID, Key ID, Team ID, Secret Key)

**Verification:**
- [ ] Test Apple Sign-In on physical iOS device
- [ ] Confirm user created in Supabase Auth

---

## App Store Submission (iOS)

### Apple Developer Account

- [ ] Apple Developer Program membership active
- [ ] App Store Connect app record created
- [ ] Bundle identifier registered
- [ ] Provisioning profiles configured in EAS

### App Store Assets

- [ ] App name (30 chars max)
- [ ] Subtitle (30 chars max)
- [ ] Description (4000 chars max)
- [ ] Keywords (100 chars max)
- [ ] Screenshots for all required device sizes:
  - [ ] 6.7" (iPhone 15 Pro Max)
  - [ ] 6.5" (iPhone 14 Plus)
  - [ ] 5.5" (iPhone 8 Plus)
- [ ] App Preview videos (optional)
- [ ] App icon (1024x1024)

### App Store Information

- [ ] Privacy Policy URL
- [ ] Support URL
- [ ] Marketing URL (optional)
- [ ] Category selected
- [ ] Age rating questionnaire completed
- [ ] App Privacy details filled out

### Build & Submit

- [ ] Production build created: `eas build --platform ios --profile production`
- [ ] Build tested via TestFlight
- [ ] Submit to App Store: `eas submit --platform ios`
- [ ] Export compliance answered
- [ ] Content rights confirmed

---

## Play Store Submission (Android)

### Google Play Console

- [ ] Google Play Developer account active ($25 one-time fee)
- [ ] App record created in Google Play Console
- [ ] Package name registered
- [ ] Signing key configured in EAS

### Play Store Assets

- [ ] App name (50 chars max)
- [ ] Short description (80 chars max)
- [ ] Full description (4000 chars max)
- [ ] Screenshots for phone (min 2):
  - [ ] Minimum 320px, max 3840px
  - [ ] 16:9 or 9:16 aspect ratio
- [ ] Feature graphic (1024x500)
- [ ] App icon (512x512)

### Play Store Information

- [ ] Privacy Policy URL
- [ ] Category selected
- [ ] Content rating questionnaire completed
- [ ] Target audience and content
- [ ] Data safety section filled out

### Build & Submit

- [ ] Production build created: `eas build --platform android --profile production`
- [ ] Internal testing track tested
- [ ] Submit to Play Store: `eas submit --platform android`
- [ ] Release track selected (internal → closed → open → production)

---

## CI/CD Verification

### GitHub Actions

- [ ] `EXPO_TOKEN` secret configured
- [ ] CI workflow passing on main branch
- [ ] EAS build workflow tested with manual trigger

### For iOS Submission (via CI)

- [ ] `APPLE_ID` secret configured
- [ ] `ASC_APP_ID` secret configured
- [ ] `APPLE_TEAM_ID` secret configured

### For Android Submission (via CI)

- [ ] `GOOGLE_SERVICE_ACCOUNT_KEY` secret configured

---

## Post-Launch Monitoring

### Analytics & Crash Reporting

- [ ] Sentry or similar crash reporting configured
- [ ] Analytics tracking verified
- [ ] Performance monitoring enabled

### Operations

- [ ] Error alerting configured
- [ ] Database monitoring enabled
- [ ] Backup verification scheduled

---

## GitHub Secrets Required

| Secret                       | Description                       | Where to get                                                                          |
| ---------------------------- | --------------------------------- | ------------------------------------------------------------------------------------- |
| `EXPO_TOKEN`                 | Expo access token                 | [expo.dev/accounts/[account]/settings/access-tokens](https://expo.dev)                |
| `APPLE_ID`                   | Apple ID email                    | Your Apple account                                                                    |
| `ASC_APP_ID`                 | App Store Connect App ID          | App Store Connect → App → General → App Information                                   |
| `APPLE_TEAM_ID`              | Apple Developer Team ID           | [developer.apple.com/account](https://developer.apple.com) → Membership               |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Google Cloud service account JSON | [console.cloud.google.com](https://console.cloud.google.com) → IAM → Service Accounts |

---

## Quick Commands

```bash
# Run all backend tests
cd backend && poetry run pytest -v

# Run all mobile tests
cd mobile && npm test

# Run linting
cd backend && poetry run ruff check .
cd mobile && npm run lint

# Build for preview (internal testing)
cd mobile && eas build --platform all --profile preview

# Build for production
cd mobile && eas build --platform all --profile production

# Submit to stores (after build completes)
cd mobile && eas submit --platform ios --latest
cd mobile && eas submit --platform android --latest
```

---

## Version History

| Version | Date | Notes           |
| ------- | ---- | --------------- |
| 1.0.0   | TBD  | Initial release |
