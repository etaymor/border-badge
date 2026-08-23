# Consolidate the photo import experience across Trips and Guess Where

## Context

Border Badge has **one** library scan serving **two** features: trip discovery (Passport) and Guess Where challenges. The scan is the app's central asset — it's the thing that makes both features possible, and getting it wrong is the biggest single risk to adoption.

The data layer is already consolidated and in good shape: one SQLite `photos.db`, one refresh lock, one freshness record (`photo_library_sync_status`), shared verdict/tag caches. That part needs no work.

What has diverged is the **job lifecycle** and the **narrative** — and the narrative gap is downstream of the lifecycle gap:

- **Trips** has a durable singleton (`photoScanService` + 7 resume gates + `PersistentScanBanner`). It survives navigation, survives iOS suspending the app, and auto-resumes on foreground. Its copy can honestly say *"feel free to use the rest of the app while we scan."*
- **Guess Where** calls the same cache but runs its build **inline from a React mutation owned by the screen**. `QuizCreationScreen.tsx:326-330` aborts on unmount. Leaving the screen destroys up to 90s of hunting and up to 300 classified images. There is no keep-awake, no AppState resume, no banner.
- Because the quiz build dies when you leave, its copy *cannot* honestly invite you to leave. So it shows one thin privacy line and a `4,500 of 53,282` counter that reads as "you must wait for 53,282" — with nothing explaining why the whole library is being read.
- The permission copy already promises *"The same scan builds your trips, too"* — but the quiz path never runs trip segmentation, so the promise is not literally kept.

**Intended outcome:** one scan, one story, one durable job runtime. A user with a 50k-photo library can start a challenge, put the phone down, use the rest of the app, come back, and find their challenge — and their trips — waiting.

### Decisions already made (do not re-litigate)

1. **Shared job runtime**, not a pipeline merge. Both pipelines keep their distinct work; they share the shell, the cache, and the narrative.
2. **In-app durability + foreground resume first** (OTA-shippable). Chunk the loop so a later `BGProcessingTask` phase is additive. Copy must **never** promise scanning while the app is closed.
3. **Keep the trips promise**: after the quiz build lands its picks, continue into trip segmentation using the already-extracted photos.

### Hard constraint

There is no `expo-task-manager`, no `expo-background-task`, and no `UIBackgroundModes` in `app.config.js`. The 2026-04-26 background-scan plan scoped OS-level background execution out deliberately (iOS runs `BGProcessingTask` opportunistically — typically overnight while charging — and it cannot be scheduled on demand). **"Background" in phases 1–4 means: survives navigation, survives suspend, resumes on next foreground.** Phase 5 is a separate native build.

---

## Part A — Shared job runtime

### New: `mobile/src/services/jobs/`

| File | Contents |
| --- | --- |
| `jobTypes.ts` | `LibraryJobKind = 'trip-scan' \| 'quiz-build'`; `JobPhase = 'idle' \| 'waiting' \| 'running' \| 'completed' \| 'failed'`; `JobFailure` (generalizes `PhotoScanFailure`); `JobProgress`; `JobRunContext`; `JobStep`; `JobDescriptor`. Leaf module — imports nothing from `photoImport` or `quiz`. |
| `jobRuntimeState.ts` | Generalizes `photoScanState.ts`: `runningKinds: Set<LibraryJobKind>`, `isJobRunning(kind)`, `isAnyLibraryJobRunning()`, `_setJobRunning`. Absorbs the existing `isBackgroundSyncFlagSet`/`_setBackgroundSyncFlag` pair unchanged. Stays the cycle-breaking leaf. |
| `jobDurableFlag.ts` | Per-kind durable record + legacy compat (below). |
| `jobRegistry.ts` | `registerJob(descriptor)` / `getDescriptor(kind)`. Owners register at import time so the runtime never imports `photoScanService` or `quizBuildJob` — this keeps the dependency graph acyclic. |
| `jobRuntime.ts` | The shell: per-kind controller, generation, `startedAt`, `lastProgressAt`, `cancelInFlight`; module-global `foregroundEventInFlight`. `startJob`, `cancelJob`, `markJobFailed`, `heartbeat`, `resetAllForUserChange`. Owns the step loop. |
| `jobGates.ts` | Composable resume gates. |
| `jobResume.ts` | `tryResumeJobs()` / `detectStuckJobs()`. |

**Reuse, don't reinvent.** ~55% of `photoScanService.ts` is already the generic shell and should be moved essentially verbatim:
- `photoScanService.ts:216-239` — the `foregroundEventInFlight` serializer.
- `:241-288` — atomic synchronous lock check before any `await`, then the durable flag persisted **before** returning `'started'` (closes a documented crash window; keep the comment).
- `:272-279` — releasing the in-memory lock if the durable write throws.
- `:573-586` — generation-guarded release (`scanId === mySyncId`).
- `:164-209` — `cancelScan` / `markFailed`, including `cancelInFlight` so resume can await a pending cancel.
- `:151-158` — the `consumeResult()` atomic return-and-clear contract.

### Moves and splits

- `src/stores/photoScanStore.ts` → **`src/stores/libraryJobStore.ts`**. Deleted, not shimmed — only 5 non-test call sites. Two stores would mean the banner reconciles two phases and `resetForUserChange` has two paths.
- `src/services/photoImport/photoScanState.ts` → absorbed into `jobRuntimeState.ts`.
- `src/services/photoImport/photoScanResume.ts` → gates move to `jobGates.ts`; thresholds become per-descriptor.
- `src/services/photoImport/photoScanService.ts` (668 lines) splits into `photoScanService.ts` (~230, descriptor + public API) and **`photoScanSteps.ts`** (~330, the body of `runScan`, lines 294-572, taking `JobRunContext`).
- `src/components/photos/PersistentScanBanner.tsx` → **`src/components/jobs/PersistentJobBanner.tsx`**.

