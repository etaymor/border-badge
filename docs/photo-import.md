# Photo Import System

The photo import feature allows users to scan their device photo library and automatically create trip entries based on GPS location clustering, with optional vision classification for improved accuracy.

## Architecture

### Mobile Services (`mobile/src/services/photoImport/`)

- `photoImportService.ts` - Photo extraction with permission handling and batch paging
- `photoClustering.ts` - Geohash-based clustering (precision 7 ~153m) with adjacent cell merging (union-find)
- `photoClusteringCache.ts` - Bridges SQLite cache with clustering pipeline
- `photoClusteringDisplay.ts` - Memory-optimized display types (IDs instead of full objects)
- `photoClusteringTrips.ts` - Trip segmentation from clusters
- `photoCacheDb.ts` - SQLite caching for incremental imports
- `photoCacheDbSuggestions.ts` - Processed clusters, cached suggestions with TTL
- `photoBackgroundSync.ts` - Silent background cache refresh on app foreground (1hr interval)
- `visionPhoto.ts` - Select representative photos, resize to 768px, base64 encode for vision API
- `suggestionDispatch.ts` - Module-level singleton owning place-suggestion dispatch (see "Suggestion dispatch controller")
- `types.ts`, `errors.ts`, `index.ts`

### Mobile Screen Components (`mobile/src/screens/photos/components/`)

- `IdlePhase.tsx`, `ScanningPhase.tsx`, `SuggestionsPhase.tsx` - Workflow phase UIs. Idle and scanning share `StageHero` with the permission carousel
- `PlaceSuggestionCard.tsx` - Individual suggestion with prev/next alternative cycling
- `ClusterListItem.tsx`, `PhotoClusterCard.tsx` - Cluster displays
- `PhotoGalleryModal.tsx` - Full-screen photo gallery
- `ManualPlaceSearch.tsx` - Manual Google Places search for unmatched clusters
- `PhotoTripSwitcherSheet.tsx`, `PhotoTripCard.tsx` - Trip switching UI

### Mobile Hooks (`mobile/src/screens/photos/`)

- `usePhotoScan.ts` - Scan workflow with progress tracking
- `usePlaceSuggestions.ts` - Suggestion-fetch policy: SQLite cache read/write discipline, premium gating, analytics, candidate-stale guarding. Chunking and dispatch live in `suggestionDispatch` (below)
- `useEntryCreation.ts` - Create entries from confirmed suggestions
- `usePhotoImportWorkflow.ts` - Orchestrates multi-phase workflow
- `useClusterItems.ts` - Turns a candidate's clusters + dispatch results into the suggestion list rows, in canonical cluster order. Clusters whose top place is the same `place_id` merge into one `merged-suggestion` card **progressively** — the moment the second cluster matches, anchored at the earliest cluster's slot (so one row disappears at that moment; that's the accepted tradeoff, reversing the 2026-08-15 plan's KTD22 deferral-until-settle). The backend never merges: it returns one suggestion per cluster. Manual split sub-clusters never merge; a cluster the user already confirmed is never re-merged.
- `useWorkflowAnalytics.ts`, `useAutoStartWorkflow.ts`, `useScanLifecycle.ts`, `useWorkflowNavigation.ts`

### Mobile Hooks (`mobile/src/hooks/`)

- `usePhotoTrips.ts` - Access photo-discovered trips from SQLite cache with search/filter by country
- `useMultiClusterUpload.ts` - Manage concurrent photo uploads from multiple location clusters

### Suggestion dispatch controller

`mobile/src/services/photoImport/suggestionDispatch.ts` is a **module-level singleton** that owns everything about _getting suggestions onto the wire_: batch planning, cluster claiming, abort, progress accounting, and failure attribution. It follows the same shape as `photoScanService` — the service owns the state machine, React subscribes to it — so dispatch state survives navigating away from the photo import screen and back. It replaced a chunked React Query mutation, which used none of React Query's affordances (no query key, no cache, no retry, no dedup).

**Ownership split**

| Concern                                                                                      | Owner                 |
| -------------------------------------------------------------------------------------------- | --------------------- |
| Batch planning, claiming, abort, progress, failure attribution, the HTTP call                | `suggestionDispatch`  |
| Cache read/write discipline, premium gating, analytics, candidate-stale guard, retry spinner | `usePlaceSuggestions` |

**All three fetch paths go through it**

| Path          | Entry point           | Controller call                                        |
| ------------- | --------------------- | ------------------------------------------------------ |
| Main dispatch | `fetchSuggestions`    | `dispatch()` — plans batches, dispatches one at a time |
| Manual split  | `fetchForClusters`    | `claim()` -> `dispatchBatch()` -> `releaseClaim()`     |
| Scoped retry  | `retryFailedClusters` | `claim()` -> `dispatchBatch()` -> `releaseClaim()`     |

**Batch plan.** `planSuggestionBatches()` splits clusters into a small opening batch (`FIRST_CHUNK_SIZE = 2`) followed by full-size ones (`CHUNK_SIZE = 5`), so time-to-first-suggestion is not gated on a full batch's on-device preparation. Preparation is pipelined exactly one batch ahead and serialized on a per-dispatch tail: Expo's async function queue is serial at the native layer, so extra preparation workers buy no parallelism. A preparation failure never rejects — the batch dispatches without vision images.

**Stall bounds.** Preparation is native work (`Image.getSize`,
`manipulateAsync` over `ph://` assets), and a native call that never calls back
neither resolves nor rejects — so the `catch` around preparation covers a
failure, not a stall. An iCloud-evicted photo ("Optimize iPhone Storage") is the
reproducible cause, and unbounded it freezes the whole import at
"Processing 0 of N locations" with nothing to retry. Two nested bounds, both of
which **degrade instead of failing**:

- `VISION_IMAGE_TIMEOUT_MS` (10s, `visionPhoto.ts`) per native call — the tight
  bound that normally fires. That photo loses its vision image; the cluster
  still goes to the place matcher on its coordinates.
- `PREPARE_WATCHDOG_MS` (60s, `createBatchPreparer`) per batch as the backstop.
  It *races* rather than rejects, so the worker gets a payload it can post and
  the serialized preparation tail is released instead of pinning every later
  batch behind the stalled one; the batch dispatches unprepared.

**Gallery pause.** Opening the photo gallery calls `pause('gallery')`
(`useGalleryDispatchPause`) — the decode for the photo the user just tapped
would otherwise queue behind a steady stream of preparation work on Expo's
serial native queue and take seconds to appear. A pause, never a `reset()`:
in-flight batches keep running and still cache, workers park rather than exit,
and the `gallery` owner is independent of the `lifecycle` one, so backgrounding
with the gallery open behaves. Unmounting with it open (swipe-back) releases it.

**Three cluster sets.** These are distinct on purpose:

- `enqueuedClusterIds` - every cluster the controller has _accepted_, resolved or not. Source of the pending rows: on a 100-cluster import all 100 are enqueued from the first frame, while only ~2-5 are on the wire. Sourcing pending rows from the in-flight set instead would leave the screen mostly empty.
- `inFlightClusterIds` - clusters with a request actually outstanding. Drives retry/split claim deduplication: `claim()` returns only the ids it could take, so a double-tapped retry, or a retry racing the main dispatch, cannot double-fire or double-cache.
- `dispatchedAndResolvedClusterIds` - clusters whose batch received a response. This is the **cache-write allow-list**: a suggestion cache row may be written for a cluster only on positive evidence that a response covering it arrived, so a cluster in a batch that threw — or in a batch that never went out after a fatal quota/rate-limit error — can never be cached as `[]` for its TTL.

