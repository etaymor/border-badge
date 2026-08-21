---
title: Photo Quality Signals - Shared Layer and Surface Integrations - Plan
type: feat
date: 2026-08-21
status: draft
source_research: Atlasi photo-quality-signals research memo (2026-08)
---

# Photo Quality Signals — Shared Layer and Surface Integrations

## Goal Capsule

- **Objective:** Turn the quiz-only photo tagger into an app-wide photo quality
  signal layer, add the free signals we are currently ignoring (user intent,
  capture context, near-duplicate structure), and use them on three surfaces:
  Guess Where selection, photo-import vision/matching, and best-photo
  auto-curation. A final phase adds a MobileCLIP embedding for semantic signals
  the Vision taxonomy cannot express.
- **Scope anchor:** Detection, labeling and ranking of photos already in the
  user's library. No capture flow, no editing, no server-side image storage
  changes.
- **Platform posture:** iOS-first. Everything platform-bound lives behind the
  existing `isPhotoTaggerAvailable()` no-op degradation; timestamp-derived
  signals (dwell, retry count, sun elevation) are pure TS and work everywhere
  `cached_photos` exists. Android parity via ML Kit / LiteRT is explicitly out
  of scope.
- **Release shape:** Four phases, each independently shippable and independently
  killable by feature flag. Phases 1–2 are the "70% of the value" tier (metadata
  + one new Vision request); Phase 3 is product surface work; Phase 4 is the
  model investment.
- **Non-negotiables carried forward:** raw signals in native / all
  interpretation in TS (OTA-tunable, Jest-testable); the paid Gemini gate stays
  the final quiz verdict; hard drops only for near-certainties; no coordinate,
  asset id, place id, or embedding ever leaves the device or appears in
  analytics; NO new UI emojis/icons.

## Context — what exists vs. what the research adds

Already built (see `docs/quiz-photo-pretagging-plan.md`, all shipped):

- `mobile/modules/photo-tagger/` — iOS Vision pass per photo: scene labels,
  face/human boxes, aesthetics + `isUtility` (iOS 18+), screenshot flag. One
  `VNImageRequestHandler.perform([...])` per asset so the decode is shared.
- `photo_ml_tags` + `photo_quiz_verdicts` in `photos.db`
  (`photoTagDb.ts`), background scheduler (`photoTaggingService.ts`),
  interpretation layer (`quiz/tagSignals.ts`), verdict seeding, agreement
  telemetry (`tagAgreement.ts`).
- Server-side place matcher already consumes dwell and vision category
  (`PLACES_RANK_*_WEIGHT`).

What the research memo adds that we do NOT have today, in its order of
value-per-cost:

1. **Implicit intent signals** — favorites, edits, albums, bursts, deliberate
   capture modes, saved-from-social detection. Free PhotoKit metadata, no
   pixels, and the highest-precision "the user cared" evidence available. We
   currently read none of it (verified: no `isFavorite`/burst/subtype reads
   outside the screenshot check).
2. **Capture-context signals** — dwell-before-shot, retry count, GPS
   speed/altitude, sun elevation. Mostly derivable from data already in
   `cached_photos`; the rest rides free on `PHAsset.location`.
3. **Near-duplicate structure** — `VNGenerateImageFeaturePrintRequest`. Noted
   as v2 in the pretagging plan; now promoted because it is also the structural
   fix for BUG-2 (duplicate photos within one quiz,
   `docs/quiz-photo-feedback-backlog.md`) and the burst-collapse the backlog's
   "multiple duplicates" report points at.
4. **A composite, rank-normalized quality score** with per-purpose weightings
   instead of raw `aestheticScore` as the only quality lever.
5. **MobileCLIP embedding** — zero-shot semantics (scenic/selfie/food/saved
   meme), landmark recognizability, novelty; the one non-Apple model worth
   shipping.

