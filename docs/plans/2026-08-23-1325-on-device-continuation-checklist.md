# On-Device Continuation Checklist — U6

Companion to `2026-08-23-1325-feat-continue-library-jobs-after-backgrounding-plan.md`.
U1–U5 are landed and Jest-green. Everything below needs a **real device** —
`BGContinuedProcessingTask`, the system progress UI, the grace window, and
process freezing are not observable in Jest or the simulator.

Work top to bottom. **§1 is the flagship** — if 1.1 fails, stop and report
(plan stop-condition (a)); the rest is moot.

Record every outcome in the `Result` column (pass / fail / n/a + one line).
Emerson owns this sweep and the Go/No-Go in the plan's Definition of Done.

---

## 0. Build readiness (before any device step)

| #   | Step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Result |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 0.1 | `cd mobile && eas build --profile preview --platform ios`. Confirm the build log compiles `JobContinuation` (look for `ContinuedTaskHolder.swift`) with no "unavailable" errors around `BGContinuedProcessingTask`. If the default image is older than Xcode 26, pin `build.preview.ios.image` (and later `build.production.ios.image`) in `mobile/eas.json` and rebuild. Locally the pod target compiles clean under Xcode 26.2 (`xcodebuild -project ios/Pods/Pods.xcodeproj -target JobContinuation`). |        |
| 0.2 | Download the artifact; inspect `Info.plist` in the `.ipa`: `BGTaskSchedulerPermittedIdentifiers` contains **both** `com.atlasi.app.continued-processing` and `com.expo.modules.backgroundtask.processing`; `UIBackgroundModes` contains `processing`. (`npx expo config --type introspect` already shows both locally — the artifact is the authoritative check.)                                                                                                                                         |        |
| 0.3 | `ios.buildNumber` in `app.config.js` is `'1'`. Sanity-check against App Store Connect before the `production` build; bump if needed.                                                                                                                                                                                                                                                                                                                                                                      |        |
| 0.4 | Within minutes of TestFlight install on an iOS 26 device, PostHog shows `job_continuation_capabilities` with `continued_processing: true`, `module_available: true`, `flag_enabled: true`.                                                                                                                                                                                                                                                                                                                |        |

---

## 1. Flagship — the scan keeps going (R1, R4)

iOS 26 device, signed in, Photos permission granted, a library large enough
for a multi-minute scan.

| #   | Action                                     | Pass =                                                                                                                                                                                                   | Result |
| --- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1.1 | Start a trip scan → press home immediately | The system progress UI appears (Dynamic Island / lock screen) titled **"Photo scan"** with a subtitle and a moving bar.                                                                                  |        |
| 1.2 | Leave it 5 minutes; reopen                 | Progress in the app has **advanced** past where it was when you left; no "Scan Stopped" / "stopped making progress" alert. `lease_begin{tier:'continued'}` and `lease_handler_fired` arrived in PostHog. |        |
| 1.3 | While leased, watch the system bar         | It **never goes backwards** and keeps moving during long silent stretches (segmentation).                                                                                                                |        |
| 1.4 | Let the scan finish while backgrounded     | System UI disappears on its own; reopening shows "Photo scan complete"; `lease_ended{outcome:'completed'}`.                                                                                              |        |

> If 1.1 shows no system UI at all and PostHog shows `lease_begin{skipped_reason:'submit-failed…'}`
> or `identifier-not-permitted`, **stop** — the task cannot be submitted from this build.

---

## 2. Flat progress under a long classify unit (KTD6 open question)

| #   | Action                                                                                                    | Pass =                                                                                                                                                              | Result |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 2.1 | Start a Guess Where build; background it during the `checking` stage (one classify call can take 60-90 s) | The system UI survives ≥ 90 s with only synthetic ticks; no `lease_expired` before the build reaches `building`.                                                    |        |
| 2.2 | If 2.1 fails                                                                                              | Record `elapsed_ms` from `lease_expired`. Fallback per plan: subtitle heartbeat (`updateTitle` with a changing subtitle every ~10 s) in the driver's progress push. |        |