**Failure attribution.** A non-fatal batch error records that batch's clusters in `failedClusterIds` with retry enabled and the loop continues. A fatal error (429, or a 503 carrying `Retry-After` — quota is the only 503 that does) records the current batch _and every batch not yet dispatched_ with retry disabled, then re-throws. `failedClusterIds` survives the throw; `progress` is cleared.

**Dispatch owner count.** `beginOwner()` / `endOwner()` implement the "is a fetch in progress?" signal as a count, not a boolean, because several call sites can start overlapping fetches; settled means _all_ owners released. The counter lives on the singleton so the two callbacks have stable identity for the five call sites that take them as props, and `reset()` deliberately does not zero it — a parked owner still holds its slot.

**React seam.** `useSuggestionDispatch()` (`mobile/src/hooks/usePhotoImport.ts`) subscribes a component to the controller's snapshot via `useSyncExternalStore`. Actions are stable methods on the singleton, imported directly rather than threaded through props.

### Backend Place Matcher (`backend/app/services/place_matcher/`)

PlaceMatcher uses a mixin pattern for separation of concerns. When modifying matching behavior, identify the correct mixin file rather than editing `matcher.py` directly.

- `matcher.py` - PlaceMatcher orchestrator (inherits SearchMixin, RankingMixin, ClusterProcessingMixin)
- `_matcher_search.py` - Density-adaptive tiered radius search, Text Search API fallback, tourist relevance filter
- `_matcher_ranking.py` - Vision-integrated scoring with 7 configurable weights (distance, reviews, rating, fame, dwell, vision, name-match)
- `_matcher_cluster_processing.py` - Parallel cluster processing with vision result integration
- `cache.py` - In-memory (L1) LRU cache with TTL and single-flight pattern for deduplication, backed by the persistent L2 cache
- `persistent_cache.py` - Postgres/Supabase-backed persistent cache (L2); see "Persistent place cache" below
- `constants.py` - Search radii, density thresholds, place type mappings, quality filters
- `utils.py` - Haversine distance, coordinate utilities, name/address sanitization

### Persistent place cache (L2)

`cache.py` (in-memory L1) is backed by a durable Postgres/Supabase layer (`persistent_cache.py`, L2) so the same physical location resolves from our DB instead of being re-bought from Google at Enterprise pricing on every request. The L2 cache survives restarts/deploys and is shared across all server instances and users. It has two complementary tables (migration `0057_persistent_place_cache`), both backend-only (service role, RLS enabled with no user policies):

- `places_search_cache` - raw Nearby/Text Search responses keyed by a quantized `(lat, lng, radius, type-set-hash)` cache key (photo import).
- `cached_google_place` - enriched per-place fields keyed by `google_place_id`, consulted before any Place Details call (social ingest).

Both use a 60-day TTL (place data near a coordinate is very stable); the short in-memory L1 TTL still guards the hottest entries against intra-day churn. All L2 operations are best-effort: a DB failure logs and degrades to a cache miss rather than failing the request, and L2 short-circuits entirely when Supabase is not configured (e.g. tests).

### Backend Photo Vision (`backend/app/services/photo_vision/`)

- `classifier.py` - PhotoClassifier using Gemini Flash Lite via OpenRouter; classifies into 8 categories; extracts visible text from signage/menus
- `constants.py` - Vision categories, confidence levels, LLM prompt templates, category-to-place-type mappings

## Workflow Phases

1. **Scan** - Extract photos with GPS data, cluster by geohash with adjacent cell merging, geocode centroids
2. **Candidates** - Display trip candidates grouped by country and time
3. **Vision** (optional) - Select representative photos per cluster, resize/encode, classify via Gemini Flash Lite
4. **Suggestions** - Fetch place suggestions from backend (vision data sent alongside clusters); text search fallback for detected business names
5. **Confirmation** - User reviews suggestions with alternative place cycling (prev/next), creates entries

## Scan surfaces

The trips door and the Guess Where build share one frame: a full-bleed navy
stage (`StageHero`) with a warm-cream sheet underneath. The visual fills the
hero edge to edge, from the top of the screen down under the sheet's rounded
top. The header floats over it. A header with a title gets a navy scrim and
the visible band starts below it. A title-less header (just the back button)
drops the scrim, and the band starts under the status bar with only the
button's corner kept clear. The hero publishes that band as `StageInsets`
(`useStageInsets`). Anything that must be seen in full (pills, stamps, slots)
lays out inside the band, and backgrounds (photo grids, the beat-2 photo)
just fill.

**Beat loops.** Each beat runs one linear clock (`usePermissionBeatClock`).
Every overlay (checks, pills, stamps) derives its pop and the shared fade
from that clock, so they can't drift apart; separate repeating springs
used to cause a visible double flash at the loop reset. The photos never
read the clock, so they stay on screen for the whole loop.

**Permission carousel.** Both doors play three beats on the stage before
the system prompt. Each beat is a title only. The claims the subtitles
used to carry rotate, one short line at a time, through the lock footer
(`SCAN_COPY.permission.carousel.footerLines(door)`). The footer's
accessibility label reads every line at once. Beat 3 is the same
`StampScatter` the live scan uses, fed demo stamps and stills. Allow Full Access is the consent: `usePhotoImportWorkflow` starts
the scan on that grant even when the route did not pass `autoStart`, so the
idle screen does not appear as a second pitch.

**Idle.** Only when the user arrives with access already granted. Both first
and return visits hold beat 3's stamp page on its last frame. A first run
adds the title "Ready to scan", one magnitude line, Start Scan, and the
lock footer. A return visit adds "Check for New Photos", "Last scanned …",
and a Refresh All Photos text link. The polaroid, the privacy-notice block, and
the body sentences are gone from this screen.

**Live scan.** `ScanStage` fills the stage with two layers and renders no
text; a test enforces that. `ReadingGrid` fills a 3 x 4 grid (the same as
beat 1), edge to edge,
with the user's own photos as the scan reads them. Tiles fill in a scattered
order, then churn one at a time. Trip photos (outside the home country) get
a gold check. When the first country is found the grid dims to a texture,
and `StampScatter` pops each country's stamp onto the navy at a scattered,
tilted spot with up to two of its photos tucked behind it. The live scan
shows six stamps at once; when a seventh arrives, it takes the oldest
stamp's spot and the old one fades out. There are no
country names or codes on screen; the full name reaches VoiceOver through
each stamp's label and the arrival announcement. The quiz intro is the
title plus one rotating line (`SCAN_COPY.quiz.introLines`). The sheet is a
title ("Finding Your Trips" / "Building Your Challenge"), a counter with a
thin gold bar, and one rotating status line from `SCAN_COPY.shared.stageLines`.
A first scan also shows Leave It Running and Stop. Stop still confirms
before it cancels. The quiz stage swaps to the slot grid once checking begins.

Claims that used to be paragraphs on these screens now live in shorter
places:

| Removed | Where the claim lives now |
| --- | --- |
| Idle `PrivacyNotice` (device scan, home-country read, upload triggers) | Carousel beats and the lock footer; the quiz upload line in `stageLines('quiz-build')` |
| Quiz working privacy lines and the persistence paragraph | The rotating status line (`stageLines`) |
| Trips `scanningHint` and the spinner-plus-sentence progress | The same status line, plus the counter |
| Recovery-sheet upload sentence and the always-visible Privacy Report tip | The two-sentence recovery body; the tip sits behind "Why is this safe?" |

