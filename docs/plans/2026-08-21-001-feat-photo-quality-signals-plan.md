---
title: Photo Quality Signals - Shared Layer and Surface Integrations - Plan
type: feat
date: 2026-08-21
revised: 2026-08-21 (simplification pass - see Review Notes)
status: draft
source_research: Atlasi photo-quality-signals research memo (2026-08)
---

# Photo Quality Signals — Shared Layer and Surface Integrations

## Goal Capsule

- **Objective:** Turn the quiz-only photo tagger into an app-wide photo quality
  signal layer, add the free signals we are currently ignoring (user intent,
  capture context), and use them on three surfaces: Guess Where selection,
  photo-import vision selection, and best-photo auto-curation. A final phase
  adds a MobileCLIP embedding for semantic signals the Vision taxonomy cannot
  express.
- **Scope anchor:** Detection, labeling and ranking of photos already in the
  user's library. No capture flow, no editing, no server-side image storage
  changes, no backend API changes in Phases 1–3.
- **Platform posture:** iOS-first. Everything platform-bound lives behind the
  existing `isPhotoTaggerAvailable()` no-op degradation; timestamp-derived
  signals (dwell, retry count, sun elevation) are pure TS and work everywhere
  `cached_photos` exists. Android parity via ML Kit / LiteRT is explicitly out
  of scope.
- **Release shape:** Five phases, each independently shippable and independently
  killable by feature flag. Phases 1–2 are the "70% of the value" tier and
  require **no new pixel work at all**; Phase 3 is product surface work;
  Phase 4 is the model investment; Phase 5 moves the quiz eligibility gate
  on-device (added as a later addendum — see below).
- **Non-negotiables carried forward:** raw signals in native / all
  interpretation in TS (OTA-tunable, Jest-testable); the paid Gemini gate stays
  the final quiz verdict; hard drops only for near-certainties; no coordinate,
  asset id, place id, or embedding ever leaves the device or appears in
  analytics; NO new UI emojis/icons.

## Context — what exists vs. what the research adds

Already built and reused by this plan (do NOT rebuild any of it):

- `mobile/modules/photo-tagger/` — iOS Vision pass per photo: scene labels,
  face/human boxes, aesthetics + `isUtility` (iOS 18+), screenshot flag. One
  `VNImageRequestHandler.perform([...])` per asset so the decode is shared.
- `photo_ml_tags` + `photo_quiz_verdicts` in `photos.db` (`photoTagDb.ts`),
  background scheduler (`photoTaggingService.ts`), interpretation layer
  (`quiz/tagSignals.ts`), verdict seeding, agreement telemetry
  (`tagAgreement.ts`).
- **Near-duplicate handling** (`candidateSelection.ts`): `isNearDuplicatePair`
  (90s window + 100m radius, same country), transitive
  `collapseNearDuplicates`, swap-picker exclusion via `filterNearDuplicatesOf`,
  plus day and (country, year) diversity passes in `pickQuizPhotos`. BUG-2 is
  **fixed** by this machinery — this plan extends it, it does not replace it.
- Server-side place matcher already consumes dwell and vision category
  (`PLACES_RANK_*_WEIGHT`).

What the research memo adds that we do NOT have today:

1. **Implicit intent signals** — favorites, edits, albums, bursts, deliberate
   capture modes, saved-from-social detection. Free PhotoKit metadata, no
   pixels, and the highest-precision "the user cared" evidence available. We
   currently read none of it (verified: no `isFavorite`/burst/subtype reads
   outside the screenshot check).
2. **Capture-context signals** — dwell-before-shot, retry count, GPS
   speed/altitude, sun elevation. Mostly derivable from data already in
   `cached_photos`; the rest rides free on `PHAsset.location`.
3. **Quality-aware duplicate representatives** — today's collapse keeps the
   *newest* frame of a near-dupe run; with intent + aesthetics we can keep the
   *best* one (favorited > edited > highest quality). A parameter on existing
   code, not new machinery.
4. **A composite quality score** with pool-relative normalization instead of
   raw `aestheticScore` as the only quality lever.
5. **MobileCLIP embedding** — zero-shot semantics (scenic/selfie/food/saved
   meme); the one non-Apple model worth considering, last.

Deliberately deferred from the memo (recorded in "Deferred" below): feature-print
perceptual dedupe, on-device LLM pairwise judging, deselect-trained learned
weights, cross-user postcard centroids, personalization heads, novelty scoring,
backend retry-count ranking, Android parity.

