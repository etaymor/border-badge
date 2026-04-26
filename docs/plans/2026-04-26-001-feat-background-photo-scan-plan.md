---
title: 'feat: Run full photo library scan in the background of the app'
type: feat
status: completed
date: 2026-04-26
deepened: 2026-04-26
completed: 2026-04-26
---

# feat: Run full photo library scan in the background of the app

## Overview

Today, the first-time photo library scan must stay foregrounded on `PhotoImportScreen`: navigating away or backgrounding the app aborts the scan and forces the user to start over. The incremental "background sync" path (`performBackgroundPhotoSync`) only runs *after* the user has already completed a full scan, and only as a 1-hour-throttled top-up.

This plan lifts the full-library scan out of the screen so it survives navigation across the rest of the app, and so it auto-resumes after iOS suspends the JS runtime. A persistent banner surfaces progress globally and lets the user jump back to the screen at any time. When the user closes the app and reopens it 10 minutes later, the scan picks up where it left off without re-extracting the entire library — which is the only way this is genuinely useful for users with large libraries.

This is intentionally **scoped to in-app cross-screen background work plus auto-resume on next foreground**. OS-level background execution via `expo-background-task` (where iOS schedules execution slices opportunistically while the app is closed) is *not* in scope — see Scope Boundaries.

---

## Problem Frame