Deliberately deferred from the memo (recorded in "Deferred" below): on-device
LLM pairwise judging, deselect-trained learned weights, cross-user postcard
centroids, personalization heads, Android parity.

## Architecture principle: one signal layer, many consumers

Today `tagSignals.ts` lives under `services/quiz/` and interprets tags only as
"Guess Where suitability". This plan splits interpretation into:

- `mobile/src/services/photoSignals/` (new) — purpose-agnostic derivation:
  intent flags, capture context, dupe structure, composite quality score with
  per-purpose weight profiles (`quiz`, `visionPick`, `curation`). Pure TS, no
  React, no IO except `photoTagDb` reads.
- `quiz/tagSignals.ts` — stays as the quiz-specific gate approximation
  (prefilter tiers), now importing the shared derivations instead of owning
  them. Its exported behavior with no new signals present must stay
  byte-identical (regression-locked, same technique as the pretagging plan).

Storage stays in `photos.db` next to its siblings; all new tables wire into
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
  subtypes TEXT,                 -- JSON array
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
sync, throttled to once per 24h (`photo_cache_metadata` key), plus the same
on-demand burst quiz creation already uses for pixel tags.

### 1c. Derived context — `photoSignals/captureContext.ts` (pure TS, no storage)

Computed on demand from `cached_photos` rows already in memory for a candidate
set — cheap enough not to persist:

- `dwellBeforeSec` — gap to the previous photo by `creation_time`.
- `retryCount` — photos within a 60s window in the same geohash cell. Interest
  signal (cluster size), not a quality signal.
- `sunElevation` — solar elevation from lat/lng + timestamp (20-line local
  formula, no network); exposes `goldenHour` / `night` bands.
- `altitudeDelta` — `photo.altitude − median(altitude of its trip segment)`;
  +50m ⇒ viewpoint prior.
- `movingCapture` — `gpsSpeed > ~5.5 m/s` (≈20 km/h) ⇒ through-a-window prior.
- `savedFromSocialLikely` — NOT `sourceUserLibrary`, or dimensions in the
  known social set (1080×1350, 1080×1920, 1080×1080) with no capture subtypes.
  **Down-rank only in v1, never a hard drop** — false positives here would be
  silent and invisible, the exact failure mode the pretagging plan's threshold
  strategy forbids.

### 1d. Composite quality score — `photoSignals/qualityScore.ts`

The memo's §7 weighted sum, adapted to what we have per phase:

```
quality(profile) = w1·aestheticPercentile + w2·intent + w3·context (+ later: clip terms)
intent  = capped sum of favorite / edited / in-album / burst-representative
context = goldenHour + altitudeDelta bonus − movingCapture − savedFromSocial
```

- **Rank-normalize `aestheticScore` per library** (percentile against the
  user's own tagged distribution, cached in `photo_cache_metadata`, refreshed
  per tagging pass). Raw −1..1 values are not comparable across libraries and
  the range is undocumented — percentiles are the stable currency.
- Weight profiles per purpose (`quiz` | `visionPick` | `curation`) — one
  feature vector, different weightings, exactly the memo's "per-purpose heads"
  in hand-tuned form. All weights are plain TS constants: OTA-retunable.
- Photos with `status != 'ok'` or missing tags stay exactly neutral — an
  iCloud-offloaded photo is never penalized for being offloaded (existing
  invariant, keep it).

## Phase 2 — Near-duplicate structure (feature print)

### 2a. Native

Add `VNGenerateImageFeaturePrintRequest` to the existing single
`perform([...])` in `tagAsset` — shared decode, one more request. Return the
print as base64 `Data` on the tag payload. Bump `TAGGER_VERSION` (Swift output
changed — this is the legitimate bump case).

### 2b. Grouping in TS, storing groups not prints

Storing prints for a 50k library is ~150MB — unacceptable. Instead
`photoSignals/dupeGroups.ts` groups **within a temporal-spatial neighborhood**
at tag time (bursts and retries are sub-minute, same geohash cell): compare each
newly tagged photo's print against its neighbors' prints from the same tagging
pass plus persisted group exemplars, threshold on Vision's `computeDistance`,
and persist only:

