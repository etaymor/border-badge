# On-Device Photo Pre-Tagging for Guess Where Quiz Creation

## Context

Guess Where game creation today runs a live "hunt": downscale candidate photos on-device (768px JPEG, ~45% hit iCloud re-materialization retries), send waves of up to 50 to the Gemini Flash Lite eligibility gate (`POST /quiz/eligibility`), and repeat until 10 eligible photos are found. Measured pass rate is ~11%, so a creation typically takes 2–7 waves (each up to ~50s server-side) against a 300-image budget — minutes of waiting with the UI stuck at "n / 10". Two structural problems:

1. **Verdicts are thrown away.** Per-photo eligibility results live only in an in-memory session (`quizClassification.ts`) and are discarded — every game re-pays latency and cost for the same photos.
2. **No quality signal.** Candidate ordering optimizes country/day spread only (`candidateSelection.ts`); among photos that pass the gate there is zero ranking, so a boring parking lot and the Colosseum are interchangeable.

**Approach (all decisions confirmed with Emerson):** add an iOS-only native module using Apple's free, on-Neural-Engine Vision framework to pre-tag photos in the background (scene labels, people prominence, aesthetics/screenshot detection), persist those tags plus the paid Gemini verdicts in SQLite, and use them to pre-rank (and eventually pre-filter) the candidate pool. The Gemini gate **remains the final verdict** — on-device is a pre-filter/ranker. Background tagging runs after each foreground photo sync (budgeted; zero change to the scan path). Release 1 runs in **shadow mode** (rank-only + telemetry; only near-certain drops enabled: screenshots/`isUtility`, people >30% of frame), with hard drops tightened OTA after agreement data confirms near-zero false negatives. The swap flow is in scope. Android degrades gracefully to current behavior.

Expected impact: first-game classification stage from ~50–150s down to ~15–30s (1 wave instead of 2–7), repeat games skip classification entirely (upload-bound, ~10–20s), and visibly better photos via aesthetic + landmark/scenery ranking.

## Verified platform facts

- iOS deployment target 15.1 (`mobile/ios/Podfile:19`); Expo SDK 54 requires Xcode 16, so iOS 18 APIs compile fine behind availability guards.
- Vision APIs: `VNClassifyImageRequest` (iOS 13+, ~1,300-label taxonomy), `VNDetectFaceRectanglesRequest`, `VNDetectHumanRectanglesRequest` (iOS 13+; `upperBodyOnly=false`), `VNCalculateImageAestheticsScoresRequest` → `overallScore` ∈ [-1,1] + `isUtility` (**iOS 18+ only** — re-confirm exact symbol names against the Xcode 16 SDK at implementation time). `VNGenerateImageFeaturePrintRequest` (perceptual dedupe) is noted for v2, not in scope.
- `PHAsset.mediaSubtypes.contains(.photoScreenshot)` — screenshot detection on all iOS versions, no pixels needed.
- `PHImageManager.requestImage` with `isNetworkAccessAllowed=false`, `targetSize≈512`, `.highQualityFormat` serves local thumbnails even for iCloud-offloaded originals (sidesteps the 45% prep-failure problem). Nothing local → `PHImageResultIsInCloudKey` → recorded as status `no-local-image`, not a failure.
- SDK 54 autolinks local Expo modules in `mobile/modules/<name>/` — no config plugin needed (the share-extension plugin exists only because it needs a separate Xcode target). Requires pod install + dev-client rebuild; **not OTA-shippable**, so the module ships inert and all behavior is controlled from TS.

## 1. Native module — `mobile/modules/photo-tagger/` (new)

```
mobile/modules/photo-tagger/
  expo-module.config.json      # { "platforms": ["apple"], "apple": { "modules": ["PhotoTaggerModule"] } }
  index.ts                     # requireOptionalNativeModule + Platform guard
  src/PhotoTagger.types.ts
  ios/PhotoTagger.podspec
  ios/PhotoTaggerModule.swift
```

TS surface:

```ts
interface NativePhotoTag {
  id: string;                       // PHAsset localIdentifier == cached_photos.id
  status: 'ok' | 'no-local-image' | 'not-found' | 'error';
  isScreenshot: boolean;
  faceCount: number; maxFaceArea: number; totalFaceArea: number;      // normalized bbox fractions
  humanCount: number; maxHumanArea: number; totalHumanArea: number;
  labels: Array<{ identifier: string; confidence: number }>;          // top 10, conf >= 0.05
  aestheticScore: number | null;    // iOS 18+ else null
  isUtility: boolean | null;        // iOS 18+ else null
}
isPhotoTaggerAvailable(): boolean;                                    // false on Android/old builds
photoTaggerCapabilities(): { aesthetics: boolean; osMajor: number; lowPower: boolean };
tagPhotos(assetIds: string[]): Promise<NativePhotoTag[]>;
```