## Scan-time country previews

During extraction, `scanPreviewPicker.ts` builds country rows from PhotoKit
metadata already in memory. It excludes the home country and screenshots.
Network/iCloud-offloaded assets stay as last-resort candidates, ranked after
every local one, and render through `PhotoThumbnail` with recovery disabled
so a scan never starts an iCloud download. Within each batch, local
candidates rank by favorite status, then pixel count, then dimensions that
are not common social-save sizes, then newer capture time. This path has no
photo-tag or vision dependency. Country names come from the countries
reference, falling back to `getCountryName` only when the reference has no
entry.

Rows are append-only and bounded to 10 countries with two thumbnail slots each.
Later batches may fill an open slot but never reorder, replace, or remove an
established row or thumbnail. A structurally unchanged pick returns the existing
array and is not published. Changed rows are carried in both
`TripScanDetail.countryPreviews` and `QuizBuildDetail.countryPreviews`; quiz
refresh progress includes them only on the progress tick after a changed batch.

`ScanStage` presents the stamps for trip scans and for the quiz build while
its step is `scanning`. The arrival queue lives in `useArrivalQueue`: rows
present at mount render settled; only later discoveries pop in, and
completion settles any queued rows immediately. `stampScatterLayout.ts`
cuts the visible band into a staggered grid sized for the page's capacity,
so fewer stamps per page means bigger stamps. It visits the anchors
farthest-first, so the first few finds already span the band. It slides any
stamp out from under a title-less back button. The first country's code
seeds the jitter, so one scan's layout never reshuffles. A thumbnail load failure drops that tucked photo; recovery stays
disabled.

**Reading previews.** The same batch hook samples up to four photos per batch
into `readingPreviews` (`appendReadingPreviews`), a rolling window of 24
local, non-screenshot assets. It refreshes at most every 300 ms and is
carried on `TripScanDetail` and `QuizBuildDetail`. A network asset never
enters the window, so the grid never waits on an iCloud original.

## Photo Vision Classification

The photo import pipeline optionally uses computer vision to improve place matching accuracy.

### How It Works

1. **Mobile (preparation)**: `visionPhoto.ts` selects up to 3 representative photos per cluster (closest-to-centroid + temporal extremes), resizes to 768px max dimension, and base64-encodes as JPEG (~50-80KB per image)
2. **Transport**: Vision images sent in `vision_images_base64` field of the `/photos/suggest-places` request (2M char payload cap)
3. **Backend (classification)**: `PhotoClassifier` sends images to Gemini Flash Lite via OpenRouter with structured output schema
4. **Backend (integration)**: Vision classification runs in parallel with Google Places search; results are merged before ranking

### Vision Categories

| Category  | Maps to Entry Type | Example Places              |
| --------- | ------------------ | --------------------------- |
| food      | Food               | Restaurants, cafes, bars    |
| landmark  | Place              | Museums, monuments, temples |
| stay      | Stay               | Hotels, resorts, hostels    |
| shopping  | Experience         | Markets, malls, stores      |
| nature    | Experience         | Parks, beaches, gardens     |
| nightlife | Experience         | Clubs, casinos, bars        |
| transport | (no mapping)       | Airports, stations          |
| unknown   | (no mapping)       | Unclear photos              |

### How Vision Improves Matching

- **Category bonus in ranking**: Places matching the vision category get a score boost (configurable via `PLACES_RANK_VISION_WEIGHT`)
- **Signage name-match bonus (dominant)**: When OCR'd signage text matches a candidate's name, that candidate gets a bonus (9.0 base, `PLACES_RANK_NAME_MATCH_WEIGHT`) sized to outweigh any neighbor's combined review/rating/fame advantage — a readable business name in the user's own photo is near-conclusive
- **Text detection**: Signage/menu text triggers Google Places Text Search API as fallback when nearby search fails (suppressed when the nearby results already contain a name match)
- **Enrichment skip**: When a cluster's top finalist matches detected signage, the per-finalist Place Details rating enrichment is skipped entirely — the ranking outcome can no longer change, so the calls would be pure cost
- **Multi-photo aggregation**: Confidence-weighted voting across up to 3 photos per cluster
- **Request-level cap**: Maximum 50 vision images per request to prevent payload bloat

### Configuration

- Requires `OPENROUTER_API_KEY` env var
- Uses `MULTIMODAL_MODEL` for model selection (default: `google/gemini-2.5-flash-lite`)
- Cost: ~$0.00023 per photo at 768px via OpenRouter (~2.2k prompt + ~37
  completion tokens, measured 2026-08-15)

### Why a Flash *Lite* model

Benchmarked 2026-08-15 against the quiz eligibility payload on 5 hand-labelled
photos. Gemini 2.5, 3.1, and 3.5 Flash Lite each scored 5/5 on both
eligibility and people-detection at ~1s per image, so 2.5 stays as the
cheapest and fastest of an indistinguishable set. 3.1 Flash Lite (~2x cost)
and 3.5 Flash Lite (~2.4x) are drop-in `MULTIMODAL_MODEL` swaps if a larger
labelled set ever shows a real difference.

