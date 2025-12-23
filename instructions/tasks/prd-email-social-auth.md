# PRD: Replace Phone Authentication with Email + Social Login

## Introduction/Overview

This document outlines the replacement of phone OTP authentication with email magic link authentication, plus the addition of Google Sign-In as a social login option. Apple Sign-In (iOS only) is already implemented and will be preserved.

**Problem:** Phone OTP authentication has limitations including:
- SMS delivery can be unreliable and costly
- Phone numbers change more frequently than email addresses
- Limited international support
- Poor user experience with multi-step verification

**Solution:** Replace with email magic links (passwordless) as the primary method, with Google and Apple social logins as convenient alternatives.

## Goals

1. **Replace phone OTP with email magic links** - Simpler, more reliable authentication
2. **Add Google Sign-In** - Cross-platform social login (iOS + Android)
3. **Preserve Apple Sign-In** - Already implemented, iOS only
4. **Remove all phone-related code** - Clean up codebase, remove unused dependencies
5. **Maintain test coverage** - Update existing tests, add new ones for new functionality
6. **Zero data loss** - Existing user migration and onboarding flows preserved

## User Stories

1. **As a new user**, I want to sign up with my email address so that I can create an account without needing a phone number.

2. **As a returning user**, I want to sign in with my email by clicking a magic link so that I don't need to remember a password or enter codes.

3. **As an iOS user**, I want to sign in with Apple so that I can authenticate quickly using Face ID/Touch ID.

4. **As any user**, I want to sign in with Google so that I can authenticate with my existing Google account.

5. **As a user**, I want to see my email address on my profile instead of a phone number.

## Functional Requirements

### FR-1: Email Magic Link Authentication
1.1. Users must be able to enter their email address to initiate authentication
1.2. System must send a magic link to the provided email address via Supabase
1.3. System must show a "Check your email" confirmation screen after sending the link
1.4. Users must be able to request a new magic link if needed
1.5. Clicking the magic link must authenticate the user and redirect to the app
1.6. Email validation must occur before sending the magic link

### FR-2: Google Sign-In
2.1. Google Sign-In button must be displayed on login and registration screens
2.2. Google Sign-In must work on both iOS and Android platforms
2.3. System must use Supabase OAuth with `expo-auth-session` for the OAuth flow
2.4. Google authentication must follow the same migration logic as Apple Sign-In

### FR-3: Apple Sign-In (Existing)
3.1. Apple Sign-In must continue to work as currently implemented
3.2. Apple Sign-In button must only be shown on iOS devices

### FR-4: UI Layout
4.1. Email input must be displayed prominently at the top of auth screens
4.2. Social login buttons (Google, Apple) must appear below email input with an "or" divider
4.3. Google Sign-In button must use appropriate branding

### FR-5: Profile Updates
5.1. Profile settings screen must display user's email instead of phone number
5.2. Label must change from "Phone" to "Email"

### FR-6: Code Cleanup
6.1. All phone OTP related code must be removed
6.2. `libphonenumber-js` dependency must be removed
6.3. Phone validation utilities must be deleted
6.4. OnboardingPhoneInput component must be deleted
6.5. All phone-related test files must be deleted or updated

## Non-Goals (Out of Scope)

1. **Password authentication** - Using magic links only, no password storage
2. **Email change functionality** - Users cannot change their email (future feature)
3. **Multiple auth methods per account** - Account linking not in scope
4. **Facebook/other social logins** - Only Google and Apple for now
5. **Two-factor authentication** - Not required for this iteration

## Design Considerations

### UI Flow - Login Screen
```
+----------------------------------+
|  Welcome back                    |
|  ~ let's pick up where you left ~|
|                                  |
|  [Email input field         ]   |
|                                  |
|  [    Continue Button       ]   |
|                                  |
|  ─────────── or ───────────     |
|                                  |
|  [G  Continue with Google   ]   |
|  [   Sign in with Apple    ]   | (iOS only)
+----------------------------------+
```

### UI Flow - "Check Your Email" Screen
```
+----------------------------------+
|  <- Use different email          |
|                                  |
|         [Mail Icon]              |
|                                  |
|  Check your email                |
|  We sent a magic link to         |
|  user@example.com                |
|                                  |
|  Click the link in the email     |
|  to sign in.                     |
|                                  |
|  [   Resend email   ]           |
+----------------------------------+
```

## Technical Considerations

### Dependencies
- **Add:** `expo-auth-session`, `expo-web-browser` (for Google OAuth)
- **Remove:** `libphonenumber-js`

### Deep Link Configuration
- App scheme: `atlasi://`
- Auth callback path: `auth-callback`
- Magic links will redirect to: `atlasi://auth-callback`

### Supabase Configuration Required
1. Enable Email provider in Supabase Dashboard
2. Configure Google OAuth provider with client credentials
3. Add `atlasi://auth-callback` to allowed redirect URLs

### Migration Logic
- Existing `migrateGuestData()` function will continue to work
- New users get their onboarding data migrated after first authentication
- Returning users are detected by checking `user_countries` table

## Success Metrics

1. **Successful authentication rate** - >= 95% of magic link/OAuth attempts succeed
2. **Test coverage maintained** - All updated files have corresponding test coverage
3. **No regression** - Existing Apple Sign-In continues to work
4. **Code reduction** - Net reduction in codebase size after phone code removal

## Open Questions

1. **Email template customization** - Should we customize Supabase's default magic link email template?
2. **Deep link handling on first install** - How should we handle magic links when app isn't installed?
3. **Rate limiting** - Should we implement client-side rate limiting for magic link requests?

---

## Implementation Reference

See the detailed implementation plan at: `/Users/emerson/.claude/plans/curried-knitting-river.md`