```sql
CREATE TABLE IF NOT EXISTS photo_dupe_groups (
  id TEXT PRIMARY KEY NOT NULL,        -- asset id
  group_id TEXT NOT NULL,              -- stable id of the dupe cluster
  group_size INTEGER NOT NULL,
  role TEXT NOT NULL                   -- 'only' | 'representative' | 'sibling'
);
CREATE INDEX IF NOT EXISTS idx_photo_dupe_groups_group ON photo_dupe_groups(group_id);
```

Representative choice per group: burst representative if flagged, else
favorited/edited member ("survived the cull"), else highest quality score.
Exemplar prints (one per group, transient working set) may be kept in a small
side table capped by count; everything else is discarded after grouping.

- `group_size` doubles as the memo's retry-count **interest** signal where the
  photos are near-identical (distinct-scene retries still come from
  `captureContext.retryCount`).
- Distance threshold is a TS constant; the Swift side only ever returns raw
  prints. Threshold tuning ships OTA; only re-grouping (not re-tagging) is
  needed after a change, because prints are re-derivable for the temporal
  neighborhood being re-grouped. Accepted cost: re-grouping an old
  neighborhood requires re-tagging those assets first.

### 2c. BUG-2 closure

`pickQuizPhotos` / `orderByCountrySpread` gain: at most one photo per
`group_id` in a quiz (siblings excluded at pick time, not deprioritized); the
swap picker excludes groups already present in the quiz. This closes the
near-identical-assets path of BUG-2; the backlog's same-asset guard
verification stays a separate bug task (per CLAUDE.md, a reproducing test comes
first if it turns out to fail).

## Phase 3 — Surface integrations

### 3a. Guess Where (quiz)

- `tagSignals.deriveSignals` consumes intent + context: `savedFromSocialLikely`
  and `movingCapture` push to `marginal`; favorite/edited/in-album and golden
  hour feed the quality tie-break already used by `orderByDaySpread` (line
  `candidateSelection.ts:336`) via the `quiz` weight profile.
- Dupe-group exclusion per 2c.
- Existing invariants preserved: untagged library ⇒ byte-identical ordering;
  hard drops stay exactly the current three (screenshot, `isUtility`, people
  ≥30%) until `tagAgreement` telemetry justifies more.
- Free extra: `photo_quiz_verdicts.landscape` + dupe groups + quality
  percentile give an easy/medium/hard difficulty *label* for later product use
  — recorded as an enabler, no UI in this plan.

### 3b. Photo import / place matching

- `selectRepresentativePhotos` (`visionPhoto.ts`) becomes signal-aware via an
  optional tags map argument (pure function, caller loads tags): keep the
  closest-to-centroid anchor, but fill the remaining slots preferring distinct
  dupe groups and the highest `visionPick` quality — never send two frames of
  the same burst to Gemini, never send the blurry retry when the kept frame
  exists. Untagged clusters ⇒ current behavior byte-identical.
- Send one new optional cluster-level field to `/photos/suggest-places`:
  `retry_count` (max same-scene retries in cluster) as an interest signal the
  ranking mixin can weight alongside dwell. Backend: one optional Pydantic
  field + one optional weight (`PLACES_RANK_RETRY_WEIGHT`, default 0 = off),
  tuned later through the existing offline evaluator. Nothing else server-side
  changes; no coordinates/ids added to any log line.

### 3c. Auto-curation ("best photos")

New query layer `photoSignals/bestPhotos.ts`:
`getBestPhotoIds({ clusterId | segmentId | countryCode, limit })` — quality
percentile via the `curation` profile, one per dupe group, screenshots/utility
excluded. Wire into, in order of visibility:

1. `cached_trip_segments.preview_uris` selection (Photo Trips cards) — pick
   best instead of first.
