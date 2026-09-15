---
name: verify-atlasi
description: Drive the Atlasi (Border Badge) iOS app on the simulator with Detox and prove user-facing behavior. Use when verifying mobile UI changes, auth/trips/passport flows, or before declaring a feature done. Requires macOS, backend on :8000, Metro on :8081, and a Detox-built Atlasi.app.
---

# Verify Atlasi (iOS)

Scripted verification for the **React Native / Expo** mobile app. Primary harness: **Detox** (`mobile/e2e/`). Supporting services: **FastAPI backend** and **Metro** (debug dev client).

Read `.cursor/skills/verify-atlasi/features/README.md` before driving; pick the feature file matching the change under test.

## Launch

From repo root:

```bash
# 1. One-time / when native deps change
cd mobile && npm install && npm run e2e:build:ios

# 2. Per verification run
export RUN_ID="$(date +%Y%m%dT%H%M%S)"
bash .cursor/skills/verify-atlasi/scripts/launch-stack.sh
```

**What launch-stack starts**

| Service | Command | Ready when |
| -------- | -------- | ----------- |
| Backend | `poetry run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000` | `curl $EXPO_PUBLIC_API_URL/health` → `{"status":"ok"}` |
| Metro | `npx expo start --dev-client --port 8081` | `curl http://127.0.0.1:8081/status` succeeds |
| Simulator | `launch-stack.sh` boots first available of iPhone 15/17/16 | `simctl list devices booted` shows a device; `mobile/.detoxrc.js` `device.name` must match an installed simulator |

PIDs and logs: `.cursor/skills/verify-atlasi/.state/$RUN_ID/` (`backend.pid`, `metro.pid`, `*.log`).

**Environment**

- `mobile/.env` or `mobile/.env.local`: `EXPO_PUBLIC_API_URL=http://<LAN-IP>:8000` (never `localhost` on iOS).
- `backend/.env`: Supabase keys (see `docs/environment-setup.md`).
- Bundle ID: `com.atlasi.app`. Detox binary: `mobile/ios/build/Build/Products/Debug-iphonesimulator/Atlasi.app`.
- Port **8000** must serve the Atlasi FastAPI app (`{"status":"ok"}` only). If Docker or another service owns `:8000` with a different `/health` body, stop it before launching.
- `mobile/.detoxrc.js` `devices.simulator.device.type` must match an installed simulator (default `iPhone 15`; this machine may only have `iPhone 17`).

**Teardown**

```bash
bash .cursor/skills/verify-atlasi/scripts/cleanup.sh "$RUN_ID"
```

Kills only PIDs recorded for that `RUN_ID`. Does **not** stop a backend or Metro you started manually outside this skill.

## Doctor

Read-only gate — run before every drive when anything looks wrong:

```bash
bash .cursor/skills/verify-atlasi/scripts/doctor.sh
```

All checks must pass. Fix failures in order: env → `poetry install` / `npm install` → launch-stack → `e2e:build:ios`.

## Drive

```bash
bash .cursor/skills/verify-atlasi/scripts/drive.sh <feature-id> [RUN_ID]
```

| Feature ID | Detox target | User path |
| ----------- | ------------- | ---------- |
| `app-launch` | `e2e/smoke.e2e.ts` | Cold start → welcome or tabs |
| `auth-signup` | `e2e/flows/auth.e2e.ts` | Get started → signup form |
| `tab-navigation` | `e2e/smoke.e2e.ts` | Valid shell state |
| `trips-create` | `e2e/flows/trips.e2e.ts` | Onboard → create named trip |
| `passport-grid` | smoke (interim) | See feature map — no dedicated spec yet |

Stable handles (prefer over text/coordinates):

- Welcome: `welcome-get-started-button`, `welcome-login-button`
- Signup: `signup-email-input`, `signup-password-input`, `signup-submit-button`
- Onboarding: `start-journey-button`, `save-continue-button`, `home-country-skip-button`
- Tabs: `passport-tab`, `dreams-tab`, `trips-tab`, `friends-tab`, `profile-tab` (accessibility labels)
- Trips: `fab-add-trip`, `empty-add-trip-button`, `trip-name-input`, `trip-save-button`

Helpers live in `mobile/e2e/init.ts`: `signUp`, `completeOnboarding`, `navigateToTab`, `tapAddButton`, `clearAppState`, `testData`.

## Evidence

Each drive writes to `.cursor/skills/verify-atlasi/artifacts/$RUN_ID/`:

- `drive.log` — full Detox stdout
- `feature.txt` — feature id + spec path
- `timestamp.txt` — UTC time
- `detox/` — Detox artifacts (screenshots on failure, logs)

**Proof standards**

- Exercise the real user path (Detox tapping visible controls), not internal test hooks or direct API seeding unless the feature map says so.
- Capture action **and** resulting UI state (`drive.log` pass line + visible element, or screenshot).
- Signup/trip flows mutate Supabase; that is expected.
- Do not delete `artifacts/` during cleanup.

## Cleanup

After collecting proof:

```bash
bash .cursor/skills/verify-atlasi/scripts/cleanup.sh "$RUN_ID"
```

Confirm `artifacts/$RUN_ID/drive.log` still exists after cleanup.

## Isolate

- One verification run should own one `RUN_ID` and one launched stack.
- Refuse to drive if another agent's Metro/backend PIDs are in `.state/latest` and still running — pick a new `RUN_ID` or coordinate cleanup.
- `clearAppState()` / `device.launchApp({ delete: true })` resets app data; it does not erase proof artifacts.

## Helpers

All scripts are executable from repo root:

```bash
bash .cursor/skills/verify-atlasi/scripts/doctor.sh
bash .cursor/skills/verify-atlasi/scripts/launch-stack.sh
bash .cursor/skills/verify-atlasi/scripts/drive.sh app-launch
bash .cursor/skills/verify-atlasi/scripts/cleanup.sh
```

## Maintenance

When routes, testIDs, or onboarding steps change, update the matching file under `features/` and the drive mapping in `scripts/drive.sh`. Use `/maintain-verification-skill` for a structured refresh.

## Secondary: backend-only smoke

When mobile build is unavailable, you can still verify API readiness:

```bash
curl -sf "${EXPO_PUBLIC_API_URL%/}/health"
```

That is **not** sufficient proof for UI features.
