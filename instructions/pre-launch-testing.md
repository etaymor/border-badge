# Pre-Launch Testing Checklist

Complete guide for testing Atlasi on a physical device with full native functionality including Google Sign-In and iOS Share Extension.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Part 1: Apple Developer Portal Setup](#part-1-apple-developer-portal-setup)
3. [Part 2: EAS Build Configuration](#part-2-eas-build-configuration)
4. [Part 3: Building and Installing on Device](#part-3-building-and-installing-on-device)
5. [Part 4: Testing Google Sign-In](#part-4-testing-google-sign-in)
6. [Part 5: Testing iOS Share Extension](#part-5-testing-ios-share-extension)
7. [Part 6: Railway Backend Deployment](#part-6-railway-backend-deployment)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Accounts

- [ ] Apple Developer Account ($99/year) - https://developer.apple.com
- [ ] Expo Account (free) - https://expo.dev
- [ ] Railway Account (free tier available) - https://railway.app
- [ ] Supabase Project (already configured)

### Required Tools

```bash
# Install EAS CLI globally
npm install -g eas-cli

# Verify installation
eas --version  # Should be >= 12.0.0

# Login to Expo
eas login
```

### Physical iOS Device

- iPhone or iPad running iOS 15.0+
- Connected to same network as development machine (for local testing)
- Device registered in Apple Developer Portal

---

## Part 1: Apple Developer Portal Setup

### Step 1.1: Register Your Device

1. Connect your iPhone to your Mac
2. Open Finder (or iTunes on older macOS)
3. Click on your device in the sidebar
4. Click on your device name to reveal the UDID
5. Copy the UDID

**In Apple Developer Portal:**

1. Go to https://developer.apple.com/account
2. Navigate to **Certificates, Identifiers & Profiles**
3. Click **Devices** in the sidebar
4. Click the **+** button
5. Enter:
   - Device Name: `My iPhone` (or descriptive name)
   - Device ID (UDID): Paste the UDID
6. Click **Continue** → **Register**

- [ ] Device registered in Apple Developer Portal

---

### Step 1.2: Create App Group

App Groups allow the main app and Share Extension to share data.

1. In Apple Developer Portal, go to **Identifiers**
2. Click the **+** button
3. Select **App Groups** and click **Continue**
4. Enter:
   - Description: `Atlasi App Group`
   - Identifier: `group.com.borderbadge.app`
5. Click **Continue** → **Register**

- [ ] App Group `group.com.borderbadge.app` created

---

### Step 1.3: Create App ID for Main App

1. Go to **Identifiers** → Click **+**
2. Select **App IDs** → Click **Continue**
3. Select **App** → Click **Continue**
4. Enter:
   - Description: `Atlasi`
   - Bundle ID: Select **Explicit** and enter `com.borderbadge.app`
5. Scroll down to **Capabilities** and enable:
   - [ ] **App Groups**
   - [ ] **Associated Domains** (for deep links)
   - [ ] **Sign In with Apple**
6. Click **Continue** → **Register**

**Configure App Group:**

1. Click on the newly created App ID
2. Scroll to **App Groups** and click **Configure**
3. Check `group.com.borderbadge.app`
4. Click **Save**

- [ ] Main App ID created with App Groups enabled

---

### Step 1.4: Create App ID for Share Extension

1. Go to **Identifiers** → Click **+**
2. Select **App IDs** → Click **Continue**
3. Select **App** → Click **Continue**
4. Enter:
   - Description: `Atlasi Share Extension`
   - Bundle ID: Select **Explicit** and enter `com.borderbadge.app.ShareExtension`
5. Scroll down to **Capabilities** and enable:
   - [ ] **App Groups**
6. Click **Continue** → **Register**

**Configure App Group:**

1. Click on the newly created Share Extension App ID
2. Scroll to **App Groups** and click **Configure**
3. Check `group.com.borderbadge.app`
4. Click **Save**

- [ ] Share Extension App ID created with App Groups enabled

---

### Step 1.5: Verify Configuration

Your Identifiers should now show:

| Identifier                           | Type      | App Groups Enabled |
| ------------------------------------ | --------- | ------------------ |
| `com.borderbadge.app`                | App ID    | Yes                |
| `com.borderbadge.app.ShareExtension` | App ID    | Yes                |
| `group.com.borderbadge.app`          | App Group | N/A                |

- [ ] All three identifiers configured correctly

---

## Part 2: EAS Build Configuration

### Step 2.1: Verify eas.json

Your `mobile/eas.json` should already be configured:

```json
{
  "cli": {
    "version": ">= 12.0.0",
    "appVersionSource": "local"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "channel": "development"
    },
    "preview": {
      "distribution": "internal",
      "channel": "preview",
      "ios": {
        "simulator": false
      }
    },
    "production": {
      "channel": "production",
      "autoIncrement": true,
      "ios": {
        "simulator": false
      }
    }
  }
}
```

- [ ] eas.json verified

---

### Step 2.2: Set Up Environment Variables for EAS

EAS Build needs access to your environment variables. Create/update secrets:

```bash
cd mobile

# Set Supabase credentials
eas secret:create --name EXPO_PUBLIC_SUPABASE_URL --value "https://your-project.supabase.co" --scope project
eas secret:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "your-anon-key" --scope project

# Set API URL (use your Railway URL after deployment, or local IP for testing)
eas secret:create --name EXPO_PUBLIC_API_URL --value "https://your-app.railway.app" --scope project

# Set Google Places API key
eas secret:create --name EXPO_PUBLIC_GOOGLE_PLACES_API_KEY --value "your-google-places-key" --scope project

# Set app environment
eas secret:create --name EXPO_PUBLIC_APP_ENV --value "production" --scope project
```

**Verify secrets are set:**

```bash
eas secret:list
```

- [ ] All required EAS secrets configured

---

### Step 2.3: Configure Apple Credentials in EAS

EAS can manage your Apple credentials automatically:

```bash
cd mobile

# Configure iOS credentials (will prompt for Apple ID)
eas credentials
```

Select:
1. **iOS**
2. **Build Credentials**
3. Choose your project
4. EAS will guide you through setting up:
   - Distribution Certificate
   - Provisioning Profiles (for both app and extension)

**Alternative: Use --auto-submit with credentials:**

For subsequent builds, EAS will remember your credentials.

- [ ] Apple credentials configured in EAS

---

## Part 3: Building and Installing on Device

### Step 3.1: Create Development Build

The development build includes the development client for hot reloading AND the Share Extension:

```bash
cd mobile

# Build for iOS device (development profile)
eas build --platform ios --profile development
```

This will:
1. Upload your project to EAS
2. Configure signing (may prompt for Apple ID)
3. Build the app with Share Extension
4. Provide a download link or QR code

**Build time:** ~10-15 minutes

- [ ] Development build completed successfully

---

### Step 3.2: Install on Device

**Option A: QR Code (Recommended)**

1. After build completes, EAS shows a QR code
2. Scan with your iPhone camera
3. Tap the notification to install

**Option B: Direct Download**

1. On your iPhone, open the build link from EAS
2. Tap "Install" when prompted
3. Go to Settings → General → VPN & Device Management
4. Trust the developer certificate

**Option C: Via Expo Dashboard**

1. Go to https://expo.dev
2. Navigate to your project → Builds
3. Find the completed build
4. Click "Install" and follow instructions

- [ ] App installed on physical device

---

### Step 3.3: Trust Developer Certificate

First time installing a development build:

1. Open **Settings** on your iPhone
2. Go to **General** → **VPN & Device Management**
3. Find your developer/organization name
4. Tap **Trust**

- [ ] Developer certificate trusted

---

### Step 3.4: Start Development Server

To enable hot reloading with the development build:

```bash
cd mobile

# Start Expo dev server
npx expo start --dev-client
```

1. Scan the QR code with your iPhone camera
2. Open the Atlasi development app
3. It will connect to your local dev server

- [ ] Development server running and connected

---

## Part 4: Testing Google Sign-In

### Step 4.1: Verify Supabase Configuration

Google Sign-In works through Supabase OAuth. Confirm in Supabase Dashboard:

1. Go to https://supabase.com/dashboard
2. Select your project
3. Go to **Authentication** → **Providers**
4. Verify **Google** is enabled with:
   - Client ID configured
   - Client Secret configured
   - Redirect URL includes your custom scheme

**Required Redirect URL in Google Cloud Console:**

The Supabase redirect URL should be added to your Google OAuth consent screen:
```
https://your-project.supabase.co/auth/v1/callback
```

- [ ] Supabase Google OAuth configured

---

### Step 4.2: Test Google Sign-In Flow

1. Open Atlasi on your device
2. On the Auth screen, tap **Continue with Google**
3. A web browser should open with Google's sign-in page
4. Sign in with your Google account
5. You should be redirected back to the app via `atlasi://auth-callback`
6. The app should log you in successfully

**Expected behavior:**
- Browser opens for OAuth
- After signing in, browser closes
- App receives session tokens
- User is logged in (or proceeds to onboarding if new)

- [ ] Google Sign-In works on device

---

### Step 4.3: Verify Session Persistence

1. After signing in, close the app completely (swipe up from app switcher)
2. Reopen the app
3. You should still be logged in (not prompted to sign in again)

- [ ] Session persists after app restart

---

## Part 5: Testing iOS Share Extension

### Step 5.1: Understanding the Share Extension

The Share Extension is automatically built and bundled by the Expo plugin at `mobile/plugins/withShareExtension.js`. It:
- Creates a "Save Place" option in the iOS share sheet
- Extracts URLs from TikTok, Instagram, and other apps
- Opens the main app via deep link with the shared URL

- [ ] Understand Share Extension purpose

---

### Step 5.2: Test from TikTok

1. Open TikTok on your iPhone
2. Find any travel-related video
3. Tap the **Share** button (arrow icon)
4. Scroll the bottom share sheet to find **Save Place** (Atlasi icon)
5. Tap **Save Place**
6. Atlasi should open to the Share Capture screen
7. The app should fetch metadata for the TikTok video

**Expected behavior:**
- Share sheet shows "Save Place" option with app icon
- Tapping opens Atlasi immediately
- ShareCaptureScreen shows loading, then video thumbnail
- Place detection attempts to identify location from video

- [ ] Share Extension works from TikTok

---

### Step 5.3: Test from Instagram

1. Open Instagram on your iPhone
2. Find a post with a location tag
3. Tap the **...** menu → **Share to...**
4. Select **Save Place**
5. Atlasi should open with the Instagram URL

- [ ] Share Extension works from Instagram

---

### Step 5.4: Test from Safari

1. Open Safari
2. Navigate to any travel blog or destination website
3. Tap the **Share** button
4. Select **Save Place**
5. Atlasi should open with the web URL

- [ ] Share Extension works from Safari

---

### Step 5.5: Test Unauthenticated Flow

1. Sign out of Atlasi
2. Share a URL from TikTok using "Save Place"
3. Atlasi should open to the Auth screen
4. Sign in
5. After sign-in, the shared URL should be processed (queued share)

- [ ] Unauthenticated share flow works correctly

---

## Part 6: Railway Backend Deployment

### Step 6.1: Create Railway Account and Project

1. Go to https://railway.app
2. Sign up/login with GitHub
3. Click **New Project**
4. Select **Deploy from GitHub repo**
5. Connect your `border-badge` repository
6. Select the **backend** folder as the root directory

- [ ] Railway project created from GitHub

---

### Step 6.2: Configure Build Settings

In Railway project settings:

1. Click on your service
2. Go to **Settings** tab
3. Configure:

| Setting           | Value                               |
| ----------------- | ----------------------------------- |
| Root Directory    | `/backend`                          |
| Build Command     | `pip install poetry && poetry install --no-dev` |
| Start Command     | `poetry run uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Watch Paths       | `/backend/**`                       |

**Alternative: Use a Procfile**

Create `backend/Procfile`:
```
web: poetry run uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

- [ ] Build settings configured

---

### Step 6.3: Set Environment Variables

In Railway dashboard, go to **Variables** and add:

**Required:**

| Variable                  | Value                                    |
| ------------------------- | ---------------------------------------- |
| `ENV`                     | `production`                             |
| `DEBUG`                   | `false`                                  |
| `SUPABASE_URL`            | `https://your-project.supabase.co`       |
| `SUPABASE_ANON_KEY`       | Your Supabase anon key                   |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key         |
| `SUPABASE_JWT_SECRET`     | Your Supabase JWT secret                 |
| `ALLOWED_ORIGINS`         | `https://your-domain.com,atlasi://`      |

**Optional (but recommended):**

| Variable                  | Value                                    |
| ------------------------- | ---------------------------------------- |
| `PUBLIC_WEB_BASE_URL`     | `https://your-app.railway.app`           |
| `OPENROUTER_API_KEY`      | For traveler classification feature      |
| `GOOGLE_PLACES_API_KEY`   | For place extraction                     |
| `AFFILIATE_SIGNING_SECRET`| For affiliate link security              |

- [ ] All environment variables configured

---

### Step 6.4: Deploy

1. Push any change to your repository, OR
2. Click **Deploy** in Railway dashboard

Railway will:
1. Detect Python project
2. Install dependencies with Poetry
3. Start Uvicorn server
4. Assign a public URL (e.g., `your-app.railway.app`)

- [ ] Deployment successful

---

### Step 6.5: Verify Deployment

```bash
# Test health endpoint
curl https://your-app.railway.app/health

# Expected response:
# {"status":"healthy"}
```

**Check API docs (if in development mode):**
- https://your-app.railway.app/docs

- [ ] Health check passing

---

### Step 6.6: Update Mobile App Configuration

Update your EAS secrets with the production API URL:

```bash
cd mobile

# Update API URL to Railway
eas secret:create --name EXPO_PUBLIC_API_URL --value "https://your-app.railway.app" --scope project --force
```

For a new production build:

```bash
eas build --platform ios --profile production
```

- [ ] Mobile app pointed to production backend

---

### Step 6.7: Configure Custom Domain (Optional)

1. In Railway, go to your service → **Settings**
2. Click **Generate Domain** or add a custom domain
3. Add CNAME record in your DNS provider
4. Update `ALLOWED_ORIGINS` to include new domain
5. Update mobile app `EXPO_PUBLIC_API_URL`

- [ ] Custom domain configured (optional)

---

## Full Testing Checklist Summary

### Authentication
- [ ] Email/password sign-up works
- [ ] Email/password sign-in works
- [ ] Google Sign-In works
- [ ] Apple Sign-In works
- [ ] Session persists after app restart
- [ ] Sign out works

### Share Extension
- [ ] Share Extension appears in iOS share sheet
- [ ] Sharing from TikTok works
- [ ] Sharing from Instagram works
- [ ] Sharing from Safari works
- [ ] Unauthenticated share queues properly
- [ ] Place detection finds locations

### Core Features
- [ ] Country grid displays correctly
- [ ] Can mark countries as visited
- [ ] Can add to wishlist
- [ ] Can create trips
- [ ] Can add entries to trips
- [ ] Photo upload works
- [ ] Profile settings accessible

### Backend
- [ ] API health check passing
- [ ] Authentication works end-to-end
- [ ] Data persists correctly
- [ ] Media upload works

---

## Troubleshooting

### Share Extension Not Appearing

1. **Rebuild the app** - Extensions are bundled at build time
2. **Check build logs** - Look for Share Extension target in EAS build output
3. **Verify App Groups** - Both app and extension must have same App Group

### Google Sign-In Fails

1. **Check redirect URL** - Must match Supabase configuration
2. **Verify scheme** - `atlasi://` must be registered in app.config.js
3. **Check Supabase logs** - Authentication → Logs for errors

### Share Extension Opens App But URL Missing

1. **Check App Group ID** - Must be `group.com.borderbadge.app`
2. **Verify deep link** - Should be `atlasi://share?url=...`
3. **Check console logs** - Deep link handling in App.tsx

### Railway Deployment Fails

1. **Check build logs** - Poetry install errors
2. **Verify Python version** - Must be 3.12+
3. **Check environment variables** - All required vars must be set

### "Untrusted Developer" on iOS

1. Go to **Settings** → **General** → **VPN & Device Management**
2. Find your developer certificate
3. Tap **Trust**

---

## Quick Reference Commands

```bash
# EAS Build Commands
eas build --platform ios --profile development  # Dev build with hot reload
eas build --platform ios --profile preview      # Internal testing build
eas build --platform ios --profile production   # App Store build

# Local Development
cd mobile && npx expo start --dev-client        # Start dev server

# Backend Local
cd backend && poetry run uvicorn app.main:app --reload --host 0.0.0.0

# Check EAS Secrets
eas secret:list

# View build status
eas build:list
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `mobile/eas.json` | EAS build profiles |
| `mobile/app.config.js` | Expo configuration, scheme, plugins |
| `mobile/plugins/withShareExtension.js` | Share Extension Expo plugin |
| `mobile/plugins/share-extension/` | Native Swift extension code |
| `backend/app/main.py` | FastAPI entry point |
| `backend/pyproject.toml` | Python dependencies |
| `docs/ios-share-extension.md` | Detailed Share Extension docs |