2. `PhotoGalleryModal` / cluster photo pickers — "best first" default sort,
   chronological toggle retained.
3. Entry photo attach (`EntryFormScreen`) and `useNearbyPhotos` — surface best
   candidates first when suggesting photos for an entry.
4. Country detail / passport surfaces that preview local photos
   (`useCountryPhotoInfo` consumers) — best-photo thumbnail where a photo is
   shown at all.

Explicit non-change: the quiz share card and link-unfurl **no-personal-photos
privacy rule stays** (`QuizChallengeVariant.tsx`); curation applies only to
photos the user is already choosing among inside the app, and to media they
explicitly upload. No auto-publishing of anything.

## Phase 4 — MobileCLIP embedding

The one non-Apple component, added last because Phases 1–3 don't depend on it.

- **Model:** MobileCLIP2-S0 image encoder as Core ML, delivered by on-demand
  download (not bundled — keep the binary small; cache in Application Support;
  feature no-ops until present). Runs inside the existing budgeted tagging
  pass at 256–288px input, distinct from the 512px Vision decode.
- **Text side stays offline:** prompt embeddings for a curated prompt set
  (scenic / landmark / selfie / food / menu-sign / screenshot-or-meme /
  through-a-window / blurry-accident) are precomputed at build time and shipped
  as a JSON asset. No on-device text encoder. Editing the prompt strings =
  regenerate JSON = OTA ship.
- **Storage:** int8-quantized 512-d embedding (~0.5KB/photo) in a new
  `photo_clip_embeddings` table, written only for photos the priority order
  actually reaches (same budget discipline as pixel tags) — ~1–2MB for the
  quiz-relevant head of a big library, not 100MB for all of it.
- **Consumers:**
  - Zero-shot scores join the quality/prefilter feature vector (a second
    opinion on scenic-vs-not and a saved-meme detector that generalizes past
    dimension heuristics).
  - **Landmark recognizability:** backend text-encodes "a photo of {POI name}"
    server-side (one small addition to the suggest-places response or a tiny
    endpoint; embeddings only, never images) → client cosine vs. the photo ⇒
    iconic-view score. Feeds quiz difficulty and curation "hero shot" choice.
  - **Novelty:** nearest-neighbor distance within the user's own stored
    embeddings, as a curation tie-breaker.
  - Embeddings never leave the device; the landmark path ships text embeddings
    down, not image embeddings up.

## Rollout / kill switches

`mobile/src/config/features.ts` gains one flag per phase:
`enableIntentSignals`, `enableDupeGrouping`, `enableQualityCuration`,
`enableClipSignals`. Same posture as the pretagging rollout: everything ships
shadow-first (rank + telemetry), hard behavior (drops, exclusions) tightens OTA
after agreement data. Module-absent / Android / old-binary ⇒ all signals
neutral ⇒ today's behavior, verified by regression-locked tests.

## Telemetry (additive, same privacy rule)

- `quiz_prefilter_agreement` gains per-signal columns (pass rate by
  intent/dupe/context bucket) so each new signal earns its weight with real
  verdict data before it can gate anything.
- New `photo_signal_coverage` event per tagging pass: counts of
  intent-tagged / pixel-tagged / grouped / embedded, `no-local-image` rate.
  Counts and ratios only — no ids, no coordinates.
- Curation surfaces log picked-vs-overridden (user chose a different photo than
  our best pick) — this is the memo's "learn from deselects" raw material, even
  though learned weights are deferred.

## Testing

- Jest, all pure TS: `captureContext` (dwell/retry/sun/altitude tables),
  `qualityScore` (profiles, percentile normalization, neutral-when-missing),
  `dupeGroups` (grouping with mocked distances, representative election,
  re-group stability), `bestPhotos`; extend `candidateSelection.test.ts`
  (dupe exclusion; no-signals ordering byte-identical — regression lock);
  `visionPhoto` selection with and without tags map.