---

## 3. Locked device (open question — decides U5 wording)

| #   | Action                                                           | Pass =                                                                                                                                                                       | Result |
| --- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 3.1 | Start a scan, press home, then **lock** the device for 3 minutes | Progress advanced on unlock.                                                                                                                                                 |        |
| 3.2 | If 3.1 stalls                                                    | Keep the result; `leaveHintWhileLeased` says "keeps going for a while" — acceptable if it stalls only while locked. If it stalls outright, soften the copy before promotion. |        |

---

## 4. Cancel and reclaim (R6, R7)

| #   | Action                                                                                                                                               | Pass =                                                                                                                                                                             | Result |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 4.1 | Scan leased + backgrounded → **cancel from the system UI** → reopen                                                                                  | Banner still reads as in progress (resumable, not failed); the job **resumes once** (`trip_scan_resumed`, a second `lease_begin` with `resumed: true`); no "something went wrong". |        |
| 4.2 | Cancel from the system UI a **second** time → reopen                                                                                                 | Job resumes in-app, but **no third system UI** (`lease_begin{skipped_reason:'reacquire-cap'}`).                                                                                    |        |
| 4.3 | Leased + backgrounded → reopen → **cancel in-app** (banner / screen)                                                                                 | System UI disappears **immediately**; `lease_ended{outcome:'cancelled'}` arrives before any in-flight classify could have finished.                                                |        |
| 4.4 | Expiry while **active**: hard to force — if observed (e.g. thermal), the job keeps running in-app and `lease_ended{outcome:'expired-active'}` fires. | Recorded, not required.                                                                                                                                                            |        |

---

## 5. Queue, sign-out, power

| #   | Action                                                      | Pass =                                                                                                                          | Result |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 5.1 | Start a quiz build, then start a scan (queued) → background | When the build finishes, the system UI **re-titles** to "Photo scan" and progress restarts from 0; one `lease_begin` only.      |        |
| 5.2 | Sign out mid-lease                                          | System UI disappears; no crash; signing back in and starting a job gets a fresh lease (`lease_ended` then a new `lease_begin`). |        |
| 5.3 | Low Power Mode on → start a scan → background               | Record whether the task runs; `lease_begin{low_power_mode:true}`. No pass criterion — data only.                                |        |
| 5.4 | Force-quit mid-scan → relaunch                              | Resumes from checkpoint on next launch (already shipped; confirm unchanged).                                                    |        |

---

## 6. iOS 18 (or any iOS < 26) device — grace tier (R2)

| #   | Action                                                                | Pass =                                                                                                                                                           | Result |
| --- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 6.1 | `job_continuation_capabilities`                                       | `continued_processing: false`, `module_available: true`.                                                                                                         |        |
| 6.2 | Start a scan → home → wait ~60 s → reopen                             | No system UI (expected). Scan resumes/continues **without** a stuck alert. `lease_begin{tier:'grace'}`, `lease_expired{tier:'grace'}` ~30 s after backgrounding. |        |
| 6.3 | Quiz build mid-hunt with ≥ 5 photos found → home → 3 minutes → reopen | The build does **not** finalize at the minimum count just because time passed; the hunt continues.                                                               |        |
| 6.4 | Same as 6.3 where a classify call was in flight at freeze             | On thaw at most **one** failed pass (the 90 s eligibility timeout), then the hunt continues.                                                                     |        |

---

## 7. Record back into the plan

- Feed §2 and §3 outcomes into `SCAN_COPY.shared.leaveHintWhileLeased` wording
  and the `continuationProgress` stage weights if needed.
- Go/No-Go for promotion past the internal TestFlight group (plan DoD):
  (a) every row above has a `Result`, (b) `lease_begin`, `lease_expired`, and
  `lease_ended` each observed with `tier:'continued'`, (c) the KTD12 ratio does
  not fire in the first 24 h.
