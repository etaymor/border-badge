# Tasks: Replace Phone Authentication with Email + Social Login

## Relevant Files

### New Files to Create
- `mobile/src/utils/emailValidation.ts` - Email validation utility function
- `mobile/src/utils/__tests__/emailValidation.test.ts` - Unit tests for email validation
- `mobile/src/hooks/useGoogleAuth.ts` - Google Sign-In hook using expo-auth-session
- `mobile/src/__tests__/hooks/useGoogleAuth.test.tsx` - Unit tests for Google auth hook
- `mobile/src/__tests__/integration/EmailAuthFlow.test.tsx` - Integration tests for email magic link flow

### Files to Modify
- `mobile/package.json` - Add expo-auth-session, expo-web-browser; remove libphonenumber-js
- `mobile/src/hooks/useAuth.ts` - Replace phone OTP hooks with email magic link hook
- `mobile/src/hooks/index.ts` - Update exports for new auth hooks
- `mobile/src/screens/auth/AuthScreen.tsx` - Replace phone input with email input, add Google button
- `mobile/src/screens/onboarding/AccountCreationScreen.tsx` - Same changes as AuthScreen
- `mobile/src/screens/profile/ProfileSettingsScreen.tsx` - Display email instead of phone
- `mobile/src/screens/profile/components/ProfileInfoSection.tsx` - Change label from Phone to Email
- `mobile/src/components/onboarding/index.ts` - Remove OnboardingPhoneInput export
- `mobile/src/components/ui/index.ts` - Remove OTPInput and ResendTimer exports if unused
- `mobile/src/__tests__/hooks/useAuth.test.tsx` - Update tests for email magic link
- `mobile/src/__tests__/screens/ProfileSettingsScreen.test.tsx` - Update for email display

### Files to Delete
- `mobile/src/utils/phoneValidation.ts` - Phone validation utilities no longer needed
- `mobile/src/constants/countryDialCodes.ts` - Country dial codes no longer needed
- `mobile/src/components/onboarding/OnboardingPhoneInput.tsx` - Phone input component no longer needed
- `mobile/src/components/ui/OTPInput.tsx` - OTP input no longer needed (review first)
- `mobile/src/components/ui/ResendTimer.tsx` - May keep for magic link resend or delete
- `mobile/src/__tests__/components/PhoneInput.test.tsx` - Phone input tests
- `mobile/src/__tests__/components/OnboardingPhoneInput.test.tsx` - Onboarding phone input tests
- `mobile/src/__tests__/screens/PhoneAuthChangeNumber.test.tsx` - Phone auth change number tests
- `mobile/src/__tests__/integration/PhoneAuthFlow.test.tsx` - Phone auth flow integration tests

### Notes

- Unit tests should typically be placed alongside the code files they are testing or in `__tests__` directories.
- Use `npm test` or `npx jest [optional/path/to/test/file]` to run tests.
- Supabase configuration (Email provider, Google OAuth) must be done manually in the Supabase Dashboard.
- Deep link scheme `atlasi://auth-callback` must be configured for magic link and OAuth callbacks.

---

## Tasks

- [x] 1.0 Infrastructure Setup - Add dependencies and create email validation utility
  - [x] 1.1 Add `expo-auth-session` and `expo-web-browser` packages to `mobile/package.json`
  - [x] 1.2 Remove `libphonenumber-js` package from `mobile/package.json`
  - [x] 1.3 Run `npm install` to update dependencies
  - [x] 1.4 Create `mobile/src/utils/emailValidation.ts` with `validateEmail()` function that validates email format and returns `{ isValid: boolean, error?: string }`
  - [x] 1.5 Create `mobile/src/utils/__tests__/emailValidation.test.ts` with tests for valid emails, invalid emails, empty input, and whitespace handling