### Store shape

```ts
// libraryJobStore.ts — MUST NOT use persist.
// Keep photoScanStore.ts:11-16's comment verbatim; the reason is now stronger
// (pickUris are local file:// URIs that go stale).
interface LibraryJobSlice {
  phase: JobPhase;
  progress: JobProgress | null;
  failure: JobFailure | null;
  hasResult: boolean;
  startedAt: number | null;
  resultRoute: { screen: string; params?: object } | null;
  detail: TripScanDetail | QuizBuildDetail;
}
interface LibraryJobState { jobs: Record<LibraryJobKind, LibraryJobSlice>; }
```

- `TripScanDetail = { discoveredCountries, isIncremental }` (today's fields).
- `QuizBuildDetail = { step, pickUris: string[], examined: number }` — ≤10 short strings, JSON-friendly. Pool, ledger, and session stay on a module ref in `quizBuildJob.ts`, exactly as the 5-10MB result Maps do today.
- Keep the narrow-selector discipline from `photoScanStore.ts:72-77` — quiz progress emits per classified image.
- `isAlertScanFailure` (`photoScanStore.ts:84-97`) moves onto the descriptor as `isAlertFailure(reason)`, keeping the exhaustive switch.

### Concurrency: one running job, queue depth 1

Both jobs contend for `acquireRefreshLock` (`photoBackgroundSync.ts:144`) and the same SQLite writes. `startJob` returns `{ status: 'queued', blockedBy }` when another kind runs; the queued slice goes `phase: 'waiting'` and the runtime drains in the running job's `finally`. **Never preempt.**

A user tapping "create quiz" mid trip-scan waits — and the wizard renders *"Finishing your library scan first — 62%"* driven by the trip-scan slice. This is the one-scan story running in the other direction, and it must ship **with** Part A/PR2, not later, or the wait reads as a hang.

**Critical:** `photoLibrarySyncStatus.ts:151` and `photoBackgroundSync.ts:192,249` all branch on `isScanRunning()`. That is the shared **writer lock** and must become `isAnyLibraryJobRunning()` in the same PR — otherwise a quiz job lets `performBackgroundPhotoSync` interleave SQLite writes with `ensureFreshLibrary`'s extract loop. This is why PR1 cannot be split.

### Durable flag + migration

Today: `scan_in_progress` = `'true'|'false'`, `scan_started_at` (`photoScanService.ts:63-64, 270-271, 601-604`).

New: one key **per kind**, `job:<kind>:state`, holding `{ v: 1, startedAt, options, checkpoint? }`. Presence = in progress. Per-kind keys avoid the read-modify-write race a combined key would have between two writers.

Back-compat, both directions:
1. **Read** — `readDurableJob('trip-scan')` falls back to the legacy pair when the new key is absent, synthesizing `{ v: 1, startedAt }`. A user mid-scan when the OTA lands resumes normally.
2. **Clear** — also writes `scan_in_progress = 'false'`. Without this, an upgrade → finish → rollback leaves a permanently-true legacy flag and a scan that resumes forever.
3. **Write** — dual-write for `trip-scan` for one release. Delete next release with a TODO naming it.
4. `clearPhotoCache` (`photoCacheDb.ts:649-662`) gains `DELETE ... WHERE key LIKE 'job:%'`. Do **not** delete `quiz_draft_state` (KTD7 resumability).

### Resume gates

The seven gates in `photoScanResume.ts:46-142`, classified:

| Gate | Scope | Note |
| --- | --- | --- |
| Await pending cancel | universal, per-kind | |
| Already running | universal, **extended** | also skip when any other kind runs (mutual exclusion) |
| Durable flag present | universal | per-kind read |
| Staleness | universal, **per-kind threshold** | trip-scan 60min (unchanged); quiz-build **30min** — the whole build is minutes, so an hour-old record is certainly dead |
| MediaLibrary permission | universal | same copy both kinds |
| Home country + hydration defer | **trip-scan only** | quiz reads home country as a *deprioritization* signal only (`quizCreation.ts:265` catches to null); a missing one must never fail a quiz resume |
| Subscription + hydration defer | **trip-scan only** | `FREE_LIMITS` has no quiz entry — the quiz is deliberately ungated. Make this an **explicit omission with a comment naming `FREE_LIMITS`**, not a default-off, so adding a gate later is a conscious act |

Two new **quiz-only** gates:
- **Authenticated session** — the build POSTs `/quiz` and `/quiz/{id}/upload-urls`. Defer if the auth store hasn't hydrated; clear+fail with no session. Mirror the `?? false` hydration-defer pattern at `photoScanResume.ts:95,113`.
- **Draft still exists** — if `loadDraftState()` is null but the checkpoint has a `quizId`, the draft was deleted from My Quizzes. Clear+fail rather than resume into an inevitable 404 chain.

`detectStuckScan` → `detectStuckJobs()`, per-descriptor threshold. Both 5 min — but quiz-build's is **only safe if** `runOneHuntPass` heartbeats at every pass boundary and the upload loop heartbeats after each PUT (`quizUpload.ts:100`). A single `classifyBatch` runs near a minute.

`useAppStateTracking.ts:175-180` becomes one staggered entry calling `tryResumeJobs()` then `detectStuckJobs()` — per-frame budget unchanged. Line 184's `performBackgroundPhotoSync` stays.

---

## Part B — Quiz becomes a durable job

### New quiz-side files

| File | Contents |
| --- | --- |
| `src/services/quiz/quizBuildJob.ts` | Registers the `quiz-build` descriptor; owns the module-level outcome ref and `consumeQuizOutcome()` (same contract as `photoScanService.ts:151-158`). |
| `src/services/quiz/quizCheckpoint.ts` | `{ quizId, pickAssetIds[], passes, sentCount, budgetRemaining, stage }` + `rehydrateLedger(checkpoint, poolById)`. |
| `src/services/quiz/quizPoolSetup.ts` | Extracted from `quizCreation.ts:262-418`. |
| `src/services/quiz/quizHuntLoop.ts` | Extracted from `quizCreation.ts:432-560`, restructured as `runOneHuntPass(ctx, state)` so the **runtime** owns the `while`. |
| `src/services/quiz/quizTripContinuation.ts` | Part C. |
| `src/hooks/useQuizBuildJob.ts` | Replaces `useCreateQuiz`. |
| `src/hooks/useKeepAwakeWhile.ts` | Lazy-require keep-awake extracted from `useScanLifecycle.ts:90-103`, tagged by job kind. The quiz has none today. |

`quizCreation.ts` drops from 630 → ~190 (step sequencer + `restartAfterDraftGone` + entry points). `useQuizzes.ts` drops `useCreateQuiz` (103-121).

**The load-bearing insight:** the *expensive* quiz state is already durable. `recordVerdicts` persists classification results to `photo_quiz_verdicts`; `saveDraftState` persists the server draft id; `quizUpload.ts:99` persists per-photo upload progress. And `pickLedger.offer()` (`pickLedger.ts:69-144`) is deterministic against the growing `picks` prefix, so an **ordered list of accepted asset ids replayed through `offer()` reconstructs the exact ledger** — no serializer needed. The checkpoint is ~1KB of scalars. Only the cheap coordination state is missing today.

### Screen rewiring

The screen becomes a **view onto** a running job rather than its owner.

- `QuizCreationScreen.tsx:181` `abortRef` — **deleted**.
- `:326-330` unmount abort — **deleted**. This is the whole point.
- `:251-265` `createQuiz.mutate({ onProgress, signal })` → `job.start()`. No callbacks: progress lands in the store, outcome on the module ref.
- `handleCancel` (`:344-348`) → `cancelJob('quiz-build')`, which aborts and clears the durable record but **does not** call `clearDraftState` (KTD7 preserved).
- `handleClose` (`:357-363`) changes meaning — mid-build, X now means *leave it running*. A "Stop building" option moves behind an Alert, generalizing the existing `src/screens/photos/cancelScanConfirmation.ts`. **Ship this before or with the ownership move** — without it there's no escape from a stuck build.
- `signal` checks at `quizCreation.ts:246,260,443,524,555` and `quizUpload.ts:77` become `ctx.signal`. `ensureFreshLibrary`'s signal forwarding (`photoBackgroundSync.ts:203-207`) is unchanged — it already converges external and internal aborts.

**Reattach** — the pre-flight effect (`:271-323`) gets a new first branch, before the permission check:

```ts
if (libraryJobStore.jobs['quiz-build'].phase !== 'idle') {
  setPhase(mapJobPhaseToScreenPhase(...));
  preflightRef.current = true;
  return;  // no draft pre-flight, no mutation
}
```

`progress` stops being screen state and becomes a store selector — the grid, hero, counter and one-meter math (`:385-407`) render unchanged. `pickUris` keeps its append-only contract. A user who leaves at 4 finds and returns sees 7.

**Terminal outcome, two paths:**
- *Screen attached* — `useQuizBuildJob` sees `completed && hasResult`, calls `consumeQuizOutcome()` gated on `useIsFocused` (same double-consume guard as `usePhotoScan.ts:107-120`), runs the existing `handleOutcome` switch.
- *No screen attached* — outcome stays on the ref, `resultRoute` holds `{ screen: 'QuizPlay', params: { quizId } }`. **The banner's 30s auto-dismiss (`PersistentScanBanner.tsx:55-62`) must, for `quiz-build`, dismiss the bar without consuming** — otherwise a green flash silently discards a finished quiz. Make `consumeOnDismiss` a per-descriptor flag: `true` for trip-scan (current behavior), `false` for quiz-build.

### Banner

Same 3px hairline, same colors, same mount point (`MainTabNavigator.tsx:111`). Changes:
- Reads `selectActiveJob` = the running job, else the most recent terminal one.
- The hardwired `navigate('Passport', { screen: 'PhotoImport' })` (`:70-72`) becomes `descriptor.bannerRoute(slice)`: trip-scan → unchanged; quiz-build running/failed → root `QuizCreation`; quiz-build completed → `resultRoute`.
- **Navigation risk:** `QuizCreation`/`QuizPlay` are **root stack** screens (`RootNavigator.tsx:80`) while the banner holds a *tab* navigator's `navigation` prop. Use `getParent()` or pass root navigation explicitly. Do not assume the tab navigator resolves `QuizCreation`.
- Add `'scan_banner'` to `QuizEntryPoint` (`src/navigation/types.ts:17-24`) so the funnel separates banner returns from the five existing doors.
- No new hide rule needed — `QuizCreation` is a root-stack screen the banner can't cover anyway.

### The BGProcessingTask seam

The **runtime**, not the job body, owns the `while`:

```ts
interface JobRunContext {
  signal: AbortSignal;
  heartbeat(): void;
  emit(progress: JobProgress, detail?: unknown): void;
  shouldYield(): boolean;              // PHASE 1: always false
  saveCheckpoint(c: unknown): Promise<void>;
}

// runtime step loop
let c = durable.checkpoint ?? descriptor.initialCheckpoint();
for (const step of descriptor.steps) {
  while (!step.isDone(c)) {
    if (ctx.signal.aborted) return 'cancelled';
    c = await step.run(ctx, c);
    await ctx.saveCheckpoint(c);
    ctx.heartbeat();
    if (ctx.shouldYield()) return 'suspended';
  }
}
```

`shouldYield()` returning constant `false` makes phase 1 behaviorally identical to today's straight-line code. Phase 5 supplies a `shouldYield` backed by the BGTask `expirationHandler` and registers a task calling `tryResumeJobs({ trigger: 'bg-task' })`. **No job body changes.** Document this in `jobRuntime.ts`'s header.

**Quiz steps:** `resume-draft` (`quizCreation.ts:221-232`) → `refresh` (`:239-259`) → `pool` (`:262-418`) → `draft` (`:420-430`) → `hunt-pass` ×N (`:473-554`) → `settle` (`:566-619`) → `upload` (`quizUpload.ts:62-110`) → `trips` (Part C). Resume of `hunt-pass` re-runs `pool` (cheap — it re-seeds from `photo_quiz_verdicts` via `seedFromVerdicts`, which is what makes prior classification free), then replays `checkpoint.pickAssetIds` through `offer()`. Bench is intentionally not persisted — worst case a thinner relaxation, never a wrong pick.

**Trip-scan steps in phase 1:** wrap `runScan` as a **single** step plus the existing three heartbeats. Chunking the extract loop is a natural follow-up (it already batches at `INCREMENTAL_CACHE_BATCH = 500`) but must not be in the same PR.

---

## Part C — Keep the trips promise

`src/services/quiz/quizTripContinuation.ts`, run as the `trips` step **after** the outcome is published — so `navigation.replace('QuizPlay')` is never delayed by segmentation.

It does **not** start a `trip-scan` job (that would re-extract a library the `refresh` step just refreshed). It runs the light path only, mirroring `photoScanService.ts:455-499`:

```
getAllCachedPhotos() → segmentTripsFromCache(photos, homeCountry)
  → getClusterSplitsForParents + getAllSavedPhotoIds
  → applyPersistedSplits + applySavedPhotoFilter
  → rankTripSegmentPreviews → saveTripSegments → void maybeRunTaggingPass()
```

Guards:
- Skip when `homeCountry` is null (segmentation without it produces trips full of everyday-life photos).
- Skip when `getTripSegments()` is non-empty **and** `last_import_time` hasn't advanced — otherwise every repeat quiz pays for re-segmenting an unchanged cache.
- Wrap in try/catch: a failure here must never turn a created quiz into a failed job.

Result: `usePhotoTrips.loadFromCache` (`usePhotoTrips.ts:157-170`) takes its fast path — trips have materialized behind the challenge.

---

## Part D — One narrative

### Shared copy module

**New: `mobile/src/constants/scanCopy.ts`** (`@constants/scanCopy`). Precedent exists — `src/constants/trackingPreferences.ts` and `src/utils/authErrors.ts` already hold user-facing strings in `as const` maps. There is no i18n library.

`src/constants/` rather than either screen's folder is the point: putting it under `screens/photos/` or `screens/quiz/` recreates the ownership asymmetry that caused the drift. Anything parameterized (`homeCountryName`, counts, freshness) is an exported **function**, not a template assembled at the call site — call-site assembly is exactly how the two screens ended up with different sentences from the same idea.

```
SCAN_COPY = {
  shared: { privacyTitle, privacyBullets(home), purposeTrips, purposeQuiz,
            leaveHint, resumeHint, scaleLine(total, isFirst), durationLine(total) },
  trips:  { idle*, scanning*, discovery(name) },
  quiz:   { permission*, intro*, workingStatus(step, {isFirstScan}), examinedLine(n), freshness* },
  banner: { label(kind, phase, pct), hint(kind, phase) },
}
```

**Locked vocabulary** — the drift today is mostly synonym drift:

| Concept | Use | Never |
| --- | --- | --- |
| Corpus | your library | camera roll, photos app |
| Operation | scan (first) / check (incremental) | import, sync, index |
| Looked at | checked | examined, processed |
| Selected | found | picked, matched |
| Location | location data | GPS, EXIF, geotag* |
| Locality | on your device | locally, offline |
| Persistence | keeps going while you use the app / picks up where it left off next time you open it | **in the background**, **while the app is closed** |

*`geotagged` survives only in the thin-library rule explanation, where it names a real requirement.

The "background" ban is load-bearing given the hard constraint. **Enforce it as a test, not a convention.**

**New: `src/__tests__/constants/scanCopy.test.ts`**
1. **Banned-phrase sweep** over every string: `/background/i`, `/app is closed/i`, `/minutes? (left|remaining)/i`, `/bottom of the screen/i`, `/camera roll/i`, `/GPS/`, `/import/i`. This is what stops a future contributor writing the closed-app promise.
2. **Symmetry** — both purpose lines mention both payoffs; the privacy bullets name both upload triggers.
3. **Provenance** — `readFileSync` the two screens and assert no occurrence of the old literals (`'Checking for new photos'`, `'photos checked'`, `'bar at the bottom'`, `'Your photos stay private until you share the challenge.'`). Crude, but it's the only mechanism here that catches someone re-hardcoding a string next to an import of the shared one.

**Shared component: `src/components/photos/PrivacyNotice.tsx`** — extract from `IdlePhase.tsx:66-78` + `screenStyles.ts:41-58`, taking `homeCountryName` and a `variant` (cream sheet for quiz, trips screen otherwise). Both doors then render literally the same component, not merely the same words. This is what makes drift structurally hard rather than test-enforced.

### The strings

**Shared**
```
privacyTitle: "Your photos stay private"
bullets:  "• The scan runs entirely on your device"
          "• Only location data from photos taken outside {home} is read"
          "• Nothing is uploaded until you save a place or share a challenge"

purposeTrips: "One scan of your library builds trips from where your photos were
               taken, and unlocks Guess Where challenges."
purposeQuiz:  "One scan of your library picks the photos for this challenge. The
               same scan builds your trips, too — you never have to run it twice."

leaveHint:  "You can keep using the app while this runs. A thin progress line
             stays at the top of the screen."
resumeHint: "If you close the app, the scan pauses and picks up where it left
             off next time you open it."
```

Bullets reorder to **device-first**: the strongest claim leads, and the home-country qualifier reads as detail rather than as a limitation to parse.

**Duration and magnitude** — two facts the current UI conflates. Buckets, never a countdown; the classification step's per-batch latency makes a smooth ETA impossible, and an ETA that slips is worse than none.
```
scaleLine(total, isFirst):
  first:   "About {n} photos to look through. The first pass is the long one —
            after this we only look at what's new."
  refresh: "Only the {n} photos added since your last check."

durationLine(total):
  < 5,000  → "Usually under a minute."
  < 20,000 → "Usually a few minutes."
  else     → "A library this size takes several minutes."
  unknown  → ""   // render nothing rather than guess
```

**The `4,500 of 53,282` problem.** Don't hide the magnitude — break the false denominator. Today the examined line (`QuizCreationScreen.tsx:552-556`) sits directly under the serif `n of m` counter, so it reads as *"you must wait for 53,282."* Three changes:
1. The big counter stays **found photos only** (it already is, `:402-403`). Unchanged.
2. The examined line drops its implied total and gains a purpose clause — **the highest-value string in this plan**:
   ```
   examinedLine(n): "{n} photos checked so far — we stop as soon as your challenge is full."
   ```
   Open-ended "so far" plus an explicit early-exit promise turns a denominator into evidence of thoroughness.
3. Magnitude appears **once, up front** (intro/permission via `scaleLine`), where it's context rather than a wait.

**Quiz permission phase** (`:512-524`)
```
title: "Your Photos, Their Guesses"
body:  "A challenge is built from your own travel photos. One scan of your library
        picks them — and the same scan builds your trips, too."
+ shared <PrivacyNotice />
cta:   "Allow Photo Access"
```
Delete the existing hint at `:519-521` — it's a weaker paraphrase of two bullets. Deleting it is the point: one source, one phrasing.

**Quiz working phase** (`:534-607`) — title stays `"Building Your Challenge"`.
```
workingStatus(step, {isFirstScan}):
  scanning + first:   "Reading your library — this is the one full pass"
  scanning + refresh: "Checking for photos added since last time"
  checking:           "Finding photos that make good questions"
  building:           "Uploading the photos your challenge uses"
```
`isFirstScan` comes from freshness the screen already holds (`:378`). Today `'Checking for new photos'` (`:97`) **lies on a first run** — precisely when the user is most confused about the wait.

Under the counter: `durationLine` during `scanning`; `examinedLine` during `checking`.

Replace the single privacy line (`:601-603`) with two lines (not the full bullets — the working phase isn't a consent moment and they'd crowd the slot grid):
```
"Everything so far has happened on your device. Only the photos your challenge
 uses get uploaded, and only when you share it."
"This same scan is building your trips as it goes."
```
Then `leaveHint + resumeHint` as one paragraph — now honest.

Ghost button: `"Cancel"` → **`"Leave It Running"`** (goBack, no abort) plus secondary text **`"Stop"`** (the existing `handleCancel` path + `markCancelButton()` analytics, behind the Alert).

**Quiz freshness lines** (`:369-380`) — the `never-synced` branch is where "why is it scanning everything" actually gets asked, and today it gets one clause. Three short lines is the right budget for a confirm step with a single CTA:
```
never-synced: "First we scan your library. It runs on your device, and the same
               scan builds your trips, too."
              + scaleLine(total, true) + durationLine(total)
fresh:        "Your photo library is ready — {syncedAgo} — {n} photos. No scan needed."
stale:        "First we check your library for new photos. Usually quick."
```

**Trips idle** (`IdlePhase.tsx`) — shared `<PrivacyNotice />`; `purposeTrips` unchanged; add `scaleLine` + `durationLine` before the tap. Returning-user title `"Import Travel Photos"` (`:81`) → `"Check for New Photos"`: it's the last survivor of the "import" vocabulary, and it currently disagrees with the button directly below it about the verb.

**Trips scanning** (`ScanningPhase.tsx`)
```
title: 'scanning' + incremental → "Checking for New Photos"
       'scanning' + first       → "Reading Your Library"
       'geocoding'              → "Working Out Where They Were Taken"
progress: "{current} of {total} photos checked · {gps} with location data"
hint:     leaveHint + resumeHint  (the same paragraph as the quiz working phase)
```

**Banner a11y** (`:81-99`) — split label (state) from hint (action). Today the label carries "tap for details", which VoiceOver already announces for a `button` role, so it double-speaks.
```
label: trip + scanning → "Photo scan, {pct} percent"
       quiz + scanning → "Building your Guess Where challenge, {pct} percent"
       quiz + completed → "Your challenge is ready"
hint:  trip + completed → "Opens the trips we found"
       quiz + completed → "Opens your challenge to play"
```
Preserve the **exact** trip-scan strings so existing test assertions survive. Throttle the label to 10% steps (`Math.round(pct/10)*10`) — `accessibilityLiveRegion="polite"` currently re-announces on every tick; the visual fill keeps the raw value.

### Dual payoff without taxing the Guess Where user

This is the explicit product concern, so it gets rules rather than just words:

1. **The scan is framed as the price of the challenge, never a favour to trips.** Every quiz-door sentence leads with the challenge, trails with trips as a by-product. Never the reverse, never "while we're at it."
2. **Trips is always phrased as saved work, not added work** — "you never have to run it twice", "as it goes". Same fact as "we'll also build your trips", but that phrasing reads as scope creep.
3. **No trips CTA before the challenge exists.** The working phase gets one *statement*, never a button, link, or count.
4. **The cross-sell is opt-in, dismissible, and appears once.**
5. **No trips vocabulary in quiz failure states.** `thin-library` / `service-error` / `interrupted` (`:609-657`) stay purely about the challenge — someone who just failed to get what they came for must not be offered a consolation prize.

### Cross-sell placement

**Not** in the working phase, a modal, or `QuizPlay` (the play-through is the payoff; nothing competes with it).

`QuizResultsScreen.tsx`, in the footer block (`:481-509`), **below** the primary CTA, as a quiet dismissible row — rendered only when segmentation **completed**, produced ≥1 unreviewed trip, and the row wasn't previously dismissed (persist `quiz_trip_crosssell_dismissed_at` via the `photoCacheDb` metadata helpers).
```
"That same scan also turned up {n} trips you haven't reviewed."
[Review Trips]  [Not Now]
```
`Review Trips` → `PhotoImport` with `skipToSuggestions: true` — `PhotoImportParams` already carries it (`src/navigation/types.ts:130-135`), so the candidate list opens with **no second scan**, which is the promise made good. Render nothing on first paint and fade in if segmentation completes while the user is on screen; append below the CTA, never a layout jump above it.

The **durable, non-dismissible** home is `src/components/passport/PhotoSyncCard.tsx` — add a third state ("scanned, candidates pending review") so the cross-sell has a permanent low-pressure address and the results row can be dismissed forever without losing the trips.

### Two small fixes

**"Bar at the bottom" → fix the copy, keep the bar at top.** The tab bar is `position:absolute; bottom:0` with its own glass container and `paddingBottom: insets.bottom` (`LiquidGlassTabBar.tsx:254-256`); a hairline above it would negotiate the glass radius, home-indicator inset, and every screen's floating actions. The top edge is uncontested, documented, and tested. New copy says *"A thin progress line stays at the top of the screen"* — describing the affordance rather than naming chrome, so a future reposition costs one string.

**Discovery feed: render country names.** `DiscoveredCountry.name` already exists (`types.ts:29-32`) and is discarded at `ScanningPhase.tsx:75`. A bare flag emoji is a poor screen-reader label — VoiceOver announces regional-indicator pairs inconsistently, so `"Found photos from "` + an unannounced glyph reads as a truncated sentence. Render `"Found photos from {name}"`. Add `accessibilityLiveRegion="polite"` to the feed container so finds are announced during the longest wait in the app.

> **Emoji note:** `CLAUDE.md` bans *adding* emojis/icons without permission. `getFlagEmoji` is already used in eight places, so flags are pre-approved here and I am not proposing to extend them. Name-only is the recommendation. If you want the flag kept, the compromise is `"Found photos from {name} {flag}"` with `accessibilityLabel` on the `Text` so the glyph is decorative. **Do not ship flag-only.**

---

## Sequencing

| PR | Contents | Ships via |
| --- | --- | --- |
| **1** | Runtime extraction, **trip-scan only, zero behavior change**. `jobs/*`, `libraryJobStore`, durable compat, `photoScanService`/`photoScanSteps` split, `PersistentJobBanner`, `useAppStateTracking`, delete `photoScanResume`/`photoScanState`. **Atomic** — `isScanRunning` is the shared writer lock. Success criterion: existing scan/banner/lifecycle tests pass with only store-shape edits. | OTA |
| **1.5** | Escape hatch: generalize `cancelScanConfirmation.ts`, add the "Stop building" Alert. **Must precede PR2.** | OTA |
| **2** | Quiz ownership move. Register `quiz-build` (single step, no chunking); screen becomes a view; `useCreateQuiz` → `useQuizBuildJob`; add keep-awake; add the "finishing your library scan first" waiting state. **Win: navigation survival.** | OTA |
| **3** | Chunking + checkpoint + quiz resume gates. Split `quizCreation.ts`; add `quizCheckpoint`. **Win: process survival across suspend.** | OTA |
| **4** | Trip continuation (Part C). | OTA |
| **D** | Copy (Part D). Steps 1-4 below can interleave with the above. | OTA |
| **5** | `BGProcessingTask` driver implementing `shouldYield` + task registration calling `tryResumeJobs`. Additive by construction if PR3's step shape holds. | **new `eas build`** |

**Copy sub-order:** (1) `scanCopy.ts` + its test, no call sites. (2) `PrivacyNotice` extraction. (3) Trips side — lowest risk, narrow tests. (4) Store `jobKind` + banner labels/routing. (5) Quiz side. (6) Cross-sell — **last**, depends on Part C.

**Copy/architecture gates:**
- `"Leave It Running"` requires PR2 landed. Without it the button lies worse than `Cancel` did. The *string* changes can ship independently; the *button* change cannot.
- `"This same scan is building your trips as it goes"` requires PR4. Until then use `"The same scan builds your trips, too"` (promise tense, already true — the cache is shared).
- The `QuizResults` cross-sell row requires PR4. Ship `PhotoSyncCard`'s third state without it.

## Risks

1. **OTA rollback with a live durable record** → mitigated by dual-write + clear-both. Verify by loading the previous bundle on a device with `job:trip-scan:state` set.
2. **Users mid-scan at update time** → the legacy read fallback is the whole reason the durable-flag gate must not simply read the new key.
3. **Double-consume of the quiz outcome** by two mounted screens → reuse the `useIsFocused` gate from `usePhotoScan.ts:83-85,107`.
4. **Quiz latency regression** from mutual exclusion → requires the "finishing your library scan" state in PR2, not later.
5. **Stuck-detection false positives on the quiz** → `classifyBatch` runs near a minute; 5 min is only safe with heartbeats at every hunt pass and upload PUT. Add a test that a slow-but-progressing hunt is never marked stuck.
6. **Analytics continuity** — `photo_import_scan_started/completed/cancelled/failed` and `quizCreationStarted/Failed/Abandoned` must keep firing with identical names and props. The runtime calls **descriptor-supplied hooks**, never a generic `job_*`. Add one new event, `quiz_build_resumed`, to measure whether durability actually saves runs.
7. **Banner navigation across navigators** — root-stack targets from a tab navigator's `navigation` prop. The one real wiring risk; use `getParent()`.
8. **File-size standard** — `photoScanService.ts` (668), `quizCreation.ts` (630), `QuizCreationScreen.tsx` (862) all exceed 500 today. The splits bring all three under; no new file exceeds ~280.

## Verification

**Tests** — new: `jobRuntime.test.ts` (atomic lock before first await; durable record written *before* `'started'` returns; lock released when the durable write throws; generation guard; foreground serializer under rapid double-fire; mutual exclusion + queue drain), `jobDurableFlag.test.ts` (legacy read path, dual-write, clear-both, `job:%` purge), `jobGates.test.ts` (**explicitly asserts the subscription and home-country gates are NOT evaluated for `quiz-build`**), `libraryJobStore.test.ts` (asserts `persist === undefined` — a regression test for a rule that today lives only in a comment), `quizCheckpoint.test.ts` (ledger replay reproduces the identical pick order; resume issues **zero** new `classifyBatch` calls for already-classified ids), `quizTripContinuation.test.ts`, `QuizCreationScreen.reattach.test.tsx` (mount mid-job lands in `working` with the store's `pickUris`; unmount does **not** abort), `scanCopy.test.ts`.

Changed: `photoScanResume.test.ts` → `jobResume.test.ts` (every gate case preserved, parameterized by kind); `PersistentScanBanner.test.tsx` → `PersistentJobBanner.test.tsx` (trip-scan assertions verbatim, plus quiz rows and route mapping); `photoScanService.test.ts`, `useAppStateTracking.test.ts`, `useQuizzes.test.tsx`, `quizCreation.test.ts`, `QuizCreationScreen.test.tsx`, `photoLibrarySyncStatus.test.ts`, `IdlePhase.test.tsx`.

**Pre-commit** (per CLAUDE.md):
```bash
cd mobile && npm run lint && npm run format:check && npm test
npx tsc --noEmit          # per the Jest/Node-20 memory note
```

**On-device pass** (the parts tests cannot cover):
1. Large library (>20k photos), fresh install. Start a challenge → navigate away mid-hunt → confirm the banner shows quiz progress and the build continues.
2. Return via the banner → confirm the screen reattaches with the slot grid already partly filled, not restarted.
3. Background the app mid-hunt, wait past suspension, reopen → confirm foreground resume continues rather than restarting, and that `quiz_build_resumed` fires.
4. Let a challenge complete while on another screen → confirm the banner goes green, tapping opens `QuizPlay`, and that **letting it auto-dismiss does not discard the quiz**.
5. After playing, confirm trips have materialized in Passport with no second scan, and the `QuizResults` cross-sell row appears.
6. Start a quiz during a running trip scan → confirm the wizard shows the waiting state with trip-scan progress, then transitions.
7. VoiceOver pass on the banner and the discovery feed.

---

## Execution status (2026-08-23)

| PR | State | Notes |
| --- | --- | --- |
| **1** Runtime extraction | **Done** (prior session) | `services/jobs/*`, `libraryJobStore`, durable compat, shared writer lock. |
| **1.5** Escape hatch | **Done** (prior session) | Stop-building Alert; X leaves the build running. |
| **2** Quiz ownership move | **Done** (prior session) | Screen is a view onto the job; banner reports both kinds. |
| **3** Chunking + checkpoint | **Done** | See below. |
| **4** Trip continuation | **Done** | `quizTripContinuation.ts`, wired as the `trips` stage. |
| **D** Copy | **Done** except the PhotoSyncCard third state | See "Deferred". |
| **5** BGProcessingTask | **Done, needs `eas build`** | See "Native build required". |
| **6** Trip scan onto the runtime | **Done** | `photoScanStore` + `photoScanResume` deleted. See below. |
| **7** `QuizCreationScreen` split | **Done** | 939 → 284 lines. See below. |

### PR3 — how the checkpointing actually landed

The plan proposed a forward-only `steps: [...]` list. That cannot express the
draft-gone path, which has to jump BACKWARDS to a fresh build. So the quiz is
registered as ONE runtime step wrapping a **stage machine**
(`quizBuildSteps.advanceQuizBuild`), whose stage lives in the checkpoint and
which may return any stage — including an earlier one. The runtime re-enters it
until `stage === 'done'`, checkpointing after every unit, which is the same
yield granularity the step list was for.

`quizCreation.ts` went 630 → ~105 lines and is now one of TWO drivers of that
machine; `quizBuildJob` is the other. Neither contains creation logic, so a
behavioral difference between foreground and resumed builds would be a bug in
one of two small loops rather than in the pipeline.

New: `quizCheckpoint.ts`, `quizPoolSetup.ts`, `quizHuntLoop.ts`,
`quizBuildSteps.ts`. All 39 existing `quizCreation` tests passed **unchanged**
through the refactor, which is the evidence that behavior was preserved.

### PR4 — one deviation from Part C

Trip segmentation is a checkpointed STAGE (`'trips'`), not a fire-and-forget
call after the outcome. It still cannot delay the user: `quizBuildJob` publishes
the completed slice the moment an outcome exists, before the stage runs. Making
it a stage means it survives a suspend and stops on cancel like everything else.

### Native build required (PR5)

`expo-background-task` + `expo-task-manager` added; `'expo-background-task'` is
in `app.config.js` `plugins`. Introspection confirms
`UIBackgroundModes: ['fetch', 'processing']` and
`BGTaskSchedulerPermittedIdentifiers: ['com.expo.modules.backgroundtask.processing']`.

The bundle IS safe to OTA onto the current TestFlight build, but only because
`backgroundJobTask` requires both native modules LAZILY inside a try/catch. A
static import would have thrown at launch on every already-shipped build
(`expo-task-manager` throws when its native module is absent). There is a test
named for that case. The task itself does nothing until the new binary ships.

The copy ban on "background" / "app is closed" **survived** this PR on purpose:
iOS schedules `BGProcessingTask` opportunistically and it may never run, so it
is not something a user can rely on and not something the UI may promise.

### PR6 — trip scan moved onto the runtime

The transitional state is gone. `photoScanService` is now a `JobDescriptor`
whose single step is `photoScanSteps.runScanPass`, and everything it used to
own itself — the atomic start lock, the durable breadcrumb, the generation
guard, the foreground-event serializer, the cancel-in-flight handle — comes
from `jobRuntime`. Its gates are `[mediaLibraryPermission, homeCountry,
subscription]`, which is exactly the classification table above.

Deleted: `stores/photoScanStore.ts`, `services/photoImport/photoScanResume.ts`,
and their two test files. `useAppStateTracking` went from two staggered resume
entries to one. `PersistentScanBanner` reads `selectActiveJob` alone — it no
longer reconciles two phases.

Two things worth knowing:

- **Store phase vocabulary changed.** `'scanning'` is now `'running'`, and
  `'waiting'` exists (a scan queued behind a quiz build). Both the workflow's
  lazy initializer and its mirror effect treat `waiting` as scanning: from the
  screen, the wait IS part of the scan.
- **The legacy durable-flag dual-write STAYS for now.** Retiring it is a
  separate release, not this one: the currently-shipped TestFlight build still
  writes `scan_in_progress`, so both the read fallback and the rollback
  dual-write in `jobDurableFlag` are still load-bearing. The TODO there names
  the release that can delete them.

New tests: `jobResume.test.ts` (every gate case from `photoScanResume.test.ts`,
parameterized across both kinds, plus mutual exclusion and stuck detection) and
`libraryJobStore.test.ts` (asserts `persist === undefined` — a rule that until
now lived only in a comment).

One bug found on the way: `resetAllForUserChange` aborted the runs and cleared
the breadcrumbs but never reset the store, so user B would have seen a bar for
user A's finished job. It now calls `resetLibraryJobStore`.

### PR7 — QuizCreationScreen split

939 → 284 lines, under the standard. Four modules under `screens/quiz/creation/`:
`useQuizCreationFlow` (the nine-state machine, the pre-flight, the handlers and
the build arithmetic), `BuildProgressSheet` (the working phase), 
`quizCreationCopy` (the two computed sentences) and `quizCreationStyles`. The
screen keeps the shell and the confirm/decline sheets. No testIDs moved; the
existing screen tests passed unchanged.

### Deferred

- **PhotoSyncCard third state.** The plan's "durable, non-dismissible home" for
  the trips cross-sell has a slot conflict: `PhotoSyncCard` only renders when
  the user has NOT synced, and `GuessWhereCard` takes the same slot once they
  have. Skipped by decision pending an on-device look at the `QuizResults` row.
- **Legacy `scan_in_progress` dual-write.** See PR6 — one release out.
- **The banner file is still `components/photos/PersistentScanBanner.tsx`.** The
  plan wanted it moved to `components/jobs/PersistentJobBanner.tsx`. It now
  reads only kind-agnostic state, so the rename is cosmetic; left alone to keep
  this diff to behavior.