**Reasoning-model gotcha — read before switching to a Gemini 3.x Flash tier.**
Those models reason on every request and OpenRouter rejects any attempt to
disable it (`reasoning.enabled=false`, `reasoning.max_tokens=0`, and
`reasoning_effort=none` all return HTTP 400 "Reasoning is mandatory for this
endpoint"). Reasoning burns ~85-155 tokens out of `max_tokens` *before* any
content, so an undersized budget returns HTTP 200 with `finish_reason="length"`
and a truncated preamble instead of JSON — a silent parse failure, not an
error. For the fail-closed quiz gate that reads as "every photo ineligible".
The vision call sites budget `VISION_MAX_TOKENS` (`app/core/llm_utils.py`)
specifically so an env-var-only model swap survives this; they also measured
~2x slower against a 5s timeout, and ~4x the cost.

## Photo Quality Signal Layer (`mobile/src/services/photoSignals/`)

Purpose-agnostic interpretation of the photo cache's raw signals, shared by
Guess Where selection, vision-photo selection, and curation surfaces. See
`docs/plans/2026-08-21-001-feat-photo-quality-signals-plan.md` for the design.

- `nearDuplicates.ts` - the burst/HDR/re-save collapse (moved from
  `quiz/candidateSelection.ts`, which re-exports it), now with an optional
  representative picker so signal-aware callers keep the best frame instead of
  the newest.
- `captureContext.ts` - dwell, same-scene retry count, sun elevation
  (golden hour/night), altitude delta vs the country-day median, moving-capture
  and saved-from-social priors. Pure, computed on demand, never persisted.
- `qualityScore.ts` - one composite quality score: pool-relative aesthetic
  rank + capped intent evidence (favorite/edited/album/burst-pick) + context
  priors. Ordinal within a pool only.
- `bestPhotos.ts` - `rankBestPhotos` for curation: utility images excluded,
  dupes collapsed to best frame, quality-sorted.
- `lowSignalPhotos.ts` - `lowSignalPhotoIds` for the one surface that HIDES
  rather than reorders. Deliberately narrower than the ranker: only utility
  images (`isUtilityImage`, shared with `rankBestPhotos`) and the losing frames
  of a near-duplicate run. The composite score is not a drop input — it is
  tuned for ordering, and a wrongly hidden photo is the one the user opened the
  cluster to find. Two floors: the cluster anchor (nearest the centroid) is
  never hidden, and if the rules would hide everything, nothing is hidden.

**`rankBestPhotos` is not order-neutral on an untagged pool.** `goldenHour` and
`retryCount` derive from cached timestamps and coordinates alone, so a pool with
zero tag rows still gets scored and reordered. Every consumer therefore reads
its tag maps first and bails when both are empty (`rankTripSegmentPreviews`,
`loadClusterQualityScores`, `useCoverPhotoSuggestions`, the gallery seeding
effect all carry the same guard). New consumers need it too — the invariant
lives at the call sites, not in the ranker.

Feeding it, `photo_intent_tags` (in `photos.db`, access via `photoTagDb.ts`)
stores zero-pixel PhotoKit metadata (favorites, edits, bursts, capture modes,
source, altitude/speed), refreshed by a whole-library metadata pass in
`photoTaggingService.ts` at most every 24h (`readPhotoMeta` on the native
photo-tagger module). Intent is refreshable by design - a photo can be
favorited next month - unlike the write-once-per-version pixel tags.

The sweep is time-budgeted and resumable: `getStaleIntentIds` is a watermark, so
a pass that runs out of budget continues into the library tail on the next one
instead of re-reading the same prefix, and only a pass that reports
`stoppedBy: 'complete'` stamps the 24 h window. A sweep with any failed chunk
reports `incomplete` and leaves the window unstamped, so the next pass resumes
into the tail instead of a failure silencing the sweep for a day. Outcome and
row count both ride out on `photo_tagging_pass` (`intent_stopped_by`,
`intent_tagged`), which is what separates a sweep that wrote nothing because it
failed from one that had nothing to write.

Flags: `enableIntentSignals` (metadata pass + intent/context reads) and
`enableQualityRanking` (composite score changes photo ORDER on quiz, vision
selection, and curation surfaces). With both off - or on Android/old binaries -
every surface orders exactly as before the layer existed. The composite score is
re-centered so a photo with no evidence scores exactly 0: a neutral intent row
ties a photo with no row at all rather than beating it in tie-breaks.

### Signal consumers

| Surface | Entry point | Behavior |
| --- | --- | --- |
| Photo Trips segment previews | `rankTripSegmentPreviews` (`photoClusteringCache.ts`), called from the scan | Rebuilds each segment's preview strip best-first (utility images dropped, bursts collapsed to their best frame), keeping `previewUris` and `previewAssetIds` index-aligned. Bounded to an evenly spaced `PREVIEW_RANK_POOL_MAX` (300) sample per segment so tag reads stay capped per scan |
| Trip cover photo | `useCoverPhotoSuggestions` + `CoverSuggestionStrip` (`components/media/`) | Narrows the cache to the trip's country (the cache is country-code indexed at scan time) and, when the trip has one, its date window; samples evenly to `COVER_RANK_POOL_MAX` (300), ranks with `rankBestPhotos`, and offers up to `COVER_SUGGESTION_LIMIT` (12) suggestions above the existing picker. Picking one goes through the same validated upload path as the system picker. No country on the trip → the photo DB is never opened |
| Matching gallery de-emphasis | `lowSignalPhotoIds` seeding effect in `PhotoImportScreen.tsx` | Seeds the per-cluster **excluded** set that already backed manual deselection, so screenshots and burst repeats arrive deselected and the existing "Show all" restores them. Order is untouched — gallery order feeds positional cluster splitting. Cluster ids are claimed in a ref *before* the first await, so an overlapping run cannot re-hide a photo the user restored. One `photo_gallery_deemphasis` event per import reports `seeded_count` vs `restored_count` as a false-positive rate on the rules |

Cluster previews and the matching gallery deliberately stay **chronological**:
their order is load-bearing for the "Split here" flow, which is positional.

## Photo Trips Feature

The Photo Trips screen (`PhotoTripsScreen.tsx`) displays all photo-discovered trips from the SQLite cache, allowing users to browse and select trips for import without re-scanning their photo library.

- FlashList for performant rendering with year-based section headers
- Animated search bar for country filtering
- Pull-to-refresh for cache reload
- Grouped by year (most recent first), trips sorted by date within each year
- Memory-optimized: uses `cached_trip_segments` SQLite table instead of re-clustering in memory

Accessible via `PhotoTrips` route in PassportNavigator, typically reached from the PhotoTripsCallout component.

## Multi-Cluster Upload

The `useMultiClusterUpload` hook enables concurrent photo uploads from multiple location clusters:

- Per-cluster upload state with progress tracking
- AbortController support for per-cluster cancellation
- Automatic URI conversion from `ph://` to `file://` for upload
- Temp file cleanup after upload completion or cancellation

## Memory Optimization

Photo import uses memory-optimized display types (`TripCandidateDisplay`, `LocationClusterDisplay`) that store IDs instead of full objects. A `cached_trip_segments` SQLite table stores pre-computed trip data, reducing memory from ~5-10MB to minimal. Users with 5k+ GPS photos see a warning suggesting country filtering.

## Mobile SQLite Tables

```
cached_photos          - GPS photo metadata cache (incremental import)
cached_trip_segments   - Pre-computed trip segment data for memory-optimized display
processed_clusters     - Tracks confirmed/hidden cluster suggestions
cached_suggestions     - Place suggestion cache with TTL
```

## Tuning Place Matcher Ranking Weights

Use the offline evaluator to tune ranking weights against a labeled dataset:

```bash
cd backend
poetry run python scripts/eval_place_matcher.py \
  --dataset docs/place_matcher_eval_dataset.sample.json \
  --trials 200 --optimize-for top1
```

The script runs random search over the 7 `PLACES_RANK_*_WEIGHT` env vars and prints the best configs with top-1 accuracy, MRR, and recommended env var values. Use `--no-search` to evaluate the current config without tuning. Use `--vision-mode none|single|aggregate` to test with/without vision data.

Use `--pipeline` to additionally simulate the tiered Nearby search per sample (treating the sample's places as the world): it reports candidate **recall** (did the visited place get fetched at all), end-to-end top-1, and the average number of paid Nearby calls per cluster. `--stop-threshold N` overrides `places_min_quality_results_before_stop` for the run (`--stop-threshold 1` reproduces the legacy stop-at-first-hit search) for before/after recall/cost comparison — ranking-only metrics cannot see recall failures, which were the dominant real-world miss mode. Two cost-lever sims make the remaining Set-2 levers measurable offline: `--simulate-type-filter` (drops candidates whose `types` fall outside the `SEARCHABLE_PLACE_TYPES` allowlist — the C5 lever) and `--simulate-text-rescue` (a name-match text-search rescue against the world, reporting `avg_text_search_calls` — the C2 lever). `--two-pass` scores rows through the production two-pass flow instead of a single rating-aware ranking (see the Louvre capture subsection below).

The sample dataset (11 labeled clusters) encodes the observed real-world failure modes: a mega-famous neighbor outranking the signage-matched place actually visited, GPS drift putting the visited place 75m from the centroid, low-review hidden gems, a venue whose only type sits outside the allowlist (C5), and a venue just beyond the search radii recoverable only by text rescue (C2). To grow it into a real tuning corpus, add labeled samples from actual trip imports — see `backend/docs/how-to-label-place-matcher-dataset.md` for the capture-and-label workflow (run with `PLACES_DIAGNOSTICS=true` to emit per-cluster traces).

### Search recall: sparse mid-range tier + optional outer tier (C1/C6/U12)

The tiered Nearby search reads its stop threshold from
`places_min_quality_results_before_stop` and its radii from the density profiles.
Two recall levers: the sparse profile is now `[50, 100, 250]` (was `[100, 250]`)
so a 30–80 m venue in a sparse area — pushed out of the 15 m probe by GPS drift —
is reachable via the restored 50 m tier (C6); and `PLACES_EXTRA_SEARCH_TIER_M`
(default unset) appends one extra outer radius after the density profile when the
threshold is still unmet (C1), for a venue one tier past the profile. Cost: the
50 m sparse tier adds one Nearby call only in sparse areas where the 15 m probe
found nothing; the extra tier adds one call only when the threshold is unmet.
Measure before/after with `--pipeline --stop-threshold N` and the `PLACES_*` env
overrides; the `--no-search` gate stays at `top1=1.0 mrr=1.0`.

### `places_rank_vision_weight` default raised 1.0 → 2.0 (C4/U7)

Pre-enrichment, the wide Nearby field mask strips `rating`/`userRatingCount`, so the only live first-pass ranking signals are distance and vision category (plus dwell and signage name-match when present). At `vision_weight=1.0` a high-confidence category match offsets only ~30m of distance, so a closer wrong-category place could consume a top-3 finalist slot and a correct place that never reached the finalists was unrecoverable (enrichment only re-ranks within the 3 finalists). At `2.0` the match offsets ~60m — within typical indoor GPS drift — pulling the correct place into the finalists while still not erasing a large distance gap. Validated by `TestVisionWeightDefault` (a non-name-matched discriminating case the synthetic `--no-search` gate cannot see) and by holding `--no-search` at `top1=1.0 mrr=1.0`. The default is env-overridable via `PLACES_RANK_VISION_WEIGHT`.

### Two-pass field mask + enrichment backfill (U4)

The Nearby search uses a cheap wide field mask (no `rating`/`userRatingCount`), then enriches only the top finalists with a Place Details call. Because the review-count quality gate (`PLACES_MIN_REVIEW_COUNT`, lowered 5→3) can only be enforced once a rating count is present, it runs on enriched finalists. When that gate drops finalists, up to `PLACES_ENRICH_BACKFILL_LIMIT` (default 3) first-pass tail candidates are enriched in one global second batch per request and gated before falling back to un-gated candidates; set it to 0 for the legacy un-gated backfill.

### Type priors: lodging penalty & landmark boost/rescue (U3/U5/U6)

Two vision-driven type priors sharpen the rating-blind first pass:

- **Lodging penalty** (`PLACES_RANK_LODGING_PENALTY`, default 2.5 ≈ 50m of distance): demotes lodging-typed candidates in full when vision confidently says the photo is _not_ accommodation, at half strength with no usable vision signal, and not at all when vision says "stay". Demotion only — an all-lodging candidate world still returns lodging; 0 disables.
- **Landmark boost** (`PLACES_RANK_LANDMARK_BOOST`, default 1.5): extra bonus for landmark-family places (museum/monument/tourist_attraction/…) when vision classifies the photo as "landmark", stacking with the generic vision category bonus so a large venue beats its own micro-POIs; 0 disables.

Large venues' Google points often sit beyond the dense-city Nearby radii, so two rescues bring them into the candidate world for landmark-classified clusters: **landmark text rescue** (`PLACES_LANDMARK_TEXT_RESCUE`, default on) fires a Text Search for a recognized landmark name that has no strong Nearby match, biased by `PLACES_LANDMARK_RESCUE_BIAS_RADIUS_M` (default 500m, wider than the 200m business-name bias); and a last-resort **popularity probe** (`PLACES_POPULARITY_PROBE`, default off) issues a popularity-ranked 200m Nearby call for text-less landmark clusters with no landmark-family candidate. Both are cost-bounded to landmark clusters and deduped via the coarse cache key.

### Major-venue evidence: live Louvre capture (U4, 2026-09-27)

Captured against live Google with the production tiered-search code (rating-bearing mask, no cache writes) at public coordinates, not the user's trip. Rows are in the sample dataset as `paris-*-real`. The Louvre is `ChIJD3uTd9hx5kcR1IQvGfr8dbk`: rating 4.7, 378,404 reviews, point 48.86061, 2.33764, viewport lat 48.85955–48.86225, lng 2.33373–2.33985.

- **Probe recall: yes.** A POPULARITY Nearby at 400m, restricted to `museum, tourist_attraction, historical_landmark, cultural_landmark, monument, art_gallery, park`, returned the Louvre first at all five interior points (85–255m away) and at the Café Marly point, with rating, count, and viewport. The DISTANCE tiers fetched it at only one interior point (Venus de Milo, via the 125m medium tier). It is absent at the Musée des Arts Décoratifs point (~415m away), which is correct.
- **Viewport containment: yes, but coarse.** Every interior point and the Café Marly point fall inside the Louvre viewport. The viewport is a ~300m box around the point, not the palace footprint: the west Denon wing and Pavillon de Flore (lng < 2.3337) fall outside it. Most sub-POIs carry a similar ~300m box. Treat the viewport as a distance proxy.
- **`containingPlaces`: populated for exhibits only.** Mona Lisa, Département des Arts de l'Islam, and Département des Antiquités grecques all name the Louvre. The Louvre Pyramid and Le Café Marly return none. It works as a tie-breaker for exhibits (KTD9), not as a detector.
- **Density of interior clusters: mostly SPARSE.** Mona Lisa room SPARSE (0 at 15m), Winged Victory SPARSE, Richelieu/Carrousel SPARSE, Venus de Milo MEDIUM, Pyramid/Cour Napoléon DENSE (6 at 15m). Café Marly SPARSE, Arts Décoratifs SPARSE, Tuileries MEDIUM, Eiffel base DENSE (10 at 15m). Indoors, the 15m probe usually finds nothing, so a DENSE/MEDIUM-only venue-probe trigger would miss most Louvre-interior clusters.
- **Dominance.** The strongest non-parent finalists are the Louvre Pyramid (85,693 reviews: only 4.4x below the museum) and the Tuileries Garden (119,618). Exhibits are small: Mona Lisa 412, departments 23–152, Victoire de Samothrace 45. The distinct institution, the Musée des Arts Décoratifs, has 10,083.

`scripts/eval_place_matcher.py --two-pass` (KTD5, `scripts/eval_two_pass.py`) replays these rows the way production ranks them: a rating-blind first pass, top-3 finalists, ratings restored for those only, re-rank and backfill, then the roll-up step, which is the only reader of a row's `probe_places`, and only when production's `should_probe_venue` would have fired for the row. Before U7, the four real Louvre-interior rows and the two hand-shaped museum/café rows failed (`PRE_ROLLUP_FAILURES` in `tests/scripts/test_eval_two_pass.py`); after U7 `KNOWN_TWO_PASS_FAILURES` is empty. The real no-hint Café Marly row now expects Le Café Marly: none of its candidates is museum/landmark/attraction family, so production never probes it and cannot see the Louvre (user decision, 2026-09-27).

### Venue roll-up defaults (U7, 2026-09-27)

`app/services/place_matcher/venue_rollup.py` (KTD4) promotes a venue-probe place to `places[0]` after re-rank and backfill. Production and the `--two-pass` eval call the same function.

| Knob | Default | Why | Rollback / no-op |
| --- | --- | --- | --- |
| `PLACES_ROLLUP_MIN_PARENT_REVIEWS` | 2000 | Keeps a 300-review village church from absorbing its square. Also the review count at which a museum finalist counts as a distinct institution (Arts Décoratifs, 10,083). | `0` turns the roll-up off (output identical to pre-U7) |
| `PLACES_ROLLUP_DOMINANCE_RATIO` | 10 | Passes a café with no evidence (300k vs 12k = 25x). Blocks a 60k park next to a 300k museum (5x). Every real exhibit clears it by 900x or more. | raise it (max 1000) to require stronger dominance |
| `PLACES_ROLLUP_MAX_DISTANCE_M` | 250 | Containment when the centroid is outside the parent's viewport. The Louvre viewport already covers every captured interior point. 250m excludes a museum 330m away across a garden. | `0` leaves only the viewport test |

Two fixed guards live in `constants.py`:

- **Viewport waiver.** When the centroid is inside the parent's viewport and the top finalist is an exhibit or landmark (tourist attraction, gallery, sculpture, cultural or historical landmark, monument), the ratio drops to `VENUE_ROLLUP_WAIVER_MIN_RATIO` = 2. The live Louvre Pyramid (85,693 reviews) is only 4.4x below the Louvre (378,404), so it needs the waiver.
- **Eiffel guard.** The waiver never lets a parent win with less than 2x the finalist's reviews, and it never applies to a park or garden parent. At the Eiffel base the probe also returns Champ de Mars (225,645 reviews, 0.46x the Tower), whose viewport covers the base. Either guard alone keeps the Tower first. A park still absorbs a 27-review statue inside it, because that clears the full 10x ratio.

Never rolled up: a museum finalist with 2000+ reviews, a theater or place of worship, and a food, drink, lodging or retail finalist that has evidence (a `food` scene hint, a vision category or business name matching it, or a strong sign-text match). A café that loses first place stays in slot 2. The roll-up is skipped when a strong vision name match, or a strong sign-text match on a finalist that is not sub-POI-like (U10), locked the cluster. With `PLACES_DIAGNOSTICS=true`, each probed cluster's trace carries `venue_rollup: {reason, parent_place_id}`.

### containingPlaces tie-breaker (U8, 2026-09-27)

U4 found Google's `containingPlaces` populated for Louvre exhibits and empty for the Pyramid and Le Café Marly, so it settles only what KTD4 cannot; it never detects a parent (KTD9). Logic lives in `venue_rollup.py` (`containment_fetch_target`, the `containing_place_ids` argument) and the fetch in `_containing_places.py`.

- **Rule.** When the top finalist's `containingPlaces` names a probe place, that place wins without the containment test, the sub-POI type test or the dominance ratio. Every other guard still applies: parent type and `PLACES_ROLLUP_MIN_PARENT_REVIEWS`, the name-match lock, R6 evidence for food/drink/lodging/retail, the distinct-institution museum, never-rollable types. One fixed floor (`CONTAINMENT_MIN_RATIO` = 1): the container needs at least the finalist's review count, so Champ de Mars never absorbs the Eiffel Tower. A containing place that is not in the probe results, or no field, leaves U7 output unchanged.
- **When it is fetched.** Only for a probed cluster with non-empty probe results, only for its top finalist, and only when KTD4 stopped at `no_qualifying_parent` or `finalist_not_sub_poi` while a probe place exists that would pass every other guard. A cluster KTD4 already rolled up, an evidence-kept café, a church, or a cluster with no major probe place never fetches. All such top finalists in a request go out in one batched pass after assembly, under the request budget and the cluster timeout.
- **Cost.** One Place Details call with field mask `id,containingPlaces`, billed as **Place Details Pro** (the field is a Pro field; the rating enrichment stays on its own Enterprise mask). The answer is stored in `cached_google_place.details` under `containingPlaces` (an empty answer as `[]`), merged onto the rating row. Rows written before U8 lack the key and refetch once, then serve from cache. No migration.
- **Failure.** A non-200, transport error, rate limit or timeout returns no answer and is not cached; the cluster keeps its U7 result.
- **Diagnostics.** A roll-up decided by the tie-breaker records `venue_rollup: {reason: "rolled_up", parent_place_id, containing_places: true}`.
- **Eval.** A `--two-pass` row may carry `containingPlaces` on a place; the eval reads it under the same fetch rule instead of calling Google. No sample row carries it today.

| Knob | Default | Rollback / no-op |
| --- | --- | --- |
| `PLACES_ROLLUP_CONTAINING_PLACES` | `true` | `false`: no containingPlaces calls, output identical to U7 |

### Scene hints (U9, 2026-09-27)

Each cluster may carry `scene_hints: [{label, weight}]` (KTD6), derived for free from the Apple Vision labels the photo tagger already stores in `photo_ml_tags.labels_json`. `mobile/src/services/photoImport/sceneHints.ts` owns the identifier mapping and every threshold, so they retune over the air. It is computed in the per-batch prepare step next to vision prep, and it is sent even when the prep breaker is open or every photo is offloaded, as long as tag rows exist. The key is omitted when a cluster has no hints.

- **Vocabulary.** `museum_interior` (`museum`, `dinosaur`), `artwork` (`painting`, `art`, `statue`, `stained_glass`, `illustrations`), `food` (about 60 food and drink identifiers plus `restaurant`), `outdoor_landmark` (`monument`, `tower`, `castle`, `ruins`, and similar). Every identifier was checked against `VNClassifyImageRequest.supportedIdentifiers()`. `sculpture`, `gallery`, `church`, `cathedral` and `palace` are not in Apple's taxonomy.
- **Thresholds.** A label counts for a photo at confidence >= 0.3. A hint is sent when at least 30% of the cluster's tagged photos carry it (40% for `food`, because it is a veto). Untagged photos and rows without measured labels are left out of the denominator. A photo that was tagged before it was offloaded still counts.
- **Backend.** `app/schemas/photos.py` caps the list at 8 entries (more returns 422), bounds weights to 0-1, and drops unknown labels so newer clients stay forward-compatible. `museum_interior` / `artwork` trigger the venue probe (`should_probe_venue`). `food` is the R6 evidence that keeps a food or drink finalist first (`venue_rollup._has_evidence`).
- **Rollback.** Raise a `SCENE_HINT_MIN_SHARE` entry above 1 over the air to stop sending that hint. With no hints, the backend behaves exactly as it did before U9.

### Sign text (U10, 2026-09-27)

Each cluster may carry `sign_text: [string]` (KTD6): short strings the photo tagger's on-device text recognition read from the cluster's photos. **Native change: it needs an `eas build`.** The JS ships over the air ahead of it and sends nothing until the binary has it.

- **Native.** `PhotoTaggerModule.swift` runs `VNRecognizeTextRequest` (`.fast`, no language correction) on the same handler and 512px local thumbnail as the scene classifier, in its own `perform` so an OCR failure never costs the labels. Each photo returns its 8 largest lines as raw `{string, confidence, area}`. They are stored in `photo_ml_tags.sign_text_json`, a nullable column added with `addColumnIfMissing`. Null means not measured.
- **Tagger version.** `photoTagRows.ts` keys the effective version on `capabilities().textRecognition`: `TAGGER_VERSION + 1` (2) when the binary reports it, `TAGGER_VERSION` (1) otherwise. An older binary running new JS neither re-tags nor stamps rows as text-recognized. The first pass on a new binary re-tags existing rows once.
- **Client thresholds** (`sceneHints.ts`, OTA-tunable). A line counts at confidence >= 0.5 (`SIGN_TEXT_MIN_CONFIDENCE`). Whitespace is collapsed and trimmed, each string is capped at 40 characters (`SIGN_TEXT_MAX_CHARS`), and a string needs at least 3 letters. Duplicates are removed case-insensitively across photos. Strings are ranked by how many photos show them, then by on-frame area. At most 5 are sent (`SIGN_TEXT_MAX_STRINGS`). The key is omitted when there are none.
- **Backend.** `app/schemas/photos.py` accepts at most 5 strings of at most 64 characters (either cap returns 422), trims them, and drops blank and duplicate strings. In ranking, sign text joins the vision business names as name candidates (`_rank_by_distance`), with the same tiers: only a strong match earns the full bonus. A strong match is R6 evidence in the roll-up. It sets the enrichment-skip name lock only when the matched top finalist is not sub-POI-like (`_venue_facts.sign_text_sets_lock`), so a museum placard naming an exhibit cannot block the roll-up to the museum. Vision name-lock behavior is unchanged. The `--two-pass` eval passes a row's `sign_text` through the same ranking, lock and roll-up.
- **Rollback.** Raise `SIGN_TEXT_MIN_CONFIDENCE` above 1 over the air to stop sending sign text. Without `sign_text`, the backend behaves exactly as it did before U10.
- **Open check.** Record on-device yield on the Paris trip (the share of storefront photos that give a usable string at 512px fast recognition).

### Diagnostics

Set `PLACES_DIAGNOSTICS=true` to emit one structured JSON trace per cluster (raw candidate world, filter-drop tallies, vision signals, finalists, outcome). Off by default — retaining the raw world has a memory cost, so production stays clean. Use it to capture real imports for the labeling workflow in `backend/docs/how-to-label-place-matcher-dataset.md`.

## Telemetry and Dashboards

Everything a dashboard needs about photo import is either a PostHog event from the client or the `place_matcher_phase_metrics` log line from the backend. **No coordinate, cluster id, geohash or place id appears in any of them** — every field is a count, a duration, or a ratio. Keep it that way when adding fields.

### Client events (PostHog)

| Event                                | Fires when                                                  | Carries                                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `photo_import_suggestions_completed` | A suggestion fetch finishes (including the all-cached path) | `suggestion_count`, `failed_chunks`, `cached_clusters`, `uncached_clusters`, `cache_hit_rate`, `api_p50/p95/p99_ms`, `total_api_duration_ms`, `time_to_first_suggestion_ms`, `wall_clock_ms`, plus the U11 occupancy fields `peak_in_flight_batches`, `mean_in_flight_batches`, `wire_busy_ms`, `wire_span_ms` |
| `photo_import_api_error`             | A dispatch is stopped by a rejection                        | `error_type`: `quota_exhausted` \| `rate_limited` \| `entitlement_exhausted` \| `unknown`                                                                                                                                                                                                                      |
| `photo_import_workflow_completed`    | Every cluster confirmed, rejected or hidden                 | the existing counts and rates, plus `viewed_clusters` / `viewed_cluster_rate`                                                                                                                                                                                                                                  |
| `photo_import_workflow_exited`       | The user leaves with clusters unprocessed                   | the existing counts, plus `viewed_clusters`, `viewed_cluster_rate`, `enqueued_clusters`, `settled_clusters`, `unsettled_clusters`, `retry_attempts`, `retry_generations`, `max_retry_attempts_per_generation`                                                                                                  |

**Reading the occupancy fields.** `peak_in_flight_batches` is the high-water mark of requests on the wire; `mean_in_flight_batches` is the same quantity integrated over time and divided by `wire_span_ms`, so it reports how much of the pool the run actually used. A peak of 3 with a mean near 1 is a preparation-bound run, not a network-bound one — `wire_span_ms - wire_busy_ms` is the dead air more concurrency cannot remove. `total_api_duration_ms` sums per-batch durations and therefore **over-counts** once batches overlap; use `wall_clock_ms` for elapsed time and the occupancy pair for the shape of it.

**Reading the exit split.** `enqueued_clusters` is what dispatch accepted, `settled_clusters` the subset that got a response or a failure. `unsettled_clusters` is the abandoned tail, and it is expected to be non-zero: progressive results are designed so a user can confirm what they want and leave. `viewed_cluster_rate` is the input to the deferred on-demand-dispatch idea — if the median import only ever surfaces a fraction of its clusters, matching all of them up front is buying results nobody looks at.

### Place ids are hashed — `original_suggestion_place_id` is gone

`photo_import_place_confirmed` and `photo_import_place_rejected` used to emit the raw Google Place ID as `original_suggestion_place_id`. That violated the rule at the top of this section: a place id next to an identified PostHog user says that a specific person was at a specific venue. The property is now **`original_suggestion_place_hash`** — a stable, non-reversible 16-hex-char digest produced by `stableHash()` in `mobile/src/utils/stableHash.ts`.

The hash is computed inside the analytics helper, not at the call sites, so no current or future caller can forget it. The caller-facing prop is still `originalSuggestionPlaceId` and still takes the raw id; the helper is the boundary where the id stops. A missing id stays `null` rather than becoming a digest.

The digest is deterministic across app launches, devices and users (there is deliberately no per-install salt), so grouping by venue, joining a confirm against a reject for the same place, and spotting a venue that is mis-ranked repeatedly all still work. What is gone is the readable venue identity — you can no longer tell _which_ venue a bucket is without already knowing its place id, and you can no longer look one up in the Places API from analytics alone.

**Dashboard owners must repoint.** Anything keyed on `original_suggestion_place_id` — match-quality breakdowns, repeat-mis-ranking queries, any saved PostHog insight or cohort filtering on that property — has to move to `original_suggestion_place_hash`. The property was renamed rather than reused precisely so a stale dashboard fails loudly (empty) instead of silently mixing hashed and raw values in one bucket. Values recorded before the rename cannot be joined to values recorded after it, so treat the release boundary as a hard break in that series.

### Population changes — read this before comparing across releases

Three shifts break naive time-series comparisons through the progressive-loading release:

1. **`failed_chunks` was always 0 before U14.** It was read through a stale closure that predated the dispatch it described. It is live now, so a jump at that release boundary is instrumentation coming online, not a reliability regression.
2. **A rate-limited run now emits completion _as well as_ an error (U6).** Dispatch used to throw on a fatal 429/503, which suppressed `photo_import_suggestions_completed` entirely; it now resolves partially and reports the rejection on the result. The completion population therefore gained runs that never used to appear in it, and those runs have a **lower `suggestion_count`** and a **non-zero `failed_chunks`** that this population never previously contained. Segment on `photo_import_api_error` when comparing suggestion counts across the boundary.
3. **`entitlement_exhausted` was split out of `unknown` (U11).** The 402 photo-import limit used to land in the `unknown` error bucket. A drop in `unknown` at this release is that reclassification.

### Backend phase metrics

The backend emits one `place_matcher_phase_metrics` line per request with `phase_ms` (search / vision_wait / enrichment / backfill), `cache`, `outbound`, `retries` and `vision.null_reasons`. Two vision numbers exist and they answer different questions: **`phase_ms.vision_wait` is the RESIDUAL wait vision adds on top of search** (the two run concurrently), while **`vision.total_ms` is vision's total wall time**. Tune ordering with the residual; size the vision budget with the total. `retries` is the rate-limit retry counter and is the leading indicator on the release watch list; the client-side counterpart is `retry_attempts` on the exit event.

### Ad-conversion baseline (`FirstPhotoImport`)

The once-per-lifetime photo-import ad conversion (`AdEvents.firstPhotoImportDone` → `/ad-events` → Meta CAPI + TikTok Events) was **re-anchored in U11** from "every cluster confirmed, rejected or hidden" to "first confirmation plus departure" — the same signal the review prompt on this screen uses. The old trigger becomes markedly rarer under progressive interaction, so the change should _raise_ volume; it must still be watched, because the trigger moved.

**Capture the baseline before this release ships.** It cannot be reconstructed afterwards.

- **What to query:** weekly count of distinct users with a `FirstPhotoImport` event, in Meta Events Manager (or the equivalent TikTok Events report), for the **four full weeks before the release date**. Record the four weekly numbers and their mean in the table below. Cross-check against the backend's `/ad-events` request log for the same window — the ad networks dedupe, the backend does not.
- **When to read it:** weekly, for the **first six weeks after release**, alongside the rest of the release watch list.
- **Threshold that triggers a further change:** a drop of **more than 25% against the four-week baseline mean, sustained over two consecutive weeks**. One bad week is noise (the event is per-user-lifetime, so it tracks new-user volume as much as behavior). If the threshold trips, the trigger is the suspect: check whether `photo_import_workflow_exited` volume held steady while conversions fell, which would mean departures stopped carrying a confirmation.
- **Who reads it:** the product owner (Emerson), as part of the weekly release watch. Nobody else is subscribed to this number.

| Week (pre-release) | `FirstPhotoImport` users |
| ------------------ | ------------------------ |
| W-4                | _fill before release_    |
| W-3                | _fill before release_    |
| W-2                | _fill before release_    |
| W-1                | _fill before release_    |
| **Baseline mean**  | _fill before release_    |

## Library job runtime and continuation

Both long-running library passes — the trip scan and the Guess Where build —
run inside one checkpointed **job runtime** (`mobile/src/services/jobs/`).
Job owners register a `JobDescriptor` (ordered `steps`, resume `gates`,
staleness / stuck thresholds); the runtime owns the start lock, the durable
breadcrumb (`job:<kind>:state` in the photo cache DB, with `lastCheckpointAt`),
the step loop, cancellation, and a depth-1 queue (the two kinds are mutually
exclusive — they share the SQLite cache writer lock).

**Drivers.** The runtime exposes `registerJobDriver({onStarted, onSettled,
onHeartbeat, onIdle, shouldYield})` on `jobRuntimeState`. Drivers get a
synchronous view of every start / settle / heartbeat / idle, keyed by a
process-monotonic `generation`, and the loop *pulls* `shouldYield(kind,
generation)` from every driver between units. No driver ever aborts a step:
stopping happens only at a unit boundary, after the checkpoint is written, and
settles as `suspended` with the breadcrumb kept.

Three layers try to keep a job moving when the user leaves the app, from most
to least reliable:

1. **Continued-processing lease (iOS 26+)** — `continuationLease.ts` +
   `modules/job-continuation/` (Swift). When a job starts in the foreground the
   driver `begin()`s a `BGContinuedProcessingTask` (one static identifier,
   `com.atlasi.app.continued-processing`, registered at launch, submitted with
   `.queue`). iOS shows a system progress UI with a cancel control and keeps the
   app executing while the task reports progress. The lease is held **per
   runtime**: a queued job takes it over with `updateTitle()`, and `end()` fires
   on runtime idle. Progress is a stage-weighted, never-decreasing synthetic
   value (`continuationProgress.ts`), coalesced to ≤4 pushes/s. An expiration
   (system reclaim or system-UI cancel — indistinguishable) marks the leased
   `(kind, generation)`; `shouldYield` answers yes only while the app is still
   not active at pull time, and the job settles `suspended`. A resumed run may
   re-acquire **once per kind** after an expiration. Kill switch:
   `features.enableJobContinuationLease` (JS, ships OTA).
2. **Grace window (any iOS)** — the same module starts a named
   `UIBackgroundTask` on `OnAppEntersBackground` while a lease is active.
   Its expiry (~30 s) **does not** request a yield: iOS freezes the process and
   a frozen process that survives continues where it was on the next
   foreground (the scan's extraction pass is one unit anyway).
3. **Opportunistic `BGProcessingTask`** — `backgroundJobTask.ts`. iOS may run
   it overnight on charge; it cannot be requested. It never acquires a lease
   (`isExecutingInBackgroundHandler()`), and its expiration is a yield request.

**Resume gates (foreground).** `useAppStateTracking` calls
`markForegroundReturn()` then `tryResumeJobs()` *synchronously* on
`background → active` (outside the cancellable rAF burst). For each kind:
await a pending cancel → skip if running → read the breadcrumb → staleness
(from the most recent of `startedAt` / `lastCheckpointAt`; 60 min scan,
30 min quiz) → other job running → descriptor gates → `startJob(resumed:true)`.
A `waiting` job whose peer is no longer running is started too. Stuck
detection (`detectStuckJobs`, in the burst) only considers kinds the runtime is
actually running — a suspended job keeps its `running` slice and belongs to
resume. The quiz hunt's 90 s soft deadline counts **executing** time
(`quizHuntClock.ts`), so frozen minutes never finalize a build at the minimum.

**Copy.** `constants/scanCopy.ts` still bans "background" / "while the app is
closed". The one tier-gated exception, `leaveHintWhileLeased(kind)`, renders
only while `continuationLeaseStore` reads `running` on the `continued` tier.

**OTA safety.** The JS never imports the native module statically from runtime
code; `modules/job-continuation/index.ts` uses `requireOptionalNativeModule`
and every function is a no-op when it is absent, so the bundle can publish onto
binaries built before the module. On-device verification:
`docs/plans/2026-08-23-1325-on-device-continuation-checklist.md`.

## Key Files

| File                                                     | Purpose                                |
| -------------------------------------------------------- | -------------------------------------- |
| `mobile/src/screens/photos/PhotoImportScreen.tsx`        | Main photo import UI                   |
| `mobile/src/components/photos/StageHero.tsx`             | Full-bleed navy stage + visible-band insets for carousel, idle, and scan |
| `mobile/src/components/photos/ScanStage.tsx`             | Live scan stage: reading grid + stamps |
| `mobile/src/components/photos/StampScatter.tsx`          | Scattered stamps with tucked photos    |
| `mobile/src/components/photos/ReadingGrid.tsx`           | Live grid of photos being read         |
| `mobile/src/screens/photos/PhotoTripsScreen.tsx`         | Browse photo-discovered trips          |
| `mobile/src/services/photoImport/visionPhoto.ts`         | Vision photo selection and preparation |
| `mobile/src/services/photoImport/photoBackgroundSync.ts` | Background cache refresh               |
| `mobile/src/services/photoImport/photoClustering.ts`     | Geohash clustering with adjacent merge |
| `mobile/src/hooks/usePhotoTrips.ts`                      | SQLite cache access for photo trips    |
| `mobile/src/hooks/useMultiClusterUpload.ts`              | Concurrent cluster uploads             |
| `backend/app/api/photos.py`                              | `/photos/suggest-places` endpoint      |
| `backend/app/services/place_matcher/matcher.py`          | PlaceMatcher orchestrator              |
| `backend/app/services/place_matcher/_matcher_ranking.py` | Vision-integrated place ranking        |
| `backend/app/services/place_matcher/_matcher_search.py`  | Density-adaptive search logic          |
| `backend/app/services/photo_vision/classifier.py`        | Photo classification via Gemini        |
