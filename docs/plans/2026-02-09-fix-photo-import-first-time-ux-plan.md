---
title: "Fix Photo Import First-Time UX"
type: fix
date: 2026-02-09
---

# Fix Photo Import First-Time UX

## Overview

The first-time photo import experience has four issues: a redundant "start scan" step, a duplicate large-library warning banner, broken background/sleep behavior during scanning, and an uninformative loading screen. These combine to make the feature feel unfinished for users with medium-to-large photo libraries.

## Problem Statement

### 1. Redundant First-Time Tap

First-time users navigate: **PhotoTripsScreen** (Polaroid illustration + "Scan Photos" button) -> **PhotoImportScreen** (generic icon + "Start Scan" button) -> scanning. That's two taps to start the same action. The Polaroid illustration empty state is the correct first impression — the intermediate idle screen on `PhotoImportScreen` adds nothing for first-time users.

**Current flow:**

```
PhotoTripsScreen (Polaroid, "Scan Photos")
  -> PhotoImportScreen (idle: icon, "Start Scan")
    -> scanning -> candidates
```

**Desired flow:**

```
PhotoTripsScreen (Polaroid, "Scan Photos")
  -> PhotoImportScreen (scanning immediately)
    -> candidates
```

### 2. Duplicate Large Library Warning

When `gpsPhotoCount > 5000`, a warning banner appears at the bottom: _"Large photo library detected (X photos). For best performance, filter by country after scanning."_ This duplicates the live progress counter already showing `X / Y (Z with GPS)`. It doesn't look good and provides no actionable guidance during the scan itself.

### 3. Scan Doesn't Survive Navigation or Sleep

The scan runs entirely on the foreground JS thread with no screen-wake lock and no navigation guard. If the user:

- Taps the back button — scan is silently aborted, progress lost
- Phone screen locks (auto-lock after 30-60s) — scan aborted
- Receives a phone call — app backgrounds, scan aborted

For a 10k+ photo library taking 3-5 minutes, this is almost guaranteed to happen. The existing `performBackgroundPhotoSync` only handles incremental background syncs after a completed initial import — it doesn't help here.

### 4. Uninformative Scanning Screen

The scanning UI shows: spinner, "Scanning Photos...", `X / Y`, progress bar, and Cancel. For scans lasting minutes, users don't know:

- How long it will take
- Whether they need to stay on the screen
- What's being found as it scans

## Proposed Solution

### Fix 1: Skip Idle for First-Time Scans

When `PhotoImportScreen` is opened from `PhotoTripsScreen` (i.e., the first-time "Scan Photos" button), pass `autoStart: true` in navigation params. Modify `PhotoImportScreen` to immediately begin scanning when `autoStart` is true and there's no cached data, skipping the idle phase entirely.

The idle phase remains useful for **returning users** who want to choose between "Check for New Photos" and "Refresh All Photos" — don't remove it, just skip it when unnecessary.

**Key files:**

- [PhotoTripsScreen.tsx](mobile/src/screens/photos/PhotoTripsScreen.tsx) — Update `handleStartScan` to pass `autoStart: true`
- [PhotoImportScreen.tsx](mobile/src/screens/photos/PhotoImportScreen.tsx) — Auto-start scan when `autoStart && !lastImportTime`
- [useAutoStartWorkflow.ts](mobile/src/screens/photos/useAutoStartWorkflow.ts) — Handle the new auto-start-without-cache path

**When scan finds no trips:** Show Alert, then navigate back to `PhotoTripsScreen` (not back to idle, since there's nothing useful there for a first-time user).

### Fix 2: Remove Large Library Warning Banner

Remove the `warningBannerScanning` view entirely from the scanning phase. The "filter by country" advice is better placed **after** scanning completes (on the candidates screen), not during. The progress counter already communicates scale.

**Key file:**

- [PhotoImportScreen.tsx:648-656](mobile/src/screens/photos/PhotoImportScreen.tsx#L648-L656) — Remove the `warningBannerScanning` block

### Fix 3: Keep-Awake + Navigation Guard

**A) Prevent screen sleep with `expo-keep-awake`:**

Install `expo-keep-awake` and activate it during the `scanning` phase. This prevents the device from auto-locking while the scan runs.

```
expo install expo-keep-awake
```

**Key file:**

- [PhotoImportScreen.tsx](mobile/src/screens/photos/PhotoImportScreen.tsx) — Add `useKeepAwake()` conditional on `phase === 'scanning'`

**B) Block accidental back-navigation:**

Use React Navigation's `beforeRemove` listener to intercept navigation during scanning. Show a confirmation alert:

> **Scan in Progress**
> If you leave now, you'll need to restart the scan.
> [Keep Scanning] [Stop Scan]

**Key file:**

- [PhotoImportScreen.tsx](mobile/src/screens/photos/PhotoImportScreen.tsx) — Add `beforeRemove` listener

**C) Cache progress incrementally:**

Currently, `cachePhotos()` is called only once after the entire extraction completes. Change `extractPhotosWithLocation` (or the scan orchestration in `usePhotoScan.ts`) to commit cached photos to SQLite every ~500 photos. This way, if the scan is interrupted (phone call, crash), the next incremental scan picks up from the last committed batch instead of starting over.

**Key files:**

- [usePhotoScan.ts](mobile/src/screens/photos/usePhotoScan.ts) — Add periodic cache commits during extraction
- [photoImportService.ts](mobile/src/services/photoImport/photoImportService.ts) — Yield batches for incremental caching

