# App launch

Cold start launches Atlasi on the iOS simulator and lands on a valid first screen: welcome (logged out) or main tabs (existing session).

## Sub-features

- `launch-no-crash` — app process stays up through splash.
- `launch-welcome` — logged-out users see get-started entry.
- `launch-tabs` — returning users see bottom tabs.

## How to get to it (user POV)

- Tap the Atlasi icon on the simulator home screen (Detox: `device.launchApp()`).

## Driving it with Detox

Preconditions:

- Doctor passes (backend, Metro, simulator, built `Atlasi.app`).
- No manual steps required before launch.

- **Launch.** Detox starts the app. Run `bash .cursor/skills/verify-atlasi/scripts/drive.sh app-launch`. Within 15s, either `welcome-get-started-button` or `trips-tab` is visible (`waitForEither` in `e2e/smoke.e2e.ts`).
- **Proof.** `artifacts/<RUN_ID>/drive.log` ends with passing test; optional Detox screenshots under `artifacts/<RUN_ID>/detox/`.

## Gotchas

- Missing Metro yields a redbox or hang; doctor checks `:8081/status`.
- Missing backend yields skeleton screens that never resolve; doctor checks `/health`.
- `localhost` in `EXPO_PUBLIC_API_URL` breaks all API calls from the simulator.