Design rules:
- **Native returns raw signals only; all interpretation/thresholds live in TypeScript** — OTA-tunable and Jest-testable; the native module should almost never need another build.
- Batches of ≤32 ids per call (small bridge payloads, abort points between chunks, bounded native memory).
- Swift: one background queue, concurrency 2 (Vision already uses ANE; more risks thermal pressure), `autoreleasepool` per asset, one `VNImageRequestHandler` performing all requests in a single `perform([...])` so the decode is shared. Per-asset failures land in `status`; a batch always resolves.
- iOS < 18: aesthetics fields null; `isScreenshot` + document/text labels stand in for `isUtility`.

## 2. Persistence — two new tables in `photos.db`

Add to `initSchema()` in `mobile/src/services/photoImport/photoCacheDb.ts` (plain `CREATE TABLE IF NOT EXISTS`, matching existing style). Separate tables, not columns on `cached_photos` — different lifecycle, keeps hot scan-path writes untouched.

```sql
CREATE TABLE IF NOT EXISTS photo_ml_tags (
  id TEXT PRIMARY KEY NOT NULL,
  tagger_version INTEGER NOT NULL,      -- native signal-set version; bump => re-tag
  status TEXT NOT NULL,
  is_screenshot INTEGER NOT NULL,
  face_count INTEGER, max_face_area REAL, total_face_area REAL,
  human_count INTEGER, max_human_area REAL, total_human_area REAL,
  labels_json TEXT,                     -- top-10 [{i,c}]; lets TS re-derive OTA without re-tagging
  aesthetic_score REAL, is_utility INTEGER,
  computed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photo_ml_tags_version ON photo_ml_tags(tagger_version);

CREATE TABLE IF NOT EXISTS photo_quiz_verdicts (
  id TEXT PRIMARY KEY NOT NULL,         -- asset id (client-only; server never sees asset ids)
  eligible INTEGER NOT NULL,
  reason TEXT,                          -- server rejection reason, null when eligible
  landscape TEXT,                       -- needed to rebuild picks without re-classifying
  classifier_version TEXT NOT NULL,     -- e.g. 'gemini-2.5-flash-lite/v1'; bump to invalidate
  classified_at INTEGER NOT NULL
);
```