## Architecture principle: one signal layer, many consumers

Today `tagSignals.ts` lives under `services/quiz/` and interprets tags only as
"Guess Where suitability". This plan splits interpretation into:

- `mobile/src/services/photoSignals/` (new) — purpose-agnostic derivation:
  intent flags, capture context, composite quality score. Pure TS, no React,
  no IO except `photoTagDb` reads. The near-duplicate helpers
  (`isNearDuplicatePair`, `collapseNearDuplicates`, `filterNearDuplicatesOf`)
  **move here** from `candidateSelection.ts` (one-time move, quiz imports
  them; their tests move with them) so photo import and curation can reuse
  them without importing quiz code.
- `quiz/tagSignals.ts` — stays as the quiz-specific gate approximation
  (prefilter tiers), now importing the shared derivations instead of owning
  them. Its exported behavior with no new signals present must stay
  byte-identical (regression-locked, same technique as the pretagging plan).

Storage stays in `photos.db` next to its siblings; the one new table wires into
`clearPhotoCache()` and the cached-photo removal path exactly like
`photo_ml_tags`.

---

## Phase 1 — Intent + capture-context signals (free tier)

### 1a. Native metadata pass (zero pixels)

Extend `PhotoTaggerModule.swift` with a second, much cheaper entry point:

```ts
readPhotoMeta(assetIds: string[]): Promise<NativePhotoMeta[]>
interface NativePhotoMeta {
  id: string;
  isFavorite: boolean;                 // PHAsset.isFavorite
  hasAdjustments: boolean;             // PHAssetResource contains .adjustmentData
  subtypes: string[];                  // pano | hdr | live | depthEffect | screenshot
  burstId: string | null;              // PHAsset.burstIdentifier
  burstIsRepresentative: boolean;      // representsBurst / burstSelectionTypes
  sourceUserLibrary: boolean;          // PHAssetSourceType == .typeUserLibrary
  altitude: number | null;             // PHAsset.location?.altitude
  gpsSpeed: number | null;             // PHAsset.location?.speed (m/s, -1 => null)
  inUserAlbum: boolean;                // membership in any .albumRegular collection
}
```

Notes:

- `inUserAlbum` is the only field needing a non-per-asset fetch: enumerate
  user-created `PHAssetCollection`s once per pass and build an id set.
- Metadata-only: no `PHImageManager` call, so a pass covers the whole library in
  seconds, unlike the budgeted pixel pass. This matters because **intent
  changes over time** — a photo favorited next month must be re-read.
- Full EXIF (lens, ISO, digital zoom, 35mm focal length) is NOT in this phase:
  it requires fetching original image data per asset. Altitude and speed come
  free via `PHAsset.location`, which covers the two highest-value context
  signals (viewpoint delta, through-a-vehicle-window). EXIF capture is recorded
  under Deferred with a concrete path if a surface later justifies it.

### 1b. Persistence — `photo_intent_tags` (new table)

Separate from `photo_ml_tags` because lifecycle differs: pixel tags are
write-once-per-version and budgeted; intent tags are cheap, whole-library, and
periodically refreshed.

```sql
CREATE TABLE IF NOT EXISTS photo_intent_tags (
  id TEXT PRIMARY KEY NOT NULL,
  meta_version INTEGER NOT NULL,
  is_favorite INTEGER NOT NULL,
  has_adjustments INTEGER NOT NULL,
  subtypes TEXT,                 -- JSON array, same convention as labels_json
  burst_id TEXT,
  burst_is_representative INTEGER NOT NULL,
  source_user_library INTEGER NOT NULL,
  in_user_album INTEGER NOT NULL,
  altitude REAL,
  gps_speed REAL,
  refreshed_at INTEGER NOT NULL
);
```

Refresh policy: full-library metadata pass at the end of each background photo
sync, throttled to once per 24h (`photo_cache_metadata` key). The scheduler is
the existing `photoTaggingService.ts` — a metadata pass is a second pass type
in the same service, not a new service.

**Known limitation (as shipped):** there is no on-demand refresh. Unlike the
pixel-tag path, `readPhotoMeta` is reachable only from the 24h-throttled sweep,
so photos captured or favorited today read as signal-less for up to a day —
including for a user who imports a trip and immediately curates it, which is
the case the signals are worth most in. Closing it means a targeted
`readPhotoMeta` over the candidate ids at the quiz-creation and curation entry
points; deliberately deferred, not overlooked.