- Native: extend the dev diagnostic grid (behind `showDebugInfo`) with intent
  badges and dupe-group overlays — the human-eyeball pass is again the highest
  value test, especially for the feature-print distance threshold and the
  saved-from-social heuristic.
- Backend: schema test for optional `retry_count`; evaluator run confirming
  `PLACES_RANK_RETRY_WEIGHT=0` is a no-op.

## Risks / watch items

1. **Intent staleness** — favorites drift; mitigated by the cheap 24h
   whole-library metadata refresh. Watch pass duration on 50k-photo libraries.
2. **Feature-print storage/compute** — grouping is neighborhood-scoped
   precisely to avoid O(n²) and blob storage; if exemplar tables grow, cap and
   evict oldest groups.
3. **`hasAdjustments` via `PHAssetResource`** — resource enumeration cost per
   asset must be measured in the metadata pass; if slow, drop to
   favorites/subtypes-only for v1.
4. **Saved-from-social false positives** (legit photos at social dimensions) —
   down-rank only, never drop; watch agreement telemetry before hardening.
5. **CLIP model delivery** — on-demand download failure modes (offline first
   run) must degrade silently to Phase 1–3 behavior; version the model file
   like `modelVersion` in the memo's §8.
6. **iOS-only skew widens** — Android users get timestamp/context signals only.
   Accepted for now; recorded as the trigger to revisit if Android engagement
   with quiz/curation surfaces materially lags.

## Deferred (recorded, not planned)

- On-device LLM pairwise judging / flaw tags (Foundation Models) — revisit when
  iOS 27 image input is broadly deployed; our Gemini gate already covers the
  quiz's judging need.
- Learned weights from deselects and true per-purpose trained heads — the
  telemetry to feed them ships in this plan; training does not.
- Cross-user postcard/centroid labeling — consent + server design of its own.
- Full EXIF capture (lens/ISO/zoom) — via `CGImageSource` properties on
  original data if a surface ever needs it; expensive, low marginal value now.
- Android parity (MediaStore `IS_FAVORITE`, LiteRT CLIP).
- Live Photo best-frame selection; HDR gain-map display handling.

## Sequencing and sizes

| Step | Contents | Size | Ships |
| ---- | -------- | ---- | ----- |
| 1 | `photo_intent_tags` schema + `photoTagDb` additions + Jest | S | merge first, inert |
| 2 | Native `readPhotoMeta` + metadata pass in `photoTaggingService` | M | needs dev-client rebuild; inert until flag |
| 3 | `photoSignals/` package: captureContext, qualityScore, profiles | M | OTA |
| 4 | Quiz integration (tagSignals consumes shared layer; intent/context in tiers) | M | OTA, shadow |
| 5 | Feature print in tagger + `dupeGroups` + BUG-2 pick/swap exclusion | L | rebuild + OTA |
| 6 | `visionPhoto` signal-aware selection + backend `retry_count` (weight 0) | M | OTA + backend deploy |
| 7 | `bestPhotos` + curation wiring (segments, gallery, entry attach, country) | L | OTA |
| 8 | MobileCLIP: model delivery, encoder in pass, embeddings table, zero-shot + landmark + novelty consumers | XL | rebuild + backend |

Critical files — modify: `mobile/modules/photo-tagger/ios/PhotoTaggerModule.swift`,
`mobile/src/services/photoImport/{photoTagDb,photoTaggingService,visionPhoto,photoCacheDb}.ts`,
`mobile/src/services/quiz/{tagSignals,candidateSelection,quizPlay}.ts`,
`mobile/src/config/features.ts`, `backend/app/schemas/photos.py`,
`backend/app/services/place_matcher/_matcher_ranking.py`.
Create: `mobile/src/services/photoSignals/{captureContext,qualityScore,dupeGroups,bestPhotos,index}.ts`,
`photo_intent_tags` / `photo_dupe_groups` / `photo_clip_embeddings` tables.
