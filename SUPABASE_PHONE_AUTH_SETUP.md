# Supabase Authentication Setup

This guide walks you through configuring Supabase for phone OTP authentication (with Twilio) and Apple Sign-In.

## Prerequisites

- A Supabase project
- A Twilio account (https://www.twilio.com/) for phone auth
- An Apple Developer account ($99/year) for Apple Sign-In
- Access to your Supabase project dashboard

---

# Part 1: Phone OTP Authentication (Twilio)

## Step 1: Set Up Twilio Account

### 1.1 Create a Twilio Account
1. Go to https://www.twilio.com/try-twilio
2. Sign up for a free account
3. Verify your phone number

### 1.2 Get Your Twilio Credentials
1. Go to the Twilio Console (https://console.twilio.com/)
2. Find your credentials on the dashboard:
   - **Account SID**: Starts with `AC...`
   - **Auth Token**: Click to reveal

### 1.3 Create a Messaging Service (Recommended)
1. Go to **Messaging** > **Services** in Twilio Console
2. Click **Create Messaging Service**
3. Name it something like "Border Badge OTP"
4. Select **Verify users** as the use case
5. Add a phone number or use the Twilio sender pool
6. Copy the **Messaging Service SID** (starts with `MG...`)

**Alternative**: You can use a single phone number instead of a messaging service:
1. Go to **Phone Numbers** > **Manage** > **Buy a Number**
2. Purchase a phone number with SMS capability
3. Use this number directly in Supabase configuration

## Step 2: Configure Supabase

### 2.1 Enable Phone Provider
1. Go to your Supabase Dashboard
2. Navigate to **Authentication** > **Providers**
3. Find **Phone** in the list and toggle it **ON**

### 2.2 Add Twilio Credentials
In the Phone provider settings, enter:

| Field | Value |
|-------|-------|
| **Twilio Account SID** | Your Account SID (starts with `AC...`) |
| **Twilio Auth Token** | Your Auth Token |
| **Twilio Message Service SID** | Your Messaging Service SID (starts with `MG...`) |

If using a phone number instead of messaging service:
| Field | Value |
|-------|-------|
| **Twilio Sender Phone Number** | Your Twilio phone number (e.g., `+15551234567`) |

### 2.3 Configure SMS Message Template
1. Go to **Authentication** > **Email Templates**
2. Find the SMS template section
3. Customize the message (optional):

```
Your Border Badge verification code is: {{ .Token }}
```

The `{{ .Token }}` placeholder will be replaced with the 6-digit OTP code.

### 2.4 Configure Rate Limiting (Recommended)
1. Go to **Authentication** > **Settings**
2. Configure the following settings:

| Setting | Recommended Value |
|---------|-------------------|
| **SMS rate limit** | 1 message per 60 seconds per phone |
| **OTP expiry** | 600 seconds (10 minutes) |
| **Max verification attempts** | 5 |

## Step 3: Set Up Test Phone Numbers (Development)

For development and testing without incurring SMS costs:

1. Go to **Authentication** > **Phone**
2. Scroll to **Test Phone Numbers**
3. Click **Add Phone Number**
4. Add test numbers:

| Phone Number | OTP Code |
|--------------|----------|
| `+15555550100` | `123456` |
| `+15555550101` | `123456` |

These numbers will bypass Twilio and always return the specified OTP code.

## Step 4: Run Database Migration

Apply the phone auth trigger migration:

```bash
# If using Supabase CLI
supabase db push

# Or manually run the migration in SQL Editor
```

The migration file is located at:
`supabase/migrations/0012_phone_auth_trigger.sql`

This updates the `handle_new_user()` trigger to properly handle phone-based signups.

## Step 5: Test the Integration

### Using Test Phone Numbers
1. Run your app in development mode
2. Enter a test phone number (e.g., `+15555550100`)
3. Enter the test OTP code (`123456`)
4. Verify the account is created successfully

### Using Real Phone Numbers
1. Enter your real phone number
2. You should receive an SMS within seconds
3. Enter the received OTP code
4. Verify the account is created successfully

## Troubleshooting

### Common Issues

**"Phone provider is not enabled"**
- Ensure the Phone provider is toggled ON in Supabase settings

**"Invalid phone number format"**
- Phone numbers must be in E.164 format: `+[country code][number]`
- Example: `+14155551234` (US), `+447911123456` (UK)

**"Rate limit exceeded"**
- Wait 60 seconds before requesting another code
- Check rate limiting settings in Supabase

**"SMS not received"**
- Check Twilio logs for delivery status
- Verify the phone number is correctly formatted
- Ensure Twilio account has sufficient balance
- Check if the number is blocked or on a carrier blacklist

**"Invalid verification code"**
- OTP codes expire after 10 minutes (default)
- Codes are case-sensitive (always 6 digits)
- Ensure you're using the most recently sent code

### Twilio Debugging

1. Go to Twilio Console > **Monitor** > **Logs** > **Messaging**
2. Filter by your phone number
3. Check delivery status and error codes

Common Twilio error codes:
- `30003`: Unreachable destination
- `30004`: Blocked by carrier
- `30005`: Unknown destination
- `30006`: Landline or unreachable carrier

## Cost Considerations

### Twilio Pricing (as of 2024)
- SMS to US/Canada: ~$0.0079 per message
- SMS to other countries: varies ($0.01 - $0.10+)
- Phone numbers: ~$1.15/month per number

### Tips to Reduce Costs
1. Use test phone numbers during development
2. Implement proper rate limiting
3. Consider shorter OTP expiry times
4. Monitor usage in Twilio dashboard

## Security Best Practices

1. **Never expose Twilio credentials** in client code
2. **Implement rate limiting** to prevent abuse
3. **Set reasonable OTP expiry** (5-10 minutes)
4. **Log authentication attempts** for security auditing
5. **Use messaging services** instead of single phone numbers for better deliverability

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

# Related Files

## Phone Auth
- `mobile/src/hooks/useAuth.ts` - Phone OTP hooks (useSendOTP, useVerifyOTP)
- `mobile/src/screens/auth/AuthScreen.tsx` - Combined auth UI (phone + Apple)
- `mobile/src/screens/onboarding/AccountCreationScreen.tsx` - Account creation flow
- `mobile/src/components/ui/PhoneInput.tsx` - Phone input component
- `mobile/src/components/ui/OTPInput.tsx` - OTP input component
- `supabase/migrations/0012_phone_auth_trigger.sql` - Database trigger for phone auth

## Apple Auth
- `mobile/src/hooks/useAppleAuth.ts` - Apple Sign-In hook
- `mobile/src/screens/auth/AuthScreen.tsx` - Combined auth UI (phone + Apple)
- `supabase/migrations/0019_apple_auth_support.sql` - Database trigger update for Apple auth
- `mobile/app.config.js` - Expo config with `usesAppleSignIn` capability