### 1c. Derived context — `photoSignals/captureContext.ts` (pure TS, no storage)

Computed on demand from `cached_photos` rows already in memory for a candidate
set — cheap enough not to persist:

- `dwellBeforeSec` — gap to the previous photo by `creation_time`.
- `retryCount` — photos within a 60s window in the same geohash cell. An
  interest signal feeding the quality score ("the user thought this was worth
  getting right"); it has no other consumer in this plan.
- `sunElevation` — solar elevation from lat/lng + timestamp (20-line local
  formula, no network); exposes `goldenHour` / `night` bands.
- `altitudeDelta` — `photo.altitude − median(altitude of its country +
  local-day group)`, local day approximated from longitude so one morning's
  shooting does not split across UTC midnight; +50m ⇒ viewpoint prior.
- `movingCapture` — `gpsSpeed > ~5.5 m/s` (≈20 km/h) ⇒ through-a-window prior.
- `savedFromSocialLikely` — NOT `sourceUserLibrary`, or dimensions in the
  known social set (1080×1350, 1080×1920, 1080×1080) with no capture subtypes.
  **Down-rank only in v1, never a hard drop** — false positives here would be
  silent and invisible, the exact failure mode the pretagging plan's threshold
  strategy forbids.

### 1d. Composite quality score — `photoSignals/qualityScore.ts`

The memo's §7 weighted sum, adapted to what we have:

```
quality = w1·aestheticRank + w2·intent + w3·context
intent  = capped sum of favorite / edited / in-album / burst-representative
context = goldenHour + altitudeDelta bonus + retry interest
          − movingCapture − savedFromSocial
```

- **Normalize `aestheticScore` within the pool being ranked** (rank position
  among the candidates at hand), not against a persisted whole-library
  distribution. Raw −1..1 values are not comparable across libraries and the
  range is undocumented; pool-relative rank compares like with like (same
  trip, same country pool) and needs zero caching infrastructure.
- **One scoring function, not per-purpose profiles.** Surfaces differ in how
  they *use* the score (quiz: tie-break within tiers; vision pick: choose
  among near-centroid frames; curation: sort), not in what "a good photo"
  means. A per-purpose weight table is speculative config — add a profile only
  when telemetry shows two surfaces genuinely disagree.
- Photos with `status != 'ok'` or missing tags stay exactly neutral — an
  iCloud-offloaded photo is never penalized for being offloaded (existing
  invariant, keep it).

## Phase 2 — Generalize the existing near-duplicate collapse

No new tables, no native work, no feature prints. The timestamp+distance
collapse in `candidateSelection.ts` already solves grouping; what it lacks is
quality awareness and reuse outside quiz.

- Move `isNearDuplicatePair` / `collapseNearDuplicates` /
  `filterNearDuplicatesOf` to `photoSignals/nearDuplicates.ts` (pure move;
  quiz re-imports; tests move with them).
- `collapseNearDuplicates` gains an optional `representative` comparator.
  Default: newest frame (today's behavior, so all existing call sites are
  unchanged). With signals loaded: favorited > edited > highest quality —
  the memo's "survived the cull" and "burst pick" signals expressed as a sort,
  plus `burst_id` equality as an additional pairing criterion when intent tags
  are present (catches bursts that drift past the 100m GPS radius).
- Known limitation, accepted: a re-save or edited copy appearing hours later
  is not caught by a time-window collapse. That is what feature-print
  embeddings would buy, and the day-diversity pass already prevents the
  user-visible symptom (two lookalikes in one quiz). Feature print stays
  Deferred until a real recurrence, not a hypothetical, justifies a
  whole-library re-tag and blob management.

## Phase 3 — Surface integrations

### 3a. Guess Where (quiz)

- `tagSignals.deriveSignals` consumes intent + context: `savedFromSocialLikely`
  and `movingCapture` push to `marginal`; the composite quality score replaces
  raw `aestheticScore` in the existing `orderByDaySpread` tie-break
  (`candidateSelection.ts:336`) — same hook, richer input.
- Duplicate collapse picks the best frame instead of the newest (Phase 2
  comparator; one-argument change at the existing call sites).
- Existing invariants preserved: untagged library ⇒ byte-identical ordering;
  hard drops stay exactly the current three (screenshot, `isUtility`, people
  ≥30%) until `tagAgreement` telemetry justifies more.
- Free extra: `photo_quiz_verdicts.landscape` + quality rank give an
  easy/medium/hard difficulty *label* for later product use — recorded as an
  enabler, no UI in this plan.

### 3b. Photo import vision selection (client-only)

`selectRepresentativePhotos` (`visionPhoto.ts`) becomes signal-aware via an
optional tags map argument (stays a pure function; caller loads tags): keep the
closest-to-centroid anchor, but run the candidates through
`collapseNearDuplicates` first and fill the remaining slots by quality — never
send two frames of the same burst to Gemini, never send the blurry retry when
a better frame of the same moment exists. Untagged clusters ⇒ current behavior
byte-identical.

No backend change in this phase. (Sending a retry-count signal to the place
matcher is Deferred: it adds API surface for a weight we cannot tune until
labeled diagnostic data containing it exists.)

### 3c. Auto-curation ("best photos")

New query layer `photoSignals/bestPhotos.ts`:
`getBestPhotoIds({ clusterId | segmentId | countryCode, limit })` — quality
rank, one per dupe group, screenshots/utility excluded. Two wiring targets in
this plan, chosen because both already have a photo-choosing code path to swap:

1. `cached_trip_segments.preview_uris` selection (Photo Trips cards) — pick
   best instead of first.
2. `PhotoGalleryModal` / cluster photo pickers — "best first" default sort,
   chronological toggle retained.

Entry-attach suggestions and passport/country thumbnails are natural follow-ups
once the layer proves itself; they are follow-up work items, not part of this
plan's scope.

Explicit non-change: the quiz share card and link-unfurl **no-personal-photos
privacy rule stays** (`QuizChallengeVariant.tsx`); curation applies only to
photos the user is already choosing among inside the app, and to media they
explicitly upload. No auto-publishing of anything.

## Phase 4 — MobileCLIP embedding (decide after Phases 1–3 ship)

The one non-Apple component. Scoped to the lean core; commit only if the
Phase 1–3 telemetry shows semantic misses that metadata cannot fix (e.g.
saved-meme photos surviving the dimension heuristic, scenic misranking).

- **Model:** MobileCLIP2-S0 image encoder as Core ML, delivered by on-demand
  download (not bundled — keep the binary small; cache in Application Support;
  feature no-ops until present). Runs inside the existing budgeted tagging
  pass, distinct input size from the 512px Vision decode.
- **Text side stays offline:** prompt embeddings for a curated prompt set
  (scenic / landmark / selfie / food / menu-sign / screenshot-or-meme /
  through-a-window / blurry-accident) are precomputed at build time and shipped
  as a JSON asset. No on-device text encoder. Editing the prompt strings =
  regenerate JSON = OTA ship.
- **Storage:** int8-quantized 512-d embedding (~0.5KB/photo) in a new
  `photo_clip_embeddings` table, written only for photos the priority order
  actually reaches (same budget discipline as pixel tags).
- **Consumer:** zero-shot scores join the quality feature vector; embeddings
  never leave the device.
- **Explicitly split out as a separate go/no-go:** landmark recognizability
  (server text-encodes "a photo of {POI name}") requires deploying the CLIP
  text encoder server-side — real infra with one consumer. It is Deferred, not
  bundled into this phase.

## Phase 5 — On-device eligibility gate (Apple Foundation Models)

Product decision (Emerson, 2026-08-22): migrate the paid Gemini quiz
eligibility gate to Apple's on-device Foundation Models where the device
supports it. The wins are latency (no network waves during creation), offline
quiz creation, no external API dependency, and photos never leaving the device
— not dollars (current Gemini spend is cents per creation after the prefilter).
Independent of Phase 4; can start as soon as iOS 27 ships.

**The binding constraint is hardware, not OS version.** Foundation Models runs
only on Apple Intelligence-capable devices (iPhone 15 Pro and later), and
image input requires iOS 27. Gemini therefore stays as the fallback gate for
every other device — this is a migration with a shrinking fallback population,
not a replacement.

Staged rollout, one stage per release:

1. **Capability telemetry.** Report `SystemLanguageModel.default.availability`
   (+ image-input support) as a boolean in existing analytics so the capable
   fraction of the real user base is a number, not a guess.
2. **Shadow mode.** On capable devices, FM judges photos that already carry a
   Gemini verdict in `photo_quiz_verdicts` (free labeled data; zero extra paid
   calls) using a `@Generable` struct mirroring the server verdict schema:
   `eligible`, `reason`, `landscape`. Log aggregate agreement — same pattern
   and privacy rules as `tagAgreement`.
3. **Flip primary on capable devices** once agreement is high (threshold set
   from stage-2 data; the false-negative asymmetry rule applies — FM must not
   reject photos Gemini accepts at any meaningful rate). Gemini remains the
   path for non-capable devices and the automatic fallback on FM
   errors/timeouts.

Design rules: **one verdict schema, one `quizVerdictStore`, one downstream
path** — the gate implementation is swappable behind the existing
`classifyBatch` seam, so no consumer knows which model judged a photo
(`classifier_version` records it, e.g. `apple-fm/ios27-v1`). Protocol-safe by
construction: the server never validates per-photo classification at finalize,
so no backend change. Scope: the quiz gate only — the photo-import vision path
(signage OCR feeding place matching) stays on Gemini, where extraction quality
is load-bearing and unproven on FM.

## Rollout / kill switches

`mobile/src/config/features.ts` gains one flag per phase:
`enableIntentSignals`, `enableQualityRanking` (covers Phases 2–3 — one flag,
because they ship as one behavior change per surface), `enableClipSignals`,
`enableOnDeviceGate` (Phase 5).
Same posture as the pretagging rollout: everything ships shadow-first (rank +
telemetry), hard behavior tightens OTA after agreement data. Module-absent /
Android / old-binary ⇒ today's behavior, verified by regression-locked tests.
Note the mechanism: this holds because each consuming surface bails when both
tag tables come back empty, NOT because the signal layer is neutral without
tags. `goldenHour` and `retryCount` derive from cached timestamps and
coordinates alone, so `rankBestPhotos` still scores and reorders a wholly
untagged pool. Any new consumer must carry that same empty-map guard.

## Telemetry (additive, same privacy rule)

- `quiz_prefilter_agreement` gains per-signal columns (pass rate by
  intent/context bucket) so each new signal earns its weight with real verdict
  data before it can gate anything.
- `photo_signal_coverage` per tagging pass: counts of intent-tagged /
  pixel-tagged, metadata pass duration, `no-local-image` rate. Counts and
  ratios only — no ids, no coordinates.
- Curation surfaces log picked-vs-overridden (user chose a different photo than
  our best pick) — the memo's "learn from deselects" raw material, even though
  learned weights are deferred.

## Testing

- Jest, all pure TS: `captureContext` (dwell/retry/sun/altitude tables),
  `qualityScore` (pool-rank normalization, neutral-when-missing),
  `nearDuplicates` (existing tests move; new cases for the representative
  comparator and `burst_id` pairing); extend `candidateSelection.test.ts`
  (no-signals ordering byte-identical — regression lock); `visionPhoto`
  selection with and without tags map; `bestPhotos`.
- Native: extend the dev diagnostic grid (behind `showDebugInfo`) with intent
  badges — the human-eyeball pass is again the highest-value test, especially
  for the saved-from-social heuristic.

## Risks / watch items

1. **Intent staleness** — favorites drift; mitigated by the cheap 24h
   whole-library metadata refresh. Watch pass duration on 50k-photo libraries.
2. **`hasAdjustments` via `PHAssetResource`** — resource enumeration cost per
   asset must be measured in the metadata pass; if slow, drop to
   favorites/subtypes-only for v1.
3. **Saved-from-social false positives** (legit photos at social dimensions) —
   down-rank only, never drop; watch agreement telemetry before hardening.
4. **CLIP model delivery** — on-demand download failure modes (offline first
   run) must degrade silently to Phase 1–3 behavior; version the model file.
5. **iOS-only skew widens** — Android users get timestamp/context signals only.
   Accepted for now; recorded as the trigger to revisit if Android engagement
   with quiz/curation surfaces materially lags.

## Deferred (recorded, not planned)

- **Feature-print perceptual dedupe** — the time-window collapse plus day
  diversity already covers the user-visible cases; revisit only on a real
  recurrence of lookalike dupes it cannot catch.
- **Backend retry-count ranking signal** — needs labeled diagnostic data
  before a weight is tunable; client keeps the signal local until then.
- On-device LLM pairwise judging / flaw tags — Phase 5 migrates the
  eligibility gate; pairwise "which photo is better" ranking and flaw tagging
  remain deferred until the gate migration proves FM quality.
- Learned weights from deselects and per-purpose weight profiles — the
  telemetry to feed them ships in this plan; training does not.
- Landmark recognizability (server-side CLIP text encoder), novelty scoring,
  cross-user postcard/centroid labeling.
- Full EXIF capture (lens/ISO/zoom) — via `CGImageSource` properties on
  original data if a surface ever needs it; expensive, low marginal value now.
- Android parity (MediaStore `IS_FAVORITE`, LiteRT CLIP); Live Photo
  best-frame; HDR gain-map display handling.
- Entry-attach and passport/country best-photo wiring (follow-ups to 3c).

## Sequencing and sizes

| Step | Contents | Size | Ships |
| ---- | -------- | ---- | ----- |
| 1 | `photo_intent_tags` schema + `photoTagDb` additions + Jest | S | merge first, inert |
| 2 | Native `readPhotoMeta` + metadata pass in `photoTaggingService` | M | needs dev-client rebuild; inert until flag |
| 3 | `photoSignals/`: captureContext, qualityScore, nearDuplicates move | M | OTA |
| 4 | Quiz integration (tagSignals consumes shared layer; quality tie-break; best-frame comparator) | S | OTA, shadow |
| 5 | `visionPhoto` signal-aware selection | S | OTA |
| 6 | `bestPhotos` + segment previews + gallery best-first | M | OTA |
| 7 | MobileCLIP go/no-go review, then: model delivery, encoder in pass, embeddings table, zero-shot consumer | L | rebuild |
| 8 | FM gate stage 1–2: capability telemetry + shadow agreement (capable devices, iOS 27+) | M | rebuild |
| 9 | FM gate stage 3: flip primary on capable devices, Gemini fallback retained | S | OTA |

Critical files — modify: `mobile/modules/photo-tagger/ios/PhotoTaggerModule.swift`,
`mobile/src/services/photoImport/{photoTagDb,photoTaggingService,visionPhoto,photoCacheDb}.ts`,
`mobile/src/services/quiz/{tagSignals,candidateSelection}.ts`,
`mobile/src/config/features.ts`.
Create: `mobile/src/services/photoSignals/{captureContext,qualityScore,nearDuplicates,bestPhotos,index}.ts`,
`photo_intent_tags` table (Phase 1), `photo_clip_embeddings` table (Phase 4 only).

## Review Notes (2026-08-21 simplification pass)

Reviewed against the repo's reuse/simplification/efficiency criteria before any
implementation. Changes from the first draft, so the reasoning survives:

1. **Feature-print dedupe phase deleted** (was Phase 2). The first draft claimed
   it "closes BUG-2"; verification showed BUG-2 is already fixed by
   `collapseNearDuplicates` + diversity passes in `candidateSelection.ts`. The
   proposed `photo_dupe_groups` table, exemplar side-table, and
   `TAGGER_VERSION` bump (whole-library re-tag) rebuilt working 50-line code
   with ML infrastructure. Replaced by generalizing the existing collapse.
2. **Backend `retry_count` + `PLACES_RANK_RETRY_WEIGHT` cut to Deferred.** New
   API surface for a default-off weight nobody can tune until labeled data
   exists is speculative plumbing.
3. **Per-purpose weight profiles collapsed to one scoring function.** Three
   hand-tuned profiles with no data distinguishing them is config for its own
   sake.
4. **Persisted aesthetic-percentile distribution cut.** Pool-relative rank at
   scoring time is simpler and compares a photo against the candidates it
   actually competes with.
5. **Curation wiring trimmed 4 → 2 surfaces**; the other two are follow-ups
   once the layer proves itself.
6. **Phase 4 slimmed to the zero-shot core with a go/no-go gate**; the
   server-side text encoder (landmark recognizability) and novelty scoring
   moved to Deferred — each was a heavy dependency with a single speculative
   consumer.
7. **Feature flags 4 → 3** (Phases 2–3 ship as one behavior change).

Addendum 2026-08-22: Phase 5 added by product decision — migrate the quiz
eligibility gate to Apple Foundation Models on capable devices (Apple
Intelligence hardware + iOS 27 image input), shadow-validated against cached
Gemini verdicts, with Gemini retained as the fallback for non-capable devices
and the photo-import vision path. Adds flag `enableOnDeviceGate`.