- [x] 2.0 Implement Email Magic Link Authentication - Update auth hooks to replace phone OTP with email magic links
  - [x] 2.1 In `mobile/src/hooks/useAuth.ts`, create new `SendMagicLinkInput` interface with `email` and optional `displayName` fields
  - [x] 2.2 In `mobile/src/hooks/useAuth.ts`, create `useSendMagicLink()` hook that calls `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } })`
  - [x] 2.3 In `mobile/src/hooks/useAuth.ts`, remove `SendOTPInput` interface
  - [x] 2.4 In `mobile/src/hooks/useAuth.ts`, remove `useSendOTP()` hook
  - [x] 2.5 In `mobile/src/hooks/useAuth.ts`, remove `VerifyOTPInput` interface and `useVerifyOTP()` hook (magic link handles verification automatically)
  - [x] 2.6 Keep `useSignOut()` hook unchanged
  - [x] 2.7 Update `mobile/src/hooks/index.ts` to export `useSendMagicLink` instead of `useSendOTP` and `useVerifyOTP`

- [x] 3.0 Implement Google Sign-In - Create new Google OAuth hook following Apple auth pattern
  - [x] 3.1 Create `mobile/src/hooks/useGoogleAuth.ts` file
  - [x] 3.2 Implement `useGoogleSignIn()` hook using `supabase.auth.signInWithOAuth({ provider: 'google' })` and `expo-web-browser` for OAuth flow
  - [x] 3.3 In `useGoogleSignIn()`, implement token extraction from OAuth callback URL
  - [x] 3.4 In `useGoogleSignIn()`, implement returning user detection (check `user_countries` table) following `useAppleAuth.ts` pattern
  - [x] 3.5 In `useGoogleSignIn()`, implement migration logic for new users using `migrateGuestData()`
  - [x] 3.6 In `useGoogleSignIn()`, implement error handling with graceful cancellation handling
  - [x] 3.7 Implement `useGoogleAuthAvailable()` hook that returns `true` (works on all platforms)
  - [x] 3.8 Update `mobile/src/hooks/index.ts` to export `useGoogleSignIn` and `useGoogleAuthAvailable`

- [x] 4.0 Update Authentication Screens - Modify AuthScreen and AccountCreationScreen for email + social login UI
  - [x] 4.1 In `mobile/src/screens/auth/AuthScreen.tsx`, remove imports for `OnboardingPhoneInput`, `OTPInput`, phone validation utilities
  - [x] 4.2 In `mobile/src/screens/auth/AuthScreen.tsx`, add imports for `useSendMagicLink`, `validateEmail`, `useGoogleSignIn`, `useGoogleAuthAvailable`
  - [x] 4.3 In `mobile/src/screens/auth/AuthScreen.tsx`, change `AuthStep` type from `'phone' | 'otp'` to `'email' | 'check_email'`
  - [x] 4.4 In `mobile/src/screens/auth/AuthScreen.tsx`, replace phone state with email state, remove OTP state
  - [x] 4.5 In `mobile/src/screens/auth/AuthScreen.tsx`, replace phone input with email text input using `OnboardingInput` component
  - [x] 4.6 In `mobile/src/screens/auth/AuthScreen.tsx`, implement "Check your email" confirmation step with mail icon and resend button
  - [x] 4.7 In `mobile/src/screens/auth/AuthScreen.tsx`, add Google Sign-In button below email input with "or" divider
  - [x] 4.8 In `mobile/src/screens/auth/AuthScreen.tsx`, keep Apple Sign-In button (iOS only) below Google button
  - [x] 4.9 In `mobile/src/screens/onboarding/AccountCreationScreen.tsx`, apply same changes as AuthScreen (email input, check email step, Google button, Apple button)
  - [x] 4.10 In `mobile/src/screens/onboarding/AccountCreationScreen.tsx`, ensure migration callback logic is preserved via `onAuthStateChange`