New access layer **`mobile/src/services/photoImport/photoTagDb.ts`** (uses `getDb()`, mirrors photoCacheDb's batched-parameter style): `upsertTags`, `getTagsForIds`, `getUntaggedIds` (load `SELECT id, tagger_version` into a Map once per pass), `upsertVerdicts`, `getAllVerdicts`, `getTagCoverageStats`.

Lifecycle:
- Derivation thresholds are computed at read time from `labels_json` — retuning ships OTA with zero re-tagging. Only Swift output changes bump `TAGGER_VERSION`.
- `status='no-local-image'` rows retry at most every N days (iCloud thumb availability changes).
- Wire both tables into `clearPhotoCache()` (photoCacheDb.ts:490) and into the cached-photo removal path so deleted photos drop their rows.

## 3. Background scheduler — `mobile/src/services/photoImport/photoTaggingService.ts` (new)

Follows the `photoBackgroundSync.ts` pattern exactly: module-level lock + AbortController + generation id, dynamic `import()`s off the boot path, never throws.

**Triggers** (fire-and-forget `void maybeRunTaggingPass()`):
1. End of `performBackgroundPhotoSync()` success path in `photoBackgroundSync.ts` (primary — confirmed decision).
2. End of a successful scan in `photoScanService.ts` (covers the initial big import).
3. On-demand accelerated burst from quiz creation (Section 4).

**Gates:** photo permission already granted (never prompts), `isPhotoTaggerAvailable()`, `features.enablePhotoTagging`, no scan/sync in progress, last pass ≥10 min ago (`photo_cache_metadata` key `last_tagging_pass_at`), skip when native reports low-power/serious thermal state.

**Pass shape:**
1. Candidate ids in **priority order** — reuse `prepareCandidatePool` + `orderByCountrySpread` from `candidateSelection.ts` with home country deprioritized and `usedAssetIds` from `quizDraftStore`: tag exactly the photos quiz creation would reach for first. Coverage matters long before the whole 10k–50k library is tagged.
2. Filter to untagged/stale-version via the id Map.
3. Chunks of 32 through `tagPhotos()`, upsert after each chunk (the table IS the resume watermark), `setTimeout(16)` yield between chunks (repo convention).
4. Budget: stop at **400 photos or 60s wall clock or abort**, whichever first.
5. A starting scan calls `abortTaggingPass()` (add alongside existing `abortBackgroundSync()` call sites). Zero code on the scan path changes — scan speed untouched.

## 4. Quiz-creation integration

### 4a. Pure signal logic — new `mobile/src/services/quiz/tagSignals.ts`

- `deriveSignals(row): TagSignals` — `peopleProminence` (max of `maxHumanArea`, `maxFaceArea × ~6`, capped at 1), `outdoorScore` (curated outdoor-label confidences minus indoor/food/document), `categoryGuess`, `utilityLikely` (isUtility || screenshot || strong document/text labels), `qualityScore` (aesthetic; neutral default when null).
- `classifyPrefilter(signals): 'drop' | 'likely' | 'unknown' | 'marginal'`.

### 4b. `candidateSelection.ts` changes (stay pure/synchronous; tags attached by caller)

- `QuizPhotoCandidate` gains optional `tags?: TagSignals`.
- `iterateCountrySpread` segments gain a quality tier: within each existing freshness segment, order `likely` → `unknown` → `marginal`. Untagged candidates all land in `unknown` → **byte-identical ordering to today when no tags exist** (regression-locked by tests).
- `orderByDaySpread`: within a day, pick the highest-`qualityScore` photo as the representative instead of the arbitrary chronological one — the cheap "better photos" lever.
- `pickQuizPhotos`: unchanged; the improved ordering flows through.

### 4c. `quizCreation.ts` orchestration

After `prepareCandidatePool`:
1. Bulk-load both tables into Maps; decorate the pool; drop `classifyPrefilter === 'drop'` candidates (counted in the funnel log).
2. **Seed from persisted verdicts:** stored `eligible=1` (valid `classifier_version`) go straight into `session.eligible` with stored `landscape`; stored `eligible=0` go into `classifiedIds` so no pass re-draws them. If seeding reaches `QUIZ_MAX_PHOTOS`, skip the hunt entirely → repeat creation is upload-bound.
3. **Accelerated burst:** if the ordered first 150 candidates (`FIRST_BATCH_MAX × CANDIDATE_OVERSELECT`) include untagged photos, run a tagging burst on exactly those ids with a hard 10s budget, concurrent with the `POST /quiz` draft call; misses degrade to `unknown`.
4. Hunt loop otherwise unchanged, drawing from the filtered, tag-ranked pool.

### 4d. Verdict persistence — `quizClassification.ts` + new `mobile/src/services/quiz/quizVerdictStore.ts`

In `classifyBatch`, after parsing results: fire-and-forget `upsertVerdicts()` for every non-`error` result (eligible AND ineligible, with reason/landscape). `service_error`/`prepare_failed` write nothing. Protocol-safe: the server never validates per-photo classification at finalize.

**Telemetry feedback loop:** every paid Gemini verdict for an on-device-tagged photo is a free labeled example. Log an aggregate event per creation (`quiz_prefilter_agreement`: pass rate by predicted tier, false-negative estimate from any `likely`-tier rejects). This is how drop thresholds get tightened OTA with real data.

### 4e. Swap flow (in scope — confirmed)

The photo-swap path in quiz play draws replacement candidates the same way; seed it from `photo_quiz_verdicts` so a swap with cached eligible candidates skips classification, and persist any new verdicts it generates through the same `quizVerdictStore`.

## 5. Threshold strategy (false negatives are THE risk)

Ranking does the work; hard drops are reserved for near-certainties. A wrongly-ranked photo costs nothing (Gemini still sees it, later); a wrongly-dropped photo is invisible forever.

**Day-one hard drops (only these):** `isScreenshot`, `isUtility === true`, `peopleProminence > 0.30` (person ≥30% of frame is unambiguously the subject; the server's own criterion is prominence, so small figures in landscapes stay in).

**Rank tiers (aggressive is fine):** `likely` = no faces/humans, positive outdoorScore, scenery/landmark/building-ish labels. `marginal` = strong food/document/indoor evidence or people prominence 0.10–0.30. `unknown` = everything else including untagged.

**No indoor/food drops in v1** — those are `marginal` (classified last, not never). Tighten OTA after 1–2 weeks of `quiz_prefilter_agreement` data shows ~0 false negatives.

## 6. Rollout / kill switches

- `mobile/src/config/features.ts` gains three flags (existing pattern): `enablePhotoTagging` (background passes), `enableTagPrefilter` (ranking + drops in creation), `enableVerdictCache` (seed/skip from persisted verdicts). Three because they fail differently.
- Module absent (Android, old binaries) → `isPhotoTaggerAvailable()` false → scheduler no-ops, all candidates `unknown`, creation identical to today. TS can therefore merge and OTA-ship **before** the build containing the native module rolls out.
- Sequence: (1) ship native module + tagging + verdict persistence, shadow-mode ranking + telemetry (drops limited to the day-one near-certainties); (2) enable/tighten drops OTA once telemetry confirms.

## 7. Testing

- **Jest (bulk):** `tagSignals.test.ts` (derivation + threshold table); extend `candidateSelection.test.ts` (untagged pool ordering byte-identical to today — regression lock; tagged pools produce tier ordering; day representative = highest quality); `photoTagDb.test.ts` (photoCacheDb test conventions); `photoTaggingService.test.ts` with native wrapper mocked (budget stop, chunk commits, abort mid-pass, version-bump re-tag, priority order); `quizCreation` additions (verdict seeding skips classification; drops counted; verdicts persisted after batch). Add the native mock to `jest.setup.js` next to existing expo mocks.
- **Native:** lightweight XCTest for bbox→area math and the iOS-18 availability branch if convenient; otherwise a dev-only diagnostic surface behind `showDebugInfo`: tag-coverage counts + a sample grid of likely/marginal/drop photos for human eyeball of thresholds on a real library. That eyeball pass is the single highest-value test here.
- **Manual perf:** time a 400-photo pass on an A13-class device (no jank/thermal); confirm scan wall-time unchanged; confirm a repeat-game creation skips classification.

## 8. Expected impact

- Tagging throughput ~15–30ms/photo at 512px → priority-ordered top ~2,000 quiz-likely candidates covered within a handful of foreground sessions.
- First game: pass rate ~11% → est. 30–50% among tag-ranked candidates → typically 1 wave; classification stage ~50–150s → ~15–30s.
- Repeat games: verdict cache + used-asset ledger → usually zero classification, upload-bound ~10–20s.
- Cost: ~50–70% fewer paid calls first game, ~100% fewer on repeats (already tiny; the win is latency). Photo quality: aesthetic-ranked day representatives + landmark/scenery bias (full effect on iOS 18+; older iOS still gets people/utility/outdoor gains).

## 9. Risks / watch items

1. **`no-local-image` rate is the key unknown** — if "Optimize iPhone Storage" evicts even 512px thumbs at scale, coverage shrinks. Instrument the rate in release 1 before considering allowing network access.
2. DB growth: 50k × ~400B ≈ 20MB worst case for `photo_ml_tags`; cap labels at top-5/conf≥0.1 (~10MB) if needed.
3. Aesthetics API exact symbol name must be re-confirmed against the Xcode 16 SDK during native work.
4. v2 (noted, not in scope): `VNGenerateImageFeaturePrintRequest` perceptual near-duplicate collapse; Android parity via ML Kit.

## Implementation sequence

1. Schema + `photoTagDb.ts` + Jest (no behavior change; merges first).
2. Native module `mobile/modules/photo-tagger/` + TS wrapper + jest mock (inert; needs dev-client rebuild).
3. `tagSignals.ts` + `candidateSelection.ts` tiering behind `enableTagPrefilter` (untagged path byte-identical).
4. `quizVerdictStore.ts` + `classifyBatch` persistence + `quizCreation.ts` seeding/attach/burst behind `enableVerdictCache` (+ swap-flow seeding).
5. `photoTaggingService.ts` + triggers in `photoBackgroundSync.ts`/`photoScanService.ts` behind `enablePhotoTagging`.
6. Telemetry + dev diagnostic grid; ship shadow mode; tune OTA.

## Critical files

Modify: `mobile/src/services/quiz/candidateSelection.ts`, `quizCreation.ts`, `quizClassification.ts`; `mobile/src/services/photoImport/photoCacheDb.ts`, `photoBackgroundSync.ts`, `photoScanService.ts`; `mobile/src/config/features.ts`; `mobile/jest.setup.js`.
Create: `mobile/modules/photo-tagger/*`, `mobile/src/services/photoImport/photoTagDb.ts`, `photoTaggingService.ts`, `mobile/src/services/quiz/tagSignals.ts`, `quizVerdictStore.ts`.
