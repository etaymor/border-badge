# Tab navigation

The app shows a coherent shell: either welcome (logged out) or bottom tabs (logged in). This is the navigation smoke check before deeper tab-specific flows.

## Sub-features

- `nav-logged-out` — welcome entry visible.
- `nav-logged-in` — `trips-tab` (or other tab labels) reachable.

## How to get to it (user POV)

- Logged out: launch app → welcome screen.
- Logged in: launch app → tap **Trips**, **Passport**, **Dreams**, **Friends**, or **Profile** in the tab bar.

## Driving it with Detox

Preconditions:

- Doctor passes.

- **Launch and assert shell.** Run `bash .cursor/skills/verify-atlasi/scripts/drive.sh tab-navigation`. Test `should show welcome or logged in state` passes `waitForEither(welcome-get-started-button, trips-tab)`.
- **Manual tab hops (logged-in sessions).** From main tabs, tap `by.label('passport-tab')`, `by.label('trips-tab')`, etc. (`navigateToTab()` in `e2e/init.ts`).
- **Proof.** `drive.log` pass line; for manual hops, Detox `expect(...).toBeVisible()` on screen-specific elements.

## Gotchas

- React Navigation 7 tab buttons use `tabBarAccessibilityLabel`, not `testID` — always use `by.label('*-tab')`.
- Double-tap tab-to-root behavior exists in production; single tap is enough for verification.