**User-visible problem.** The first photo scan can take 1–3 minutes for a typical library and 10+ minutes for 10k+ photo libraries. Users cannot use the rest of the app during that time, and the scan is destroyed if they:
- press the back button (`beforeRemove` confirms then aborts via `cancelScan`),
- swipe the screen off the stack (unmount cleanup calls `cancelScanRef.current()`),
- background the app (the unmount cleanup also fires under React Navigation's screen unmount on background).

A 10-minute scan that requires the user to sit on one screen with the app foregrounded is not realistic. They will close the app, reopen it later, and expect progress to be retained.

**Why "we already do this if someone comes back" is half-true.** `performBackgroundPhotoSync` (`mobile/src/services/photoImport/photoBackgroundSync.ts`) runs on app foreground and silently scans for new photos — but it gates on `getLastImportTime()` being set, meaning it only kicks in *after* a successful first full scan. It also runs at most once per hour, has no UI surface, and uses only the photo-library extraction primitives (no clustering, geocoding, or trip segmentation). It is not a path to "let me leave this screen during my first scan."

**Root cause of the current behavior.** The scan owns its `AbortController` inside `usePhotoScan` (a hook scoped to `PhotoImportScreen`). All scan state (progress, cluster lookups, photoLookup) lives in `usePhotoImportWorkflow`'s `useState`/`useRef` slots, which die with the screen. `useScanLifecycle` actively reinforces this: the unmount effect calls `cancelScanRef.current()` if the scan is still running. To deliver background processing, scan ownership has to move out of the screen.

---

## Requirements Trace

- R1. Once the user starts a scan, the scan continues to make progress while they navigate away from `PhotoImportScreen` to anywhere else inside the app.
- R2. A persistent in-app surface (banner or floating card) shows scan progress globally and lets the user return to `PhotoImportScreen` to view results.
- R3. Returning to `PhotoImportScreen` while a scan is in progress shows the live `ScanningPhase` UI without restarting work or flashing `IdlePhase`.
- R4. When the OS suspends the JS runtime (app fully backgrounded or killed), in-flight cache writes are durable per 500-photo batch boundary, so the next foreground resumes via incremental scan from the last successfully cached batch — not from zero.
- R5. The user can cancel an in-flight scan from either `ScanningPhase` or the persistent banner. Both routes go through the same 30-second confirmation guard.
- R6. Only one scan runs at a time; navigating into `PhotoImportScreen` while a scan is already running attaches to the existing scan rather than spawning a second one.
- R7. If a scan fails or gets stuck (no progress for several minutes despite `scan_in_progress=true`), the user can retry from either `ScanningPhase` or the banner with a single tap.
- R8. Auto-resume on next foreground only fires when it is safe: permissions still granted, home country still set, subscription still allows photo import, onboarding store hydrated, and the scan flag is not stale (>60min old without completion).

---

## Scope Boundaries

- **In scope:** Continuing the scan across in-app navigation; persistent progress UI; auto-resume on next foreground after iOS suspension; explicit failure + retry UX; stuck-scan detection.
- **Not in scope — OS-level background execution.** This plan does **not** add `expo-background-task` / `expo-background-fetch` / iOS `BGProcessingTask`. Those APIs run opportunistically (often overnight, capped per execution, no on-demand scheduling) and would require slicing the scan loop into iOS-task-budget-sized chunks. That is a substantially larger initiative and is deferred. What this plan delivers: scan resumes on next *foreground* — fast, predictable, and immediately useful — but does not make progress while the app is genuinely closed.
- **Not in scope:** Changes to clustering, geocoding, vision classification, or place-matching logic.
- **Not in scope:** Backend changes. `/photos/suggest-places` is unaffected.
- **Not in scope:** Android-specific foreground-service path. RN's foreground JS runtime keeps the scan alive across in-app navigation on Android, and the auto-resume mechanism on next foreground is platform-agnostic.

### Deferred to Follow-Up Work

- **OS-level background execution via `expo-background-task`:** future work. The scan loop in this plan is *not* pre-positioned to be sliced into BGTask-sized chunks; that is a separate refactor. The UI substrate (banner, store, service) introduced here is reusable.
- **Stronger stuck-scan recovery** (e.g., resumption with adaptive batch sizes, telemetry-driven detection thresholds): future work driven by real-world data after this ships.

---

## Context & Research

### Relevant Code and Patterns

- `mobile/src/screens/photos/usePhotoScan.ts` — owns the `AbortController` and the full scan loop, including incremental-cache-write batching every 500 photos and `discoveredCountries` aggregation.
- `mobile/src/screens/photos/usePhotoImportWorkflow.ts` — orchestrates phases, holds `clusterLookup` / `clusterDisplays` / `photoLookup` Maps (5–10MB for large libraries), and currently aborts background sync on unmount.
- `mobile/src/screens/photos/useScanLifecycle.ts` — activates `expo-keep-awake`, blocks back-nav with confirmation, and aborts on unmount via `cancelScanRef.current()`. Loses the unmount-cancel; keeps the keep-awake (focused-only); keeps the 30s cancel confirmation.
- `mobile/src/screens/photos/components/ScanningPhase.tsx` — the user-facing scan UI, including "Please keep the app open while we scan your photos" copy that this plan obsoletes. Gains a failed-state branch with retry.
- `mobile/src/services/photoImport/photoBackgroundSync.ts` — already uses module-level state (`backgroundSyncController`, `backgroundSyncInProgress`, `backgroundSyncId`) to coordinate background sync. **This is the pattern to mirror for the new `photoScanService`.**
- `mobile/src/services/photoImport/photoImportService.ts` — `extractPhotosWithLocation` is already abort-aware, paginates in 50-photo batches, and supports an `onBatch` callback. No changes needed inside extraction.
- `mobile/src/services/photoImport/photoCacheDb.ts` — incremental cache writes are the durable resumption mechanism; `setMetadata`/`getMetadata` is the surface for `scan_in_progress` and `scan_started_at`. `cachePhotos` uses `withTransactionAsync`; SQLite WAL recovery handles the iOS-suspend-mid-transaction case.
- `mobile/src/stores/onboardingStore.ts` and `mobile/src/stores/authStore.ts` — Zustand store conventions to mirror. Note: onboarding store uses `persist(createJSONStorage(...))`. **`photoScanStore` must NOT use persist** (heavyweight refs aren't JSON-safe; we keep them outside the store anyway, but the prohibition prevents accidental future regressions).
- `mobile/src/hooks/useAppStateTracking.ts` — already calls `performBackgroundPhotoSync(homeCountry)` on foreground. This hook gains the auto-resume check.
- `mobile/src/navigation/MainTabNavigator.tsx` — `HIDDEN_TAB_BAR_SCREENS` and `getTabBarStyle` (lines 29–72) use `getFocusedRouteNameFromRoute` recursion to read the focused leaf route. **Banner uses the same recursion pattern** to decide visibility.
- `mobile/src/screens/photos/useAutoStartWorkflow.ts` — existing precedent for "if cache is non-empty, skip to candidates"; informs how the screen re-attaches to a running scan.

### Institutional Learnings

- `docs/photo-import.md` documents the SQLite cache layout (`cached_photos`, `cached_trip_segments`, `processed_clusters`, `cached_suggestions`) and explicitly calls out memory optimization (5–10MB → minimal via `cached_trip_segments`). The persistent scan service must not regress this — heavyweight Maps stay outside the Zustand store, in a module-level ref on the service.
- The `photoBackgroundSync` module already established the lock + abort-controller + ID-versioned `finally` pattern for module-level scan coordination. The new persistent-scan service follows the same pattern verbatim.
- Per `CLAUDE.md`: no emojis or icons; type-safe nav params; ESLint + Prettier (100/2); single default export per component file. Pre-commit checklist applies.

### External References

External research deliberately skipped per Phase 1.2 — the codebase already has strong local patterns for module-level scan coordination (`photoBackgroundSync`), Zustand store ergonomics, and incremental scan resumption. Research would have been duplicative.

---

## Key Technical Decisions

### Phase boundaries (store vs screen)

Two distinct phase concepts exist and must not be conflated:

- **Store phase** (`photoScanStore.phase`): `idle | scanning | completed | failed`. Governs the scan *service*. Owned by `photoScanService`, mutated only by the service.
- **Screen phase** (`usePhotoImportWorkflow.phase`): `idle | loading | scanning | candidates | suggestions`. Governs the workflow *UI*. Owned by the workflow hook.

The screen observes the store and triggers its own screen-phase transitions. Specifically: when the screen observes `store.phase === 'completed'` and consumes `lastResult`, it calls its own `setPhase('candidates')`. The service never writes `'candidates'` or `'suggestions'` — those are screen concerns.

### Architecture decisions

- **Hoist scan ownership to a singleton service + Zustand store.** A new `photoScanService` (module-level singleton, mirrors `photoBackgroundSync.ts` shape) owns the `AbortController`, the scan loop, and progress emission. A new `photoScanStore` (Zustand) holds the subscriber-facing scalar snapshot: `phase`, `progress`, `discoveredCountries`, `isIncremental`, `scanFailure`. The screen and persistent banner subscribe via the store; neither owns the scan.
- **Heavyweight Maps stay outside the store.** `lastResult` (the 5–10MB Maps: `photoLookup`, `clusterLookup`, `clusterDisplays`) lives in a module-level ref *on the service*, not in Zustand. The store exposes `hasResult: boolean` and the screen calls `photoScanService.consumeResult()` to take ownership of the Maps. This eliminates JSON-serialization risk if anyone ever wraps the store with `persist` middleware, and removes the three-way-clear contract entirely.
- **Forbid `persist` middleware on `photoScanStore`.** Comment in the store file explicitly states this. The store holds only ephemeral session state; persistence is meaningless and dangerous (Maps would silently become `{}`).
- **`useState` lazy initializer for screen mount.** `usePhotoImportWorkflow`'s phase initializer reads the store synchronously: `useState(() => photoScanStore.getState().phase === 'scanning' ? 'scanning' : 'idle')`. This is a binding constraint to satisfy R3 (no flash of `IdlePhase` on remount during a running scan).
- **Keep `expo-keep-awake` active when the screen is focused AND scanning.** Removed only when the user navigates away or the scan completes. Rationale: a user actively watching their scan finish on-screen would otherwise hit iOS's idle timeout, lock the screen, and trigger an unnecessary suspend/resume cycle. Keep-awake is no longer load-bearing for *correctness* (the scan now survives navigation), but it materially reduces suspend cycles for the watch-it-finish case.
- **Drop the unmount-aborts-scan behavior in `useScanLifecycle`.** Replace it with the persistent banner and a mounted/foreground-aware re-attachment flow. Cancellation only happens via explicit user action.
- **Reuse `extractPhotosWithLocation` and `cachePhotos` unchanged.** The existing primitives already write incrementally to SQLite every 500 photos. iOS-suspend mid-batch is handled by SQLite WAL recovery; in-flight `cachePromises` that never awaited are simply lost and the next resume re-extracts those photos (INSERT OR REPLACE makes this safe).
- **Honor cancel through the post-extraction phase.** Today's scan loop has no abort checks between `setLastImportTime` and `onScanComplete`. Add abort checks before `segmentTripsFromCache` and before the `saveTripSegments` write. Cheap; avoids the surprise where a user taps cancel during segmentation and the scan still succeeds.
- **`photoScanService.start()` returns a discriminated result.** `{ status: 'started' } | { status: 'already-running' } | { status: 'rejected', reason: 'no-home-country' | 'no-permission' | 'not-premium' }`. The workflow's `startScan` reads `status` before doing optimistic state updates, so a duplicate-start no-op doesn't corrupt screen state.
- **Auto-resume gates.** On foreground, `useAppStateTracking` only kicks off `photoScanService.start({ resumed: true })` if ALL of the following hold:
  1. `scan_in_progress === true` in metadata.
  2. `scan_started_at` is less than `RESUME_STALENESS_MS` (60 minutes) ago. Older → clear flags, treat as failed/abandoned.
  3. `MediaLibrary.getPermissionsAsync()` returns `granted`.
  4. `homeCountry` is non-null.
  5. `useOnboardingStore.persist.hasHydrated()` returns `true` (don't fire during cold-start hydration race).
  6. Subscription state allows photo import: `isPremium === true` OR `canImportPhotos === true`. (Re-checked at resume time; expired subscription cancels the resume and surfaces the failure state.)
  7. `photoScanService.isRunning() === false` (idempotent guard for rapid foreground bounces).
- **Stuck-scan detection.** The service tracks a `lastProgressAt` timestamp internally. If the resume path or a foreground tick observes `scan_in_progress === true` AND `now - lastProgressAt > STUCK_SCAN_THRESHOLD_MS` (suggested: 5 minutes during scanning, since the largest libraries still emit progress every few seconds), transition store phase to `failed` with `scanFailure: { reason: 'stuck', title: 'Scan stopped', message: 'The scan stopped making progress. Tap to retry.' }`. Both `ScanningPhase` and the banner expose retry.
- **Single foreground-event serializer.** A module-level `foregroundEventInFlight: Promise<void> | null` in the service ensures concurrent `start({ resumed: true })` calls await the same in-flight resume rather than double-firing during rapid app-switcher bounces.
- **Auth-state cancel.** A new effect (probably in `useAppStateTracking` or a sibling hook) observes `useAuthStore.session`. When session transitions from non-null to null while `phase === 'scanning'`, calls `photoScanService.cancel()`. Prevents headless scanning for a logged-out user after a 401.
- **Banner placement uses focused-route recursion.** Banner mounts inside `MainTabNavigator` above `<Tab.Navigator>`. Visibility is computed by reading the focused leaf route via the same `getFocusedRouteNameFromRoute` recursion pattern that `getTabBarStyle` already uses (`MainTabNavigator.tsx` lines 29–72). Banner is hidden whenever the focused leaf route is in `HIDDEN_TAB_BAR_SCREENS` (already includes `PhotoImport`, `ShareCapture`, `EntryForm`, `TripForm`) — one rule covers all "screen has its own header / tab bar hidden" cases.
- **Coordination with `performBackgroundPhotoSync`.** Scan service `start` aborts background sync first (existing pattern); `performBackgroundPhotoSync` adds an early-return when `photoScanService.isRunning()` is true.

---

## Open Questions

### Resolved During Planning

- **Should this also work when the app is fully backgrounded by iOS?** No (OS-level execution is deferred), but auto-resume on next foreground IS in scope and is what makes this useful for large libraries.
- **Does keep-awake still serve a purpose?** Yes, but only when the screen is focused. Scoped to that case; still removed for the cross-screen case where it adds nothing.
- **How do we resume after iOS suspends the JS runtime?** Use the existing `getLastImportTime`-driven incremental code path, plus the `scan_in_progress` + `scan_started_at` metadata flags. Auto-restart on next foreground iff all seven gates pass (see "Auto-resume gates" above).
- **What happens if a scan gets stuck?** Stuck-scan detector transitions store to `failed`; banner and screen both expose one-tap retry. No silent stalls.
- **What about `lastResult` Map serialization risk?** Eliminated — Maps live on the service module ref, not in Zustand.

### Deferred to Implementation

- **Banner visual design.** Layout, copy, and pixel/typography decisions defer to implementation alongside `STYLEGUIDE.md`. Constraints: no emojis or icons (per `CLAUDE.md` rule 1); copy must mention that the user can keep using the app; copy must NOT promise scanning while the app is fully closed.
- **Exact thresholds.** `RESUME_STALENESS_MS = 60 * 60 * 1000` (60min) and `STUCK_SCAN_THRESHOLD_MS = 5 * 60 * 1000` (5min) are starting values. Tunable post-launch based on real-world data.
- **First-scan resume cost on huge libraries.** A 50k-photo library suspended mid-first-scan resumes via incremental, but `getLastImportTime` was never set — so the resume re-extracts everything (with INSERT OR REPLACE deduping the cache writes). The user-visible progress meter resets to 0%. Acceptable for v1; a future optimization could checkpoint `setLastImportTime` per batch on first scans, but the trade-off (potential miss of photos at batch boundaries) is intentionally not made now.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
                         photoScanStore (Zustand)
                          - scalar state only
                          - no persist middleware
                                  ▲
                ┌─────────────────┼──────────────────┐
                │                 │                  │
        PhotoImportScreen   PersistentScanBanner   useAppStateTracking
        (subscribes when    (subscribes globally,  (foreground listener;
         mounted; lazy      visible iff focused    triggers resume iff
         useState init)     leaf route is NOT      all 7 gates pass)
                            in HIDDEN_TAB_BAR)
                                  ▲
                                  │ phase / progress / scanFailure
                                  │
                         photoScanService (module singleton)
                          - start(opts) -> {status,reason?}
                          - cancel() / isRunning() / consumeResult()
                          - owns AbortController
                          - owns lastResult Maps (NOT in store)
                          - tracks lastProgressAt for stuck detection
                          - serializes concurrent foreground triggers
                                  │
                                  ▼
                  extractPhotosWithLocation + cachePhotos
                  (existing, unchanged; abort-aware,
                   incremental every 500 photos)
                                  │
                                  ▼
                    SQLite: cached_photos, metadata
                       (durable across suspension)
                       scan_in_progress, scan_started_at
```

**Lifecycle of a scan:**

1. User taps "Start Scan" on `PhotoImportScreen` → `usePhotoScan.startScan()` → `photoScanService.start({ homeCountry, filterCountryCode, forceRefresh })`. Service returns `{ status: 'started' }`; workflow optimistically transitions screen phase to `scanning`.
2. Service writes `scan_in_progress=true` + `scan_started_at=Date.now()` to metadata, sets store phase to `scanning`, runs the scan loop. `lastProgressAt` updated on each progress event.
3. User taps a different tab → `PhotoImportScreen` unmounts. `useScanLifecycle`'s old unmount-cancel is gone; the service keeps running. `PersistentScanBanner` (mounted in `MainTabNavigator`) is now visible because the focused leaf route is no longer in `HIDDEN_TAB_BAR_SCREENS`.
4. User taps the banner → `navigation.navigate('Passport', { screen: 'PhotoImport' })` (no params). Screen mounts with `useState` lazy initializer reading `store.phase === 'scanning'` → renders `ScanningPhase` immediately with live progress.
5. Scan completes → service: writes Maps to its module ref; updates store `phase: 'completed'`; clears `scan_in_progress` (atomic write *after* Maps and segment writes are durable). The screen, if mounted, observes `phase === 'completed'`, calls `photoScanService.consumeResult()` (which returns the Maps and clears the service's ref), runs `onScanComplete`, transitions screen phase to `'candidates'`. If the screen is not mounted, the banner shows "Scan complete — tap to continue."
6. iOS suspends mid-scan → JS pauses, partial cache writes already on disk via SQLite WAL. On next foreground, `useAppStateTracking` runs the seven-gate check; if all pass, calls `photoScanService.start({ resumed: true })`. The service checks `isRunning()` and the in-flight foreground serializer; if neither blocks, runs the scan loop (incremental against `getLastImportTime`).
7. Scan stuck → during a foreground tick or a periodic check inside the service, `now - lastProgressAt > STUCK_SCAN_THRESHOLD_MS` while `phase === 'scanning'` → service transitions store to `failed` with `scanFailure.reason = 'stuck'`. Banner shows "Scan stopped — tap to retry." Screen shows the same in `ScanningPhase`'s new failed branch.
8. User taps Retry → `photoScanService.start({ forceRefresh: false })` (re-runs as incremental from current cache state).
9. Auth state changes (sign-out, 401) while scanning → service auto-cancels, transitions store to `idle`, clears `scan_in_progress`.

---

## Implementation Units

- U1. **Create photoScanService and photoScanStore (scalar-only)**

**Goal:** Move scan ownership out of the screen by introducing a module-level singleton service and a Zustand store that any subscriber can read. Keep heavyweight Maps OFF the store.

**Requirements:** R1, R3, R4, R6, R7

**Dependencies:** None.

**Files:**
- Create: `mobile/src/services/photoImport/photoScanService.ts`
- Create: `mobile/src/stores/photoScanStore.ts`
- Modify: `mobile/src/services/photoImport/index.ts` (export new service)
- Modify: `mobile/src/stores/index.ts` (export new store)
- Test: `mobile/src/__tests__/services/photoImport/photoScanService.test.ts`
- Test: `mobile/src/__tests__/stores/photoScanStore.test.ts`

**Approach:**
- Service mirrors `photoBackgroundSync.ts` shape: module-level `AbortController`, `isRunning` flag, integer `scanId` to guard the `finally` block, `localController` capture for race-safe abort. Re-use these patterns verbatim.
- Service additionally tracks: `lastResult: ScanResult | null` (module-level ref, NOT in store); `lastProgressAt: number` (updated on each progress event); `foregroundEventInFlight: Promise<void> | null` (serializes concurrent resume calls).
- Service `start(opts)` returns `{ status: 'started' } | { status: 'already-running' } | { status: 'rejected', reason: 'no-home-country' | 'no-permission' | 'not-premium' }`. Synchronous lock check happens before any await to avoid race.
- Service exposes: `start(opts)`, `cancel()`, `isRunning()`, `consumeResult(): ScanResult | null` (returns Maps and clears the ref), `getLastProgressAt(): number`. Internal: `markFailed(reason, title, message)`.
- Store schema: `phase: 'idle' | 'scanning' | 'completed' | 'failed'`, `progress: ScanProgress | null`, `discoveredCountries: DiscoveredCountry[]`, `isIncremental: boolean`, `scanFailure: { reason, title, message } | null`, `hasResult: boolean`. Actions: internal-use mutators only — store is driven by the service.
- **`photoScanStore` MUST NOT use `persist` middleware.** Add a comment at the top of the file stating this and why.
- Service writes `scan_in_progress=true` and `scan_started_at=Date.now()` to metadata via `setMetadata` on start. Clears them in the `finally` block on success/cancel/failure (atomic — all three writes happen *after* `lastResult` and segment writes are durable).
- Service co-exists with `performBackgroundPhotoSync`: `photoScanService.start` calls `abortBackgroundSync()` first.
- Cancel via `cancel()` aborts the controller, transitions store to `idle`, clears metadata flags. Cancel mid-segmentation is honored: add abort checks before `segmentTripsFromCache` and before the `saveTripSegments` write.

**Patterns to follow:**
- `mobile/src/services/photoImport/photoBackgroundSync.ts` (module-level state, lock + scanId pattern, `localController` capture, lazy imports to avoid circular deps).
- `mobile/src/stores/onboardingStore.ts` (Zustand store shape, selector exports) — but note the persist middleware comment-out.

**Test scenarios:**
- Happy path: `start({ homeCountry: 'US' })` returns `{ status: 'started' }`, transitions store from `idle` to `scanning`, emits progress, transitions to `completed`, clears metadata flags. `consumeResult()` returns the Maps and clears the service ref.
- Happy path: incremental scan when `getLastImportTime()` returns non-null runs `extractPhotosWithLocation` with `since`.
- Edge case: `start()` while already running returns `{ status: 'already-running' }`, does not clobber `scanId`, does not double-write metadata.
- Edge case: `start()` with no `homeCountry` returns `{ status: 'rejected', reason: 'no-home-country' }`, does not set `scan_in_progress`.
- Edge case: `cancel()` aborts in-flight extraction, transitions store to `idle`, clears metadata flags. SQLite cache intact.
- Edge case: `cancel()` during segmentation phase (between extraction and `saveTripSegments`) is honored — abort check fires, store goes to `idle`, no `lastResult` is published.
- Edge case: `consumeResult()` on a service with no result returns `null` and is idempotent.
- Edge case: `consumeResult()` clears `hasResult` in the store.
- Error path: `extractPhotosWithLocation` throws non-abort error → store moves to `failed` with `scanFailure` set, metadata cleared, `scanId` advances cleanly.
- Integration scenario: `start()` while `performBackgroundPhotoSync` is mid-execution — bg sync is aborted before the new scan begins; cache writes do not interleave incorrectly.
- Integration scenario: `lastProgressAt` advances on each progress event; readable via `getLastProgressAt()` for stuck detection.
- Integration scenario: Maps held in service module ref are GC-eligible after `consumeResult()` is called.

**Verification:**
- Service runs end-to-end without any React tree mounted.
- `lastResult` Maps never appear in the Zustand store snapshot.
- `scan_in_progress` and `scan_started_at` are atomic with terminal state writes.

---

- U2. **Refactor usePhotoScan and usePhotoImportWorkflow to delegate to the service, with lazy state init**

**Goal:** Replace the screen-owned scan loop with a thin subscription. Preserve the existing public surface of `usePhotoImportWorkflow`. Use `useState` lazy initializer to satisfy "no flash of IdlePhase" on remount during running scan.

**Requirements:** R3, R6

**Dependencies:** U1.

**Files:**
- Modify: `mobile/src/screens/photos/usePhotoScan.ts`
- Modify: `mobile/src/screens/photos/usePhotoImportWorkflow.ts`
- Test: `mobile/src/__tests__/screens/photos/usePhotoScan.test.ts`
- Test: `mobile/src/__tests__/screens/photos/usePhotoScan.test.tsx`
- Test: `mobile/src/__tests__/screens/photos/usePhotoImportWorkflow.test.tsx`

**Approach:**
- `usePhotoScan` becomes a thin adapter: `startScan(forceRefresh)` calls `photoScanService.start({...})` and inspects the returned `status`. If `'already-running'`, do not call `setPhase` again — the existing scan's progress will flow through the subscription. If `'rejected'`, route to the existing onScanError pathway with the appropriate failure UI. If `'started'`, proceed as today.
- The adapter installs a Zustand subscription that fans store updates into the existing callback shape (`onScanProgress`, `onScanComplete`, `onScanError`). When store transitions to `completed` AND `hasResult === true`, the adapter calls `photoScanService.consumeResult()` and forwards the Maps to `onScanComplete`. When store transitions to `failed`, the adapter calls `onScanError` with `scanFailure`.
- `usePhotoImportWorkflow` initial phase uses lazy `useState`:
  ```
  useState<ImportPhase>(() => {
    if (skipToSuggestions && tripId) return 'loading';
    return photoScanStore.getState().phase === 'scanning' ? 'scanning' : 'idle';
  })
  ```
- Remove `abortBackgroundSync()` from the cleanup-on-unmount effect. Keep `clearLargeDataStructures` (memory hygiene for the post-completion path remains valid).
- Remove the screen-owned `abortControllerRef` from `usePhotoScan`.

**Patterns to follow:**
- Existing `usePhotoScan` callback shape stays. Internally, the hook installs a Zustand subscription that fans store updates back into those callbacks.
- `useAutoStartWorkflow` precedent for "derive initial state from cached source on mount" — extend the same pattern, don't invent a third one.

**Test scenarios:**
- Happy path: rendering a component using `usePhotoScan` and calling `startScan` triggers `photoScanService.start` exactly once with the expected arguments.
- Happy path: store-driven progress updates flow through `onScanProgress` callback unchanged.
- Edge case: `start()` returns `{ status: 'already-running' }` → adapter does not call `setPhase('scanning')` again; subscription continues feeding progress from the existing scan.
- Edge case: unmounting the host component while the service is mid-scan does *not* call `cancel()` (regression test for the new behavior).
- Edge case: mounting `usePhotoImportWorkflow` while `photoScanStore.phase === 'scanning'` initializes screen `phase` to `'scanning'` synchronously (no `'idle'` flash). Use a render counter / first-render assertion in the test.
- Edge case: a scan completed before the screen re-mounts is observed by the hook on first render via `phase === 'completed' && hasResult === true` → calls `consumeResult()` and forwards to `onScanComplete` exactly once; subsequent re-renders do not double-consume.
- Integration scenario: full workflow test starts a scan, simulates an unmount/remount cycle, verifies workflow ends in `candidates` phase without re-running extraction.

**Verification:**
- All existing `usePhotoScan.test.*` and `usePhotoImportWorkflow.test.tsx` cases pass after the refactor (with assertions updated for service delegation).
- No remaining references to `abortControllerRef` inside `usePhotoScan`.

---

- U3. **Update useScanLifecycle: keep keep-awake (focused-only), drop unmount-aborts, soften back-nav, add failed-state retry**

**Goal:** Decouple scan lifecycle from screen lifecycle. Retain keep-awake only when the screen is focused AND scanning. Add a failed-state branch to `ScanningPhase` with one-tap retry.

**Requirements:** R1, R5, R7

**Dependencies:** U2.

**Files:**
- Modify: `mobile/src/screens/photos/useScanLifecycle.ts`
- Modify: `mobile/src/screens/photos/components/ScanningPhase.tsx`
- Test: `mobile/src/__tests__/screens/photos/useScanLifecycle.test.ts`

**Approach:**
- Keep the `expo-keep-awake` activate/deactivate effect, but tie it to `phase === 'scanning' && screen is focused`. Use `useIsFocused()` from React Navigation. Deactivate when navigating away or when scan ends.
- Remove the unmount cleanup that calls `cancelScanRef.current()`. The scan now survives navigation; only an explicit user action cancels it.
- Replace the `beforeRemove` "Stop Scan / Keep Scanning" alert with a "Continue in background / Cancel scan" alert. Default = "Continue in background." "Cancel scan" routes through the existing 30-second cancel confirmation.
- Banner cancel routes through the **same** 30-second confirmation. Extract `handleCancelScan` (or the confirmation logic inside it) to a service-level helper or a standalone util so both call sites use it.
- `ScanningPhase.tsx`:
  - Replace "Please keep the app open while we scan your photos. This usually takes 1-3 minutes." with copy that reflects the new model. Constraint: must mention user can use the rest of the app; must NOT promise scanning while the app is fully closed.
  - Add a failed-state branch: when `scanFailure !== null`, render error title/message and a Retry button that calls `startScan(false)`.

**Patterns to follow:**
- Existing `Alert.alert` patterns; existing `useIsFocused()` usage in other screens.

**Test scenarios:**
- Happy path: unmount effect on a scanning component does *not* call `cancelScan`.
- Happy path: `expo-keep-awake.activateKeepAwakeAsync` is called when `phase === 'scanning'` AND `useIsFocused() === true`, deactivated when either becomes false.
- Edge case: navigating away during scan deactivates keep-awake but does not cancel; navigating back re-activates it.
- Edge case: `beforeRemove` while phase is `scanning` shows the new alert; "Continue in background" dispatches without cancel; "Cancel scan" goes through 30s confirmation.
- Edge case: failed state in `ScanningPhase` renders with title, message, and Retry button; tapping Retry calls `startScan(false)` and clears `scanFailure`.
- Edge case: 30-second cancel confirmation triggers via banner cancel route as well as screen cancel route (parameterized test).

**Verification:**
- Manual: starting a scan and tapping a different tab leaves the scan running; keep-awake deactivates; scan continues; banner shows progress.
- Manual: kicking off a scan, putting phone down, returning to the screen — keep-awake reactivates and scan continues without interruption.

---

- U4. **Add foreground auto-resume with 7-gate check, stuck-scan detection, and auth-state cancel**

**Goal:** When iOS suspends mid-scan, auto-resume on next foreground iff all gates pass. Detect stuck scans. Cancel scans on sign-out.

**Requirements:** R4, R7, R8

**Dependencies:** U1.

**Files:**
- Modify: `mobile/src/hooks/useAppStateTracking.ts`
- Modify: `mobile/src/services/photoImport/photoBackgroundSync.ts` (early-return when scan service running)
- Test: `mobile/src/__tests__/hooks/useAppStateTracking.test.ts` *(create if missing)*
- Test: `mobile/src/__tests__/services/photoImport/photoBackgroundSync.test.ts` (extend)
- Test: `mobile/src/__tests__/services/photoImport/photoScanService.resume.test.ts` *(focused tests for the resume gates)*

**Approach:**
- On foreground transition, before existing `performBackgroundPhotoSync` call, run the auto-resume check:
  1. Read `scan_in_progress` and `scan_started_at` from `photoCacheDb` metadata.
  2. If `scan_in_progress !== true` → skip resume.
  3. If `now - scan_started_at > RESUME_STALENESS_MS` (60min) → clear flags, transition store to `failed` with `scanFailure.reason = 'stale'`, skip resume.
  4. If `MediaLibrary.getPermissionsAsync()` is not `granted` → clear flags, transition store to `failed` with `scanFailure.reason = 'no-permission'`, skip resume.
  5. If `homeCountry === null` AND `useOnboardingStore.persist.hasHydrated() === false` → defer (don't clear flags); the next AppState=active or a homeCountry-change effect will retry. If hydrated AND `homeCountry === null` → clear flags, skip resume.
  6. If `isPremium === false` AND `canImportPhotos === false` → clear flags, transition store to `failed` with `scanFailure.reason = 'subscription-expired'`, skip resume.
  7. If `photoScanService.isRunning() === true` → resume is already in flight or scan never paused; skip.
  8. Otherwise call `photoScanService.start({ resumed: true })`.
- Foreground events are serialized at the service level via `foregroundEventInFlight` (U1) so rapid bounces don't double-fire.
- Stuck-scan detection runs on every foreground tick AND on a service-internal interval (e.g., every 30s while `phase === 'scanning'`). If `scan_in_progress === true && (now - lastProgressAt) > STUCK_SCAN_THRESHOLD_MS` → call `service.markFailed('stuck', ...)`.
- Auth-state cancel: a new effect in `useAppStateTracking` (or a sibling in the auth-aware tree) subscribes to `useAuthStore.session`; transitioning from non-null to null while `phase === 'scanning'` calls `photoScanService.cancel()`.
- `performBackgroundPhotoSync` adds an early-return at the top: if `photoScanService.isRunning()` → skip.

**Patterns to follow:**
- `useAppStateTracking.ts` existing AppState listener and `userId` gating.
- `photoBackgroundSync.ts` lock pattern when adding the cross-service guard.
- `onboardingStore.persist.hasHydrated()` is a Zustand persist API and is the right hook for the hydration race.

**Test scenarios:**
- Happy path: foreground with `scan_in_progress=true`, gates 2–7 pass → calls `photoScanService.start({ resumed: true })` exactly once.
- Happy path: foreground with `scan_in_progress=false` does *not* call resume.
- Edge case (gate 3): `scan_started_at = now - 90min` → flag cleared, store transitions to `failed`, no resume.
- Edge case (gate 4): permissions revoked → flag cleared, store transitions to `failed` with `'no-permission'` reason, no resume.
- Edge case (gate 5a): onboarding store NOT hydrated, `homeCountry === null` → defer (no flag clear, no resume).
- Edge case (gate 5b): onboarding store hydrated, `homeCountry === null` → flag cleared.
- Edge case (gate 6): subscription expired (`isPremium=false && canImportPhotos=false`) → flag cleared, store to `failed` with `'subscription-expired'`.
- Edge case (gate 7): `isRunning()=true` → resume is no-op; `performBackgroundPhotoSync` also skips.
- Edge case: rapid foreground/background bounces (4 transitions in 200ms) → resume runs at most once due to `foregroundEventInFlight` serializer.
- Edge case: stuck scan — `phase=scanning, lastProgressAt = now - 6min` → service marks failed; banner and screen show retry.
- Edge case: auth state transitions session=non-null → null while scanning → service cancels; store transitions to `idle`; metadata cleared.
- Integration scenario: simulate "suspend mid-scan" by aborting the controller and leaving `scan_in_progress=true`; trigger foreground; assert incremental scan starts and ends in `candidates` outcome.

**Verification:**
- Force-quit mid-scan and relaunch → resume kicks off via foreground hook; progress reflects cached photos count.
- `performBackgroundPhotoSync` does not invoke `extractPhotosWithLocation` while a service scan is running.

---

- U5. **Build PersistentScanBanner with focused-route recursion and complete state matrix**

**Goal:** Surface scan progress globally; provide one-tap return to `PhotoImportScreen`; expose retry on failure.

**Requirements:** R1, R2, R5, R7

**Dependencies:** U1.

**Files:**
- Create: `mobile/src/components/photos/PersistentScanBanner.tsx`
- Modify: `mobile/src/navigation/MainTabNavigator.tsx` (mount banner above tabs; expose focused-route helper if not already shared)
- Test: `mobile/src/__tests__/components/photos/PersistentScanBanner.test.tsx`

**Approach:**
- Banner subscribes to `photoScanStore`. State matrix:
  - `phase === 'idle'` → hidden.
  - `phase === 'scanning' && progress.percentage === 0` → "Starting scan…" with spinner, no percentage.
  - `phase === 'scanning' && progress.percentage > 0` → "Scanning photos · NN%" with progress fill and small cancel affordance.
  - `phase === 'completed' && hasResult` → "Scan complete — tap to continue" affordance; auto-dismisses 30s after entering this state by calling `photoScanService.consumeResult()` then transitioning store back to `idle`. Tap before dismissal → navigate to PhotoImport (which consumes result via U2).
  - `phase === 'failed' && scanFailure.reason !== 'no-trips'` → "Scan stopped — tap to retry"; tap → calls `photoScanService.start({})`.
  - `phase === 'failed' && scanFailure.reason === 'no-trips'` → "No travel photos found — tap for details"; tap navigates to PhotoImport, which renders the existing `scanFailure` Alert.
- Banner visibility ALSO gated by focused-route recursion: hidden when focused leaf route is in `HIDDEN_TAB_BAR_SCREENS`. Use the same `getFocusedRouteNameFromRoute` recursion as `getTabBarStyle` in `MainTabNavigator.tsx` lines 29–72. Extract this into a small shared helper if it's not already.
- Layout: pinned above the bottom tab bar; safe-area aware. When the tab bar is hidden, the banner is also hidden (one rule via `HIDDEN_TAB_BAR_SCREENS`).
- Cancel affordance routes through the **same** 30-second cancel confirmation as the screen (extracted helper from U3).
- Tap-to-navigate dispatches `navigation.navigate('Passport', { screen: 'PhotoImport' })` with NO params. The screen relies on its U6 lazy-init store-snapshot read to reattach.
- Re-render hygiene: subscribe via narrow Zustand selectors (`useStore(s => s.phase)`, etc.) to avoid re-rendering on every progress tick when only `progress.current` changes. Throttle progress display updates to ~10Hz internally.
- Accessibility: `accessibilityLiveRegion="polite"` on the progress label; `accessibilityRole="progressbar"` on the bar; tap target meets 44×44pt; cancel affordance is a labeled button, not just an X icon (per CLAUDE.md no-icons rule — use a "Cancel" text button).

**Patterns to follow:**
- Existing UI primitives in `mobile/src/components/ui/` (`Button`, glass surfaces).
- `STYLEGUIDE.md` colors (`sunsetGold`, `colors` palette).
- `MainTabNavigator.tsx` `getFocusedRouteNameFromRoute` recursion (lines 29–72).

**Test scenarios:**
- Happy path: banner renders when `phase === 'scanning'`, hidden when `phase === 'idle'`.
- Happy path: tapping the banner navigates to `PhotoImport` with no params.
- Happy path: `phase === 'failed'` shows retry; tapping retry calls `photoScanService.start({})` once.
- Edge case (focused-route): banner is hidden when focused leaf route is in `HIDDEN_TAB_BAR_SCREENS` (`PhotoImport`, `ShareCapture`, `EntryForm`, `TripForm`) — parameterized.
- Edge case: 0% progress shows "Starting scan…" without a number.
- Edge case: `phase === 'completed'` auto-dismisses after 30s; if the user taps before dismissal, no double-consume.
- Edge case: empty-result completion (`scanFailure.reason === 'no-trips'`) routes through failed-state copy.
- Edge case: cancel from banner triggers the same 30s confirmation as cancel from screen.
- Integration scenario: switching tabs does not unmount or remount the banner.

**Verification:**
- Banner survives tab switches without remount.
- Cancel from banner aborts the service and updates store within a single tick.

---

- U6. **Screen integration: lazy state init, retry on failure, manual QA**

**Goal:** `PhotoImportScreen` re-attaches cleanly to a running scan via lazy `useState` initializer. Retry surfaced when phase=failed.

**Requirements:** R3, R5, R7

**Dependencies:** U2, U3, U5.

**Files:**
- Modify: `mobile/src/screens/photos/PhotoImportScreen.tsx` (initial-phase derivation; failed-state rendering)
- Modify: `mobile/src/screens/photos/components/ScanningPhase.tsx` (already in U3) — verify failed-state branch
- Modify: `mobile/src/screens/photos/components/IdlePhase.tsx` (no changes expected; verify the running-scan case never leaves the user on IdlePhase)
- Modify: `mobile/src/screens/photos/usePhotoImportWorkflow.ts` (already covered in U2 lazy init; finalize)

**Approach:**
- Confirm `usePhotoImportWorkflow`'s `useState` lazy initializer (added in U2) reads `photoScanStore.getState().phase === 'scanning'` synchronously. This is the binding pattern for R3 ("no flash of IdlePhase").
- If `phase === 'completed' && hasResult` on mount, the workflow's adapter (U2) consumes via `consumeResult()` and forwards to `onScanComplete`, transitioning screen phase to `'candidates'`.
- If `phase === 'failed'` on mount (e.g., user came back via a "Scan stopped — retry" banner tap), the screen renders `ScanningPhase` in failed-state with the Retry button (added in U3).
- Manual QA pass:
  - Start scan, swipe to a different tab, verify scan keeps running, banner appears, keep-awake released.
  - Tap banner, verify return to `PhotoImportScreen` shows live progress without flashing IdlePhase.
  - Force-quit mid-scan, relaunch → auto-resume kicks off (verify via cached photo count vs. progress).
  - Stale flag (>60min): manually set `scan_started_at` to 90min ago, foreground → store transitions to failed, retry surfaces.
  - Subscription expired between scan-start and resume: simulate via subscription store override → resume rejected, failed state with subscription-expired reason.
  - Sign out mid-scan → scan auto-cancels, store goes to idle, metadata cleared.
  - Cancel from banner → 30s confirmation alert appears (same as screen cancel).
  - Stuck scan: pause progress emission for 6min → store transitions to failed, retry available.
  - Two rapid foreground bounces in <500ms → resume fires exactly once.

**Patterns to follow:**
- The existing `useAutoStartWorkflow` precedent for "derive initial state from cached state on mount."

**Test scenarios:**
- Happy path: mounting `PhotoImportScreen` while `photoScanStore.phase === 'scanning'` renders `ScanningPhase` on first paint without rendering `IdlePhase`. Use first-render assertion or render-counter mocks.
- Happy path: mounting while `phase === 'completed' && hasResult === true` consumes the result once and lands in `candidates`.
- Edge case: mounting while `phase === 'failed'` renders `ScanningPhase` failed-branch with Retry button.
- Edge case: mounting while `phase === 'idle'` renders `IdlePhase` exactly as today.
- Integration scenario: navigating away during scanning then back leaves screen `phase` at `'scanning'` continuously; progress monotonically advances.

**Verification:**
- Manual QA checklist above passes on iOS and Android.
- No console warnings about state updates after unmount during navigate-away/back cycles.

**Note on test file creation:** Add the integration scenarios to the existing workflow-level test (`usePhotoImportWorkflow.test.tsx`) — do NOT create a new `PhotoImportScreen.test.tsx`. The codebase doesn't currently use screen-rendering tests; match that posture.

---

## System-Wide Impact

- **Interaction graph:** The scan service has at least four subscribers: `usePhotoImportWorkflow`, `PersistentScanBanner`, `useAppStateTracking` (foreground-resume + auth-state-cancel), and `performBackgroundPhotoSync` (collision check). Subscription cleanup never calls `cancel()`.
- **Error propagation:** Failures route through a single store path: service writes `phase: 'failed'` + `scanFailure`. Workflow adapter, banner, and screen all read the same value; there is no parallel callback path. The existing `usePhotoImportWorkflow.scanFailure` prop continues to surface failures to the screen via the same shape — but the source is now the store.
- **State lifecycle risks:** `lastResult` Maps live on the service module ref, NOT in Zustand. Service exposes `consumeResult()` which atomically returns and clears. The store's `hasResult: boolean` flag mirrors `lastResult !== null`. No JSON-serialization risk.
- **API surface parity:** `usePhotoImportWorkflow` keeps its existing return shape so `PhotoImportScreen` and child components don't need ripple-edits.
- **Integration coverage:** App-state foreground transitions, screen unmount/remount cycles, concurrent `performBackgroundPhotoSync`, auth-state changes, stuck-scan detection, and rapid foreground bounces are integration seams covered by U2/U4/U6 explicit integration scenarios.
- **Unchanged invariants:**
  - SQLite cache schema does not change. Two new metadata keys (`scan_in_progress`, `scan_started_at`) go through the existing `metadata` table; no migration.
  - `extractPhotosWithLocation`, `cachePhotos`, `segmentTripsFromCache`, `saveTripSegments` are untouched.
  - Backend `/photos/suggest-places` is untouched.
  - Free-tier limit "1 photo-import trip lifetime" is enforced downstream of the scan, in the candidate-confirmation flow. Unaffected.
  - The 1-hour `performBackgroundPhotoSync` throttle stays exactly as today; the new path adds a collision guard.
- **Subscription gating:** The auto-resume gate (gate 6 in U4) re-checks subscription state at resume time. A user whose subscription expired between scan-start and resume is gracefully surfaced into the `failed` state with the `'subscription-expired'` reason, rather than silently running a multi-minute scan they cannot use.

---

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| First-scan resume on huge libraries restarts at 0% (since `getLastImportTime` was never set) | Med | Med | INSERT OR REPLACE in `cachePhotos` makes the work cheap on disk; user-visible progress meter resets but completion time is bounded. Document expectation in user-facing copy. Future: per-batch `setLastImportTime` checkpointing on first scans. |
| iOS suspends JS mid-`withTransactionAsync` and SQLite WAL recovery edge cases | Low | High | Existing pattern from `cachePhotos` already operates at transaction granularity; SQLite WAL is crash-safe at commit boundary. Manual QA includes force-quit mid-scan as a primary test. |
| Stale `scan_in_progress` flag from a JS crash pinned across launches | Med | High | `RESUME_STALENESS_MS = 60min` gate in U4 catches this; staler flags clear on next foreground and surface as failed state with retry. |
| Rapid foreground/background bounces double-fire resume | Med | Med | `foregroundEventInFlight` serializer in service (U1) + `isRunning()` gate (U4 gate 7). |
| User backgrounds with deliberate intent to stop scan; auto-resume restarts it on next foreground | Med | Low | Banner with explicit Cancel affordance is the canonical stop. Backgrounding is treated as pause, consistent with user-stated intent. Cancellation is durable (cancel clears `scan_in_progress`). |
| Subscription expires between scan-start and auto-resume; resume runs anyway | Low | Med | Gate 6 in U4 re-checks `isPremium`/`canImportPhotos` before resume; failed state surfaces explicit "subscription required" message. |
| Limited-photo selection mutates between scan-start and resume; resume misses newly-permitted photos | Low | Low | Accepted for v1. User can always run "Refresh All Photos" (existing path). Document in copy that limited-access sets are a snapshot. |
| Sign-out (401) mid-scan leaves headless work running for logged-out user | Low | Med | Auth-state-cancel effect in U4 catches session→null while scanning. |
| Persistent banner adds visual real-estate cost on every tab | Med | Low | Hidden for `idle`; hidden when focused leaf route is in `HIDDEN_TAB_BAR_SCREENS`; auto-dismisses after `completed` state. |
| Memory pressure if `lastResult` Maps linger on service ref while user navigates | Med | Med | Banner auto-dismiss after 30s in `completed` state calls `consumeResult()` and discards if screen never picked it up. Screen unmount during candidates triggers existing `clearLargeDataStructures`. |
| `expo-keep-awake` removal during navigation causes screen lock + suspend cycle | Low | Med | Mitigated: keep-awake retained when screen is focused AND scanning. Only released on navigate-away. |
| New Architecture changes abort propagation timing for native MediaLibrary calls | Low | Low | Cancellation latency is bounded by current 50-photo batch granularity (~seconds). Banner state on cancel is "Cancelling…" if cancel is in flight (not yet `idle`); transition to idle once service confirms abort completed. |
| Module re-evaluation under React Fast Refresh (dev only) resets singleton state mid-scan | High in dev | Low | Dev-only annoyance; production unaffected. Manual QA notes this; no mitigation in production code. |

---

## Documentation / Operational Notes

- Update `docs/photo-import.md` to document `photoScanService` + `photoScanStore`, the auto-resume gates, stuck-scan detection, and the new "scans persist across in-app navigation and resume on next foreground" behavior. Replace any implication that scans are screen-bound.
- Update `mobile/src/screens/photos/components/ScanningPhase.tsx` copy per U3 constraints.
- No backend rollout, no migration, no feature flag needed — purely client-side, low-risk to revert via EAS Update if needed (per `CLAUDE.md`'s EAS Update guidance, this is a JS-only change).
- No new native package dependencies. `expo-keep-awake` stays installed and active for the focused-screen case.

---

## Sources & References

- Current scan implementation: `mobile/src/screens/photos/usePhotoScan.ts`, `mobile/src/screens/photos/usePhotoImportWorkflow.ts`, `mobile/src/screens/photos/useScanLifecycle.ts`
- Existing background sync precedent: `mobile/src/services/photoImport/photoBackgroundSync.ts`, `mobile/src/hooks/useAppStateTracking.ts`
- Screen UI: `mobile/src/screens/photos/PhotoImportScreen.tsx`, `mobile/src/screens/photos/components/ScanningPhase.tsx`, `mobile/src/screens/photos/components/IdlePhase.tsx`
- Navigation: `mobile/src/navigation/MainTabNavigator.tsx` (focused-route recursion pattern)
- Photo import architecture: `docs/photo-import.md`
- Project conventions: `CLAUDE.md` (no emojis/icons, pre-commit checklist, EAS Update rules)
- Expo background-task constraints (informing the deferred scope): https://docs.expo.dev/versions/latest/sdk/background-task/, https://expo.dev/blog/goodbye-background-fetch-hello-expo-background-task
