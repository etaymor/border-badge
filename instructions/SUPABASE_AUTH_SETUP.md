# Supabase Authentication Setup

This guide walks you through configuring Supabase for:
- **Google OAuth** (recommended - free, works on iOS and Android)
- **Apple Sign-In** (required for iOS App Store if offering social login)
- **Magic Link Email** (passwordless email authentication)

> **Note:** Phone OTP authentication (Twilio) has been removed from the app. The instructions below focus on the current auth methods.

## Prerequisites

- A Supabase project
- A Google Cloud Console account (free) for Google OAuth
- An Apple Developer account ($99/year) for Apple Sign-In
- Access to your Supabase project dashboard

---

# Part 1: Google OAuth (Recommended)

Google OAuth is the recommended primary authentication method. It's free, works on both iOS and Android, and provides a familiar sign-in experience.

## Step 1: Create Google Cloud Project

### 1.1 Access Google Cloud Console
1. Go to https://console.cloud.google.com/
2. Sign in with your Google account
3. Click **Select a project** > **New Project**
4. Enter project name (e.g., "Atlasi" or "Border Badge")
5. Click **Create**

### 1.2 Enable Required APIs
1. Go to **APIs & Services** > **Library**
2. Search for and enable:
   - **Google+ API** (for user profile info)
   - **Google People API** (optional, for additional profile data)

## Step 2: Configure OAuth Consent Screen

1. Go to **APIs & Services** > **OAuth consent screen**
2. Select **External** user type (unless you have Google Workspace)
3. Click **Create**
4. Fill in the required fields:

| Field | Value |
|-------|-------|
| **App name** | Atlasi (or your app name) |
| **User support email** | Your email |
| **App logo** | Upload your app icon (optional) |
| **Developer contact email** | Your email |

5. Click **Save and Continue**
6. On **Scopes** page, click **Add or Remove Scopes**
7. Select these scopes:
   - `email`
   - `profile`
   - `openid`
8. Click **Save and Continue**
9. Add test users if in testing mode
10. Click **Save and Continue**, then **Back to Dashboard**

## Step 3: Create OAuth Client IDs

You need to create OAuth credentials for **Web** (used by Supabase).

### 3.1 Create Web Client (Required for Supabase)
1. Go to **APIs & Services** > **Credentials**
2. Click **+ Create Credentials** > **OAuth client ID**
3. Select **Web application**
4. Enter:
   - **Name**: `Atlasi Web Client` (or similar)
   - **Authorized JavaScript origins**: Add your Supabase URL
     ```
     https://YOUR_PROJECT_REF.supabase.co
     ```
   - **Authorized redirect URIs**: Add Supabase callback URL
     ```
     https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
     ```
5. Click **Create**
6. **Save the Client ID and Client Secret** - you'll need these for Supabase

> **Note:** Replace `YOUR_PROJECT_REF` with your actual Supabase project reference (found in your Supabase dashboard URL).

## Step 4: Configure Supabase

### 4.1 Enable Google Provider
1. Go to your Supabase Dashboard
2. Navigate to **Authentication** > **Providers**
3. Find **Google** in the list and toggle it **ON**

### 4.2 Add Google Credentials
In the Google provider settings, enter:

| Field | Value |
|-------|-------|
| **Client ID** | Your Web Client ID from Google Cloud |
| **Client Secret** | Your Client Secret from Google Cloud |

### 4.3 Copy the Callback URL
Supabase shows the callback URL in the provider settings. Ensure this matches what you configured in Google Cloud Console:
```
https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
```

### 4.4 Save Configuration
Click **Save** to apply the Google provider settings.

## Step 5: Test Google Sign-In

1. Run your app in development mode
2. Tap "Continue with Google"
3. A web browser should open with Google's sign-in page
4. Sign in with your Google account
5. You should be redirected back to the app
6. Verify the account appears in Supabase Auth > Users

## Troubleshooting Google OAuth

### Common Issues

