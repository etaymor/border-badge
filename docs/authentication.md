# Authentication System

The app uses **email/password authentication** for all users via Supabase Auth. **Magic links are NOT supported — do not add magic link functionality.**

## Authentication Screens

| Screen                    | File                                           | Purpose                                                                                                                                                                               |
| ------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AccountCreationScreen** | `screens/onboarding/AccountCreationScreen.tsx` | **New user sign-up** during onboarding. Collects email + password (password appears after valid email). Uses `useSignUpWithPassword` hook. Also supports Apple/Google social sign-in. |
| **AuthScreen**            | `screens/auth/AuthScreen.tsx`                  | **Returning user sign-in**. Collects email + password (password appears after valid email). Uses `useSignInWithPassword` hook. Also supports Apple/Google social sign-in.             |

## Authentication Flow

### New Users (Onboarding)

1. Complete onboarding steps (WelcomeCarousel through ProgressSummary) → NameEntry → `AccountCreationScreen`
2. Enter email → password field appears when email is valid
3. Submit → `useSignUpWithPassword` creates account, sets `needsPostSignupFlow` flag
4. Navigate to EmotionalHook → FunctionalHook → Paywall (post-signup flow)
5. PaywallScreen calls `finishOnboarding()` to complete the flow

See `docs/ONBOARDING_PAYWALL_FIX.md` for full design rationale.

### Returning Users

1. Launch app → `AuthScreen`
2. Enter email → password field appears when email is valid
3. Submit → `useSignInWithPassword` authenticates

## Auth Hooks (`mobile/src/hooks/useAuth.ts`)

| Hook                    | Purpose                                           |
| ----------------------- | ------------------------------------------------- |
| `useSignUpWithPassword` | Create new account (email, password, displayName) |
| `useSignInWithPassword` | Sign in existing account (email, password)        |
| `useSignOut`            | Sign out and clear session                        |

## Key Implementation Details

- Password field only appears after entering a valid email (progressive disclosure)
- Minimum password length: 6 characters (Supabase default)
- Email validation uses RFC 5322 compliant regex
- Social auth (Apple, Google) available as alternatives
- **Magic links are NOT implemented** — do not add magic link functionality

## Onboarding Flow Order

Account creation happens **before** the paywall. The `needsPostSignupFlow` flag in `authStore` keeps users in `OnboardingNavigator` after authentication until the paywall is complete. See `docs/ONBOARDING_PAYWALL_FIX.md` for the full design rationale.
