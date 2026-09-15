# Auth signup

A new user signs up with email and password from the welcome screen and reaches onboarding or main tabs.

## Sub-features

- `signup-happy-path` — valid email + password submits successfully.
- `signup-validation` — weak or mismatched passwords show inline errors (see `e2e/flows/auth.e2e.ts`).

## How to get to it (user POV)

- Open app logged out → tap **Get started** (`welcome-get-started-button`).
- Fill email, password, confirm → tap submit (`signup-submit-button`).

## Driving it with Detox

Preconditions:

- Doctor passes.
- Fresh app state: `clearAppState()` in the auth suite (handled by test `beforeAll`).

- **Open signup.** Tap `welcome-get-started-button`.
- **Fill form.** Type unique email via `testData.uniqueEmail()` and `testData.testPassword` into `signup-email-input`, `signup-password-input`, `signup-confirm-password-input`.
- **Submit.** Tap `signup-submit-button`.
- **Observe.** Within 15s, `start-journey-button` (onboarding) or `trips-tab` (already onboarded) appears.
- **Drive.** Run `bash .cursor/skills/verify-atlasi/scripts/drive.sh auth-signup`.
- **Proof.** Passing `creates a new account successfully` in `drive.log`; Supabase row is a side effect (not asserted in UI test).

## Gotchas

- Email verification is disabled in dev Supabase; do not wait for a confirmation screen.
- Reusing a fixed email fails; tests use unique `test.e2e.*@example.com` addresses.
- Post-signup paywall/onboarding order may change; `waitForEither` covers both onboarding and tabs entry.