**"redirect_uri_mismatch" error**
- The callback URL in Google Cloud must exactly match Supabase's callback URL
- Check for trailing slashes, http vs https
- Ensure you're using the Web client credentials (not iOS/Android)

**"Access blocked: This app's request is invalid"**
- OAuth consent screen may not be configured
- If in testing mode, ensure your email is added as a test user

**"Error 400: invalid_request"**
- Check that Client ID and Client Secret are correct in Supabase
- Verify the OAuth consent screen is published (or user is in test users)

**Browser doesn't redirect back to app**
- Verify deep link scheme is configured in app.config.js
- Check that `expo-linking` is properly set up
- On iOS simulator, ensure the dev client is installed (not Expo Go)

**"Sign-In Failed" alert in app**
- Check Supabase logs for detailed error
- Verify tokens are being extracted correctly from callback URL

### Google Cloud Console Tips

1. **Publishing status**: While in "Testing" mode, only test users can sign in. To allow any Google user:
   - Go to OAuth consent screen
   - Click **Publish App**
   - Note: If requesting sensitive scopes, you may need Google verification

2. **Quotas**: Google OAuth has generous free quotas. Monitor usage at:
   - APIs & Services > Dashboard

---

# Part 2: Apple Sign-In

## Step 1: Configure Apple Developer Portal