**D) Add cancel confirmation:**

When the Cancel button is tapped and scan has been running for >30 seconds, show a confirmation alert before canceling.

### Fix 4: Improve Scanning Screen

Replace the minimal scanning UI with more informative content:

**A) "Stay on this screen" messaging:**

Add clear text below the progress bar: _"Please keep the app open while we scan your photos. This usually takes 1-3 minutes."_

**B) Live discovery feed:**

As the scan progresses and countries are identified during the geocoding phase, show a rolling feed of discoveries: _"Found photos from France", "Found photos from Japan"_. This gives users something to watch and builds anticipation.

Implementation: The `segmentTripsFromCache` function already identifies countries. During scanning, we can periodically run a lightweight country tally on the cached photos and display new countries as they appear.

**C) Cancel button confirmation:**

See Fix 3D above — serves double duty for both issues.

**Key files:**

- [PhotoImportScreen.tsx:622-658](mobile/src/screens/photos/PhotoImportScreen.tsx#L622-L658) — Redesign scanning phase UI
- [photoImportStyles.ts](mobile/src/screens/photos/photoImportStyles.ts) — New styles

## Technical Considerations

- **`expo-keep-awake` is Expo-compatible** and doesn't require native code changes or new EAS builds (it's a JS-only API). Can ship via EAS Update.
- **Incremental caching every 500 photos** adds ~20 SQLite transactions for a 10k library. SQLite batch inserts are fast (~1-5ms each), so overhead is negligible.
- **`beforeRemove` navigation listener** is a standard React Navigation API that works with native-stack. No swizzling needed.
- **Country discovery feed** requires running `country-coder` lookups on GPS coordinates during scanning (already used in `segmentTripsFromCache`). This is CPU-only with no API calls — very fast.
- **No background task API needed.** iOS limits background execution to ~30 seconds, which is insufficient for a 3-5 minute scan. The "polite lock-in" approach (keep-awake + navigation guard + clear messaging) is the standard pattern for user-initiated long tasks.

## Acceptance Criteria

### Fix 1: Skip Idle for First-Time

- [x] Tapping "Scan Photos" on `PhotoTripsScreen` (first-time, no cache) navigates to `PhotoImportScreen` and immediately starts scanning — no intermediate idle screen
- [x] Returning users (with `lastImportTime`) still see the idle screen with "Check for New Photos" / "Refresh All Photos"
- [x] If auto-started scan finds no trips, Alert navigates back to `PhotoTripsScreen` (not idle)

### Fix 2: Remove Warning Banner

- [x] Large library warning banner no longer appears during scanning
- [x] Progress counter `X / Y (Z with GPS)` still shows during scanning

### Fix 3: Keep-Awake + Navigation Guard

- [x] Screen does not auto-lock while scanning phase is active
- [x] Pressing back/swiping during scanning shows confirmation alert
- [x] Choosing "Keep Scanning" in alert resumes scan without interruption
- [x] Choosing "Stop Scan" cancels scan and navigates back
- [x] Photos are committed to SQLite cache every ~500 photos during extraction
- [x] If scan is interrupted after 3000/10000 photos, next scan resumes from ~3000 (not 0)
- [x] Cancel button shows confirmation if scan has been running >30 seconds

### Fix 4: Scanning Screen

- [x] Scanning screen shows "Please keep the app open" messaging
- [x] As countries are discovered during scan, they appear as a rolling feed (e.g., "Found photos from France")
- [x] Scanning screen no longer shows the duplicate large-library warning banner

## Dependencies & Risks

- **New dependency:** `expo-keep-awake` — lightweight, well-maintained Expo SDK package. No risk.
- **Incremental caching changes** touch `extractPhotosWithLocation` which is also used by `performBackgroundPhotoSync`. Need to ensure background sync still works correctly with the refactored extraction (background sync should continue caching at the end, not incrementally, since it has no progress UI).
- **Navigation guard** must be cleaned up on unmount to avoid blocking navigation after the scan completes or the component unmounts.
- **Country discovery feed** requires importing `country-coder` in the scanning UI code path. This library is already bundled (used in `photoClustering.ts`), so no bundle size impact.

## References

### Internal

- [PhotoImportScreen.tsx](mobile/src/screens/photos/PhotoImportScreen.tsx) — Main UI (idle, scanning, candidates, suggestions)
- [PhotoTripsScreen.tsx](mobile/src/screens/photos/PhotoTripsScreen.tsx) — Trip browser with Polaroid empty state
- [usePhotoScan.ts](mobile/src/screens/photos/usePhotoScan.ts) — Scan orchestration
- [usePhotoImportWorkflow.ts](mobile/src/screens/photos/usePhotoImportWorkflow.ts) — Workflow state machine
- [useAutoStartWorkflow.ts](mobile/src/screens/photos/useAutoStartWorkflow.ts) — Auto-start logic
- [photoImportService.ts](mobile/src/services/photoImport/photoImportService.ts) — Photo extraction from MediaLibrary
- [photoCacheDb.ts](mobile/src/services/photoImport/photoCacheDb.ts) — SQLite cache + background sync
- [photoImportStyles.ts](mobile/src/screens/photos/photoImportStyles.ts) — StyleSheet

### External

- [expo-keep-awake docs](https://docs.expo.dev/versions/latest/sdk/keep-awake/)
- [React Navigation beforeRemove](https://reactnavigation.org/docs/preventing-going-back/)
