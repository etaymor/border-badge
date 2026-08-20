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

- `IdlePhase.tsx`, `ScanningPhase.tsx`, `SuggestionsPhase.tsx` - Workflow phase UIs
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

Use `--pipeline` to additionally simulate the tiered Nearby search per sample (treating the sample's places as the world): it reports candidate **recall** (did the visited place get fetched at all), end-to-end top-1, and the average number of paid Nearby calls per cluster. `--stop-threshold N` overrides `places_min_quality_results_before_stop` for the run (`--stop-threshold 1` reproduces the legacy stop-at-first-hit search) for before/after recall/cost comparison — ranking-only metrics cannot see recall failures, which were the dominant real-world miss mode. Two cost-lever sims make the remaining Set-2 levers measurable offline: `--simulate-type-filter` (drops candidates whose `types` fall outside the `SEARCHABLE_PLACE_TYPES` allowlist — the C5 lever) and `--simulate-text-rescue` (a name-match text-search rescue against the world, reporting `avg_text_search_calls` — the C2 lever).

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

## Key Files

| File                                                     | Purpose                                |
| -------------------------------------------------------- | -------------------------------------- |
| `mobile/src/screens/photos/PhotoImportScreen.tsx`        | Main photo import UI                   |
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
