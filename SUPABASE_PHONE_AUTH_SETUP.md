# Supabase Phone OTP Authentication Setup

This guide walks you through configuring Supabase for phone OTP authentication with Twilio.

## Prerequisites

- A Supabase project
- A Twilio account (https://www.twilio.com/)
- Access to your Supabase project dashboard

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

## Related Files

- `mobile/src/hooks/useAuth.ts` - Phone OTP hooks (useSendOTP, useVerifyOTP)
- `mobile/src/screens/auth/PhoneAuthScreen.tsx` - Phone auth UI
- `mobile/src/screens/onboarding/AccountCreationScreen.tsx` - Account creation flow
- `mobile/src/components/ui/PhoneInput.tsx` - Phone input component
- `mobile/src/components/ui/OTPInput.tsx` - OTP input component
- `supabase/migrations/0012_phone_auth_trigger.sql` - Database trigger update
