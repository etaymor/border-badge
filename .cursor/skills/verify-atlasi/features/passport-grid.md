# Passport grid

The passport tab shows visited countries, stats, and stamp collage (or empty state for new users).

## Sub-features

- `passport-open` — tab opens without crash.
- `passport-empty` — new users may see "Your passport awaits its first stamp".
- `passport-stamps` — visited countries render stamp collage (requires seeded visits; no Detox spec yet).

## How to get to it (user POV)

- From main tabs, tap **Passport** (accessibility label `passport-tab`).

## Driving it with Detox

Preconditions:

- Doctor passes.
- Logged-in user past onboarding (manual: run auth + onboarding helpers, or use trips suite `beforeAll` pattern).

- **Open tab.** `element(by.label('passport-tab')).tap()`.
- **Observe.** Screen loads without redbox; empty collage text or country stamps visible depending on data.
- **Automated smoke (interim).** Run `bash .cursor/skills/verify-atlasi/scripts/drive.sh passport-grid` — currently runs app-launch smoke only; see `artifacts/<RUN_ID>/passport-grid-skip-note.txt`.
- **Proof.** Manual: Detox screenshot + visible passport content. Automated: launch smoke pass until a dedicated `e2e/flows/passport.e2e.ts` exists.

## Gotchas

- No dedicated Detox flow yet; do not report passport stamp logic as verified from smoke alone.
- Passport data comes from Supabase `user_countries`; empty state is valid proof for new accounts.
- Share affordance uses `accessibilityLabel="Share your passport"` on the header.