### 1.1 Create an App ID (if not already done)
1. Go to https://developer.apple.com/account/resources/identifiers/list
2. Click **+** to create a new identifier
3. Select **App IDs** and click **Continue**
4. Select **App** type and click **Continue**
5. Enter:
   - **Description**: Atlasi (or your app name)
   - **Bundle ID**: `com.borderbadge.app` (must match your app's bundle ID)
6. Scroll to **Capabilities** and check **Sign In with Apple**
7. Click **Continue**, then **Register**

### 1.2 Create a Services ID
1. Go to https://developer.apple.com/account/resources/identifiers/list
2. Click **+** to create a new identifier
3. Select **Services IDs** and click **Continue**
4. Enter:
   - **Description**: Atlasi Auth (or similar)
   - **Identifier**: `com.borderbadge.app.auth` (convention: bundle ID + `.auth`)
5. Click **Continue**, then **Register**
6. Click on your new Services ID to edit it
7. Check **Sign In with Apple** and click **Configure**
8. In the configuration:
   - **Primary App ID**: Select your App ID (`com.borderbadge.app`)
   - **Domains**: Add your Supabase domain (e.g., `xxxx.supabase.co`)
   - **Return URLs**: Add `https://xxxx.supabase.co/auth/v1/callback`
   - Replace `xxxx` with your Supabase project reference
9. Click **Save**, then **Continue**, then **Save**

### 1.3 Create a Sign-In Key
1. Go to https://developer.apple.com/account/resources/authkeys/list
2. Click **+** to create a new key
3. Enter:
   - **Key Name**: Atlasi Sign In Key
4. Check **Sign In with Apple** and click **Configure**
5. Select your **Primary App ID** (`com.borderbadge.app`)
6. Click **Save**, then **Continue**, then **Register**
7. **IMPORTANT**: Download the key file (`.p8`) - you can only download it once!
8. Note down:
   - **Key ID**: Displayed on the key details page (10-character string)
   - **Team ID**: Found in top-right of developer portal or in Membership details

## Step 2: Configure Supabase

### 2.1 Enable Apple Provider
1. Go to your Supabase Dashboard
2. Navigate to **Authentication** > **Providers**
3. Find **Apple** in the list and toggle it **ON**

### 2.2 Add Apple Credentials
In the Apple provider settings, enter:

| Field | Value |
|-------|-------|
| **Secret Key** | Contents of your `.p8` file (including `-----BEGIN/END PRIVATE KEY-----`) |
| **Services ID** | Your Services ID identifier (e.g., `com.borderbadge.app.auth`) |
| **Key ID** | Your Sign-In Key ID (10-character string) |
| **Team ID** | Your Apple Developer Team ID (10-character string) |

### 2.3 Save Configuration
1. Click **Save** to apply the Apple provider settings
2. The provider should now show as enabled

## Step 3: Run Database Migration

Apply the Apple auth trigger migration:

```bash
# If using Supabase CLI
supabase db push

# Or manually run the migration in SQL Editor
```

The migration file is located at:
`supabase/migrations/0019_apple_auth_support.sql`

This updates the `handle_new_user()` trigger to handle Apple Sign-In users, including:
- Extracting display name from Apple's `full_name` or `name` metadata
- Handling Apple private relay emails (`*@privaterelay.appleid.com`)
- Falling back to "User" if no name is provided

## Step 4: Build with EAS

Apple Sign-In requires native code, so you must create an EAS build:

```bash
cd mobile

# Development build
eas build --profile development --platform ios

# Or production build
eas build --profile production --platform ios
```

**Note**: Apple Sign-In will NOT work in Expo Go. You must use a development or production build.

## Step 5: Test the Integration

### Testing on iOS Simulator
1. Open your EAS development build on an iOS simulator
2. Tap "Sign in with Apple" on the auth screen
3. Follow the Apple Sign-In flow
4. Verify the account is created in Supabase

### Testing on Physical Device
1. Install the build on your iOS device
2. Tap "Sign in with Apple"
3. Use Face ID/Touch ID or password to authenticate
4. Verify the account appears in your Supabase Auth users

## Troubleshooting

### Common Apple Sign-In Issues

**"Invalid client" error**
- Verify Services ID matches exactly in Supabase
- Check that return URL is correctly configured in Apple Developer Portal
- Ensure the domain matches your Supabase project URL

**"Apple Sign In not available"**
- Apple Sign-In is only available on iOS devices
- The app checks `Platform.OS === 'ios'` before showing the button
- Won't work in Expo Go - must use EAS build

**User cancelled sign-in**
- This is normal - the app silently handles cancellation
- No error is shown to the user

**No display name captured**
- Apple only provides the user's name on FIRST sign-in
- If testing repeatedly, the name won't be provided after the first time
- To reset: Settings > Apple ID > Password & Security > Apps Using Apple ID > Remove app

**"Nonce mismatch" error**
- Ensure you're generating a fresh nonce for each sign-in attempt
- Check that raw nonce is sent to Supabase, hashed nonce to Apple

### Apple Developer Portal Issues

**Services ID not showing in Supabase dropdown**
- Make sure "Sign In with Apple" is enabled on the Services ID
- Ensure the Services ID is associated with your App ID

**Key download failed**
- The `.p8` key can only be downloaded once
- If lost, you must create a new key

---

# Part 3: Magic Link Email Authentication

Magic link authentication sends a one-time login link to the user's email - no password required. Users click the link in their email and are automatically signed in.

## Step 1: Enable Email Provider in Supabase

### 1.1 Access Email Provider Settings
1. Go to your Supabase Dashboard
2. Navigate to **Authentication** > **Providers**
3. Find **Email** in the list and click to expand

### 1.2 Configure Email Provider
Enable these settings:

| Setting | Value | Description |
|---------|-------|-------------|
| **Enable Email provider** | ON | Must be enabled for magic links |
| **Confirm email** | ON | Requires email verification (recommended) |
| **Secure email change** | ON | Requires verification for email changes |
| **Enable sign ups** | ON | Allow new users to register |

### 1.3 About Password vs Passwordless

There's no explicit "disable password" toggle in Supabase. Password vs magic link is determined by **how your app calls the API**:

| API Call | Result |
|----------|--------|
| `signInWithOtp({ email })` | Sends magic link (passwordless) ✅ |
| `signUp({ email, password })` | Creates account with password |

Since our app only uses `signInWithOtp()`, users will always authenticate via magic links. They never set a password, and each login sends a new magic link to their email.

> **Note:** If you wanted to enforce passwordless-only at the database level, you'd need a custom hook or edge function to reject password-based signups. For most apps, client-side enforcement is sufficient.

## Step 2: Configure Email Templates

### 2.1 Magic Link Email Template
1. Go to your Supabase Dashboard
2. Navigate to **Authentication** > **Email Templates**
3. Select **Magic Link** from the template list
4. Customize the template (optional):

```html
<h2>Login to Atlasi</h2>
<p>Click the link below to sign in to your account:</p>
<p><a href="{{ .ConfirmationURL }}">Sign in to Atlasi</a></p>
<p>This link will expire in 24 hours.</p>
<p>If you didn't request this email, you can safely ignore it.</p>
```

**Available template variables:**
- `{{ .ConfirmationURL }}` - The magic link URL
- `{{ .Email }}` - User's email address
- `{{ .SiteURL }}` - Your configured site URL

## Step 3: Configure Redirect URLs

This is **critical** for mobile apps - it tells Supabase where to redirect after authentication.

### 3.1 Set Site URL
1. Go to **Authentication** > **URL Configuration**
2. Set the **Site URL** to your app's deep link scheme:
   ```
   atlasi://auth-callback
   ```

### 3.2 Add Redirect URLs
In the **Redirect URLs** section, add:
```
atlasi://auth-callback
```

> **Important:** The redirect URL must exactly match what your app expects. The `atlasi://` scheme is defined in `mobile/app.config.js`.

### 3.3 For Development with Expo Go
When testing with Expo Go, custom URL schemes like `atlasi://` don't work. Instead, Expo Go uses `exp://` URLs. Add these redirect URLs for development:

```
exp://YOUR_IP:8081/--/auth-callback
exp://127.0.0.1:8081/--/auth-callback
```

Replace `YOUR_IP` with your machine's local IP address (run `ipconfig getifaddr en0` on macOS).

For web testing:
```
http://localhost:3000/auth/callback
```

> **Note:** Custom URL schemes (`atlasi://`) only work in development builds (`npx expo run:ios`) or production builds, not in Expo Go.

## Step 4: SMTP Configuration (Production)

Supabase's default email service has strict rate limits. For production, configure a custom SMTP server:

### 4.1 Why Custom SMTP?
- **Better deliverability** - Emails less likely to hit spam
- **Higher rate limits** - Supabase default is very limited
- **Custom sender** - Use your own domain (e.g., `noreply@atlasi.app`)
- **Email tracking** - Monitor delivery and opens

### 4.2 Configure SMTP in Supabase
1. Go to **Project Settings** > **Auth**
2. Scroll to **SMTP Settings**
3. Toggle **Enable Custom SMTP**
4. Enter your SMTP credentials:

| Field | Example Value |
|-------|---------------|
| **Sender email** | `noreply@atlasi.app` |
| **Sender name** | `Atlasi` |
| **Host** | `smtp.sendgrid.net` (or your provider) |
| **Port** | `587` |
| **Username** | Your SMTP username |
| **Password** | Your SMTP password/API key |

### 4.3 Recommended SMTP Providers

| Provider | Free Tier | Best For |
|----------|-----------|----------|
| **Resend** | 3,000 emails/month | Developer-friendly, modern API |
| **SendGrid** | 100 emails/day | Established, good docs |
| **Postmark** | 100 emails/month | Best deliverability |
| **AWS SES** | 62,000/month (with EC2) | Scale & cost |

## Step 5: Configure Rate Limits

1. Go to **Authentication** > **Rate Limits**
2. Configure these settings:

| Setting | Recommended Value | Description |
|---------|-------------------|-------------|
| **Rate limit for sending emails** | 2 per hour | Prevents spam |
| **Magic link/OTP expiry** | 3600 (1 hour) | How long links are valid |

## Step 6: Configure Session Duration

Session duration controls how long users stay logged in. Configure this for long-lasting sessions:

### 6.1 Access JWT Settings
1. Go to **Project Settings** > **Auth** (or **Authentication** > **Settings**)
2. Scroll to **JWT Settings**

### 6.2 Configure Token Expiry

| Setting | Recommended Value | Description |
|---------|-------------------|-------------|
| **JWT expiry limit** | `604800` (7 days) | How long access tokens are valid |

> **Maximum values by plan:**
> - Free/Pro: 604,800 seconds (7 days)
> - Team/Enterprise: Up to 2,592,000 seconds (30 days)

### 6.3 How Sessions Work

The app uses two tokens:

| Token | Purpose | Lifetime |
|-------|---------|----------|
| **Access Token** | Authenticates API requests | Configured above (e.g., 7 days) |
| **Refresh Token** | Gets new access tokens | ~8 days (slightly longer than access) |

**How it stays logged in:**
1. User logs in → receives access + refresh tokens
2. App stores both in SecureStore (encrypted on device)
3. When access token expires, Supabase JS auto-refreshes using refresh token
4. User stays logged in as long as they open the app within the refresh window

**Our client config (supabase.ts):**
```typescript
auth: {
  storage: ExpoSecureStoreAdapter,  // Secure storage
  autoRefreshToken: true,           // Auto-refresh before expiry
  persistSession: true,             // Survive app restarts
}
```

### 6.4 Maximizing Session Duration

For the longest possible sessions:

1. **Set JWT expiry to maximum** (604800 for Pro plan)
2. **Keep `autoRefreshToken: true`** in client (already set)
3. **Keep `persistSession: true`** in client (already set)

With these settings, users stay logged in indefinitely as long as they open the app at least once per week.

## Step 7: Test Magic Link Flow

1. Run your app in development mode
2. Enter an email address and tap "Continue"
3. Check your email for the magic link
4. Click the link - it should open your app
5. Verify you're logged in and user appears in Supabase Auth > Users

## Troubleshooting Magic Links

**Email not received**
- Check spam/junk folder
- Verify email address is correct
- Check Supabase Dashboard > Logs > Auth for errors
- If using default SMTP, you may have hit rate limits
- Try custom SMTP for better deliverability

**Link expired**
- Default expiry is 1 hour (configurable)
- Request a new magic link

**"Invalid or expired link" error**
- Magic links are **single-use** - can't click twice
- Link may have expired
- Deep link scheme may not match (`atlasi://` vs `exp://`)

**Link doesn't open the app**
- Verify `scheme: 'atlasi'` in `app.config.js`
- On iOS: May need to rebuild the app after scheme changes
- On Android: Check intent filters are configured
- In Expo Go: Custom URL schemes don't work - add `exp://` URLs to Supabase redirect URLs, or use a dev build

**"Email provider is not enabled" error**
- Go to Authentication > Providers > Email and ensure it's ON
- Check "Enable sign ups" is also enabled

**Rate limit exceeded**
- Wait before requesting another link
- Check rate limit settings in Supabase
- Consider increasing limits or using custom SMTP

**User created but no session**
- Check that redirect URL matches exactly
- Verify `authCallback.ts` is processing the deep link
- Check console logs for token extraction errors

---

# Related Files

## Google Auth
- `mobile/src/hooks/useGoogleAuth.ts` - Google OAuth hook using expo-web-browser
- `mobile/src/screens/auth/AuthScreen.tsx` - Auth UI with Google button
- `mobile/src/utils/authHelpers.ts` - Shared token extraction utilities

## Apple Auth
- `mobile/src/hooks/useAppleAuth.ts` - Apple Sign-In hook
- `mobile/src/screens/auth/AuthScreen.tsx` - Auth UI with Apple button
- `supabase/migrations/0019_apple_auth_support.sql` - Database trigger for Apple auth
- `mobile/app.config.js` - Expo config with `usesAppleSignIn` capability

## Magic Link Auth
- `mobile/src/hooks/useMagicLinkAuth.ts` - Magic link email hook
- `mobile/src/services/authCallback.ts` - Deep link callback processing
- `mobile/src/screens/auth/AuthScreen.tsx` - Auth UI with email input

## Shared Auth
- `mobile/src/utils/authHelpers.ts` - Token extraction, onboarding check
- `mobile/src/utils/authErrors.ts` - Error handling utilities
- `mobile/src/stores/authStore.ts` - Zustand auth state
- `mobile/App.tsx` - Deep link handling setup