- [x] 5.0 Update Profile Screen - Change phone display to email display
  - [x] 5.1 In `mobile/src/screens/profile/ProfileSettingsScreen.tsx`, remove import of `formatPhoneForDisplay` from `@utils/phoneValidation`
  - [x] 5.2 In `mobile/src/screens/profile/ProfileSettingsScreen.tsx`, change `formattedPhone` variable to `formattedEmail` using `session?.user.email || 'Not set'`
  - [x] 5.3 In `mobile/src/screens/profile/ProfileSettingsScreen.tsx`, update `ProfileInfoSection` prop from `formattedPhone` to `formattedEmail`
  - [x] 5.4 In `mobile/src/screens/profile/components/ProfileInfoSection.tsx`, rename prop `formattedPhone` to `formattedEmail` in interface
  - [x] 5.5 In `mobile/src/screens/profile/components/ProfileInfoSection.tsx`, change label text from "Phone" to "Email"

- [x] 6.0 Remove Phone Authentication Code - Delete all phone-related files and dependencies
  - [x] 6.1 Delete `mobile/src/utils/phoneValidation.ts`
  - [x] 6.2 Delete `mobile/src/constants/countryDialCodes.ts`
  - [x] 6.3 Delete `mobile/src/components/onboarding/OnboardingPhoneInput.tsx`
  - [x] 6.4 Update `mobile/src/components/onboarding/index.ts` to remove `OnboardingPhoneInput` export
  - [x] 6.5 Review and delete `mobile/src/components/ui/OTPInput.tsx` if not used elsewhere
  - [x] 6.6 Review `mobile/src/components/ui/ResendTimer.tsx` - keep if used for magic link resend, otherwise delete
  - [x] 6.7 Update `mobile/src/components/ui/index.ts` to remove deleted component exports
  - [x] 6.8 Delete `mobile/src/__tests__/components/PhoneInput.test.tsx`
  - [x] 6.9 Delete `mobile/src/__tests__/components/OnboardingPhoneInput.test.tsx`
  - [x] 6.10 Delete `mobile/src/__tests__/screens/PhoneAuthChangeNumber.test.tsx`
  - [x] 6.11 Delete `mobile/src/__tests__/integration/PhoneAuthFlow.test.tsx`
  - [x] 6.12 Run `npm install` to ensure clean dependency tree after removing libphonenumber-js

- [ ] 7.0 Update Test Coverage - Update existing tests and create new tests for email/Google auth
  - [x] 7.1 Update `mobile/src/__tests__/hooks/useAuth.test.tsx` - replace `useSendOTP` tests with `useSendMagicLink` tests
  - [x] 7.2 Update `mobile/src/__tests__/hooks/useAuth.test.tsx` - remove all `useVerifyOTP` tests
  - [x] 7.3 Update `mobile/src/__tests__/hooks/useAuth.test.tsx` - keep `useSignOut` tests unchanged
  - [ ] 7.4 Create `mobile/src/__tests__/hooks/useGoogleAuth.test.tsx` with tests for OAuth flow initiation
  - [ ] 7.5 In `useGoogleAuth.test.tsx`, add tests for successful OAuth callback handling
  - [ ] 7.6 In `useGoogleAuth.test.tsx`, add tests for user cancellation handling
  - [ ] 7.7 In `useGoogleAuth.test.tsx`, add tests for OAuth error handling
  - [ ] 7.8 In `useGoogleAuth.test.tsx`, add tests for token storage on success
  - [ ] 7.9 In `useGoogleAuth.test.tsx`, add tests for migration logic (new vs returning users)
  - [x] 7.10 Update `mobile/src/__tests__/screens/ProfileSettingsScreen.test.tsx` - change mock session from `user.phone` to `user.email`
  - [x] 7.11 Update `mobile/src/__tests__/screens/ProfileSettingsScreen.test.tsx` - update text assertions from "Phone" to "Email"
  - [ ] 7.12 Create `mobile/src/__tests__/integration/EmailAuthFlow.test.tsx` with tests for email magic link flow
  - [ ] 7.13 Run full test suite with `npm test` and fix any failures
  - [ ] 7.14 Run linter with `npm run lint` and fix any issues
  - [ ] 7.15 Run TypeScript check with `npx tsc --noEmit` and fix any type errors
