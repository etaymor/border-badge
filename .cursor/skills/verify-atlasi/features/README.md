# Atlasi verification map

Maintained source for verifying Border Badge (Atlasi) on the **iOS simulator** via **Detox**. Read this index before driving the app; use the matching feature file as the recipe.

Secondary surface: **FastAPI backend** at `EXPO_PUBLIC_API_URL` (health at `/health`). The mobile app talks to Supabase and this API; most user flows need both backend and Metro running.

## Baseline preconditions

- macOS with Xcode and a simulator whose name matches `mobile/.detoxrc.js` (`iPhone 15` by default; use an installed device or update the config).
- `mobile/.env` or `mobile/.env.local` with `EXPO_PUBLIC_API_URL` set to your **LAN IP**, not `localhost` (see `docs/environment-setup.md`).
- `backend/.env` with Supabase credentials.
- `cd mobile && npm install` and `cd backend && poetry install`.
- Detox app built: `cd mobile && npm run e2e:build:ios` (produces `ios/build/.../Atlasi.app`).
- Stack up: `bash .cursor/skills/verify-atlasi/scripts/launch-stack.sh` then `bash .cursor/skills/verify-atlasi/scripts/doctor.sh` must pass.
- One verification run owns one stack instance. Do not double-drive a simulator session another agent is using.

## Driving conventions

- Harness: **Detox** with stable `testID` and tab `accessibilityLabel` handles from `mobile/e2e/init.ts`.
- Start every recipe from a **fresh app instance** when the feature mutates auth or onboarding (`device.launchApp({ newInstance: true, delete: true })` via `clearAppState()`).
- Tab navigation uses labels: `passport-tab`, `dreams-tab`, `trips-tab`, `friends-tab`, `profile-tab`.
- Run drives through `bash .cursor/skills/verify-atlasi/scripts/drive.sh <feature-id>`.
- Proof artifacts live in `.cursor/skills/verify-atlasi/artifacts/<RUN_ID>/` and survive cleanup.

## Proof and skip reporting

- Capture the user action and resulting UI state, not only "test passed".
- Detox proof: `drive.log`, Detox artifacts under `artifacts/<RUN_ID>/detox/`, and failing screenshots when applicable.
- Backend proof (when relevant): `curl $EXPO_PUBLIC_API_URL/health` exit 0 and body `{"status":"ok"}`.
- Auth mutations create real Supabase users with `test.e2e.*@example.com` emails; that is expected for signup/trip flows.
- Report unreachable paths with the failed precondition and doctor output.

## Features

- [App launch](./app-launch.md) — cold start shows welcome or main tabs without crash.
- [Auth signup](./auth-signup.md) — email signup from welcome through onboarding entry.
- [Tab navigation](./tab-navigation.md) — valid logged-out or logged-in shell state.
- [Trips create](./trips-create.md) — new user completes onboarding, creates a named trip, sees it in the list.
- [Passport grid](./passport-grid.md) — open passport tab (smoke-level until a dedicated spec exists).
