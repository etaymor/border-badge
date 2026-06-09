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
- `usePlaceSuggestions.ts` - Fetch place suggestions with chunking, caching, and vision data
- `useEntryCreation.ts` - Create entries from confirmed suggestions
- `usePhotoImportWorkflow.ts` - Orchestrates multi-phase workflow
- `useWorkflowAnalytics.ts`, `useAutoStartWorkflow.ts`, `useClusterItems.ts`, `useScanLifecycle.ts`, `useWorkflowNavigation.ts`

### Mobile Hooks (`mobile/src/hooks/`)

- `usePhotoTrips.ts` - Access photo-discovered trips from SQLite cache with search/filter by country
- `useMultiClusterUpload.ts` - Manage concurrent photo uploads from multiple location clusters

### Backend Place Matcher (`backend/app/services/place_matcher/`)

PlaceMatcher uses a mixin pattern for separation of concerns. When modifying matching behavior, identify the correct mixin file rather than editing `matcher.py` directly.

- `matcher.py` - PlaceMatcher orchestrator (inherits SearchMixin, RankingMixin, ClusterProcessingMixin)
- `_matcher_search.py` - Density-adaptive tiered radius search, Text Search API fallback, tourist relevance filter
- `_matcher_ranking.py` - Vision-integrated scoring with 7 configurable weights (distance, reviews, rating, fame, dwell, vision, name-match)
- `_matcher_cluster_processing.py` - Parallel cluster processing with vision result integration
- `cache.py` - LRU cache with TTL and single-flight pattern for deduplication
- `constants.py` - Search radii, density thresholds, place type mappings, quality filters
- `utils.py` - Haversine distance, coordinate utilities, name/address sanitization

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

| Category  | Maps to Entry Type | Example Places                  |
| --------- | ------------------ | ------------------------------- |
| food      | Food               | Restaurants, cafes, bars        |
| landmark  | Place              | Museums, monuments, temples     |
| stay      | Stay               | Hotels, resorts, hostels        |
| shopping  | Experience         | Markets, malls, stores          |
| nature    | Experience         | Parks, beaches, gardens         |
| nightlife | Experience         | Clubs, casinos, bars            |
| transport | (no mapping)       | Airports, stations              |
| unknown   | (no mapping)       | Unclear photos                  |

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
- Cost: ~$0.00008 per photo at 768px via OpenRouter

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

Use `--pipeline` to additionally simulate the tiered Nearby search per sample (treating the sample's places as the world): it reports candidate **recall** (did the visited place get fetched at all), end-to-end top-1, and the average number of paid Nearby calls per cluster. `--stop-threshold 1` reproduces the legacy stop-at-first-hit search for before/after comparison — ranking-only metrics cannot see recall failures, which were the dominant real-world miss mode.

The sample dataset (9 labeled clusters) encodes the observed real-world failure modes: a mega-famous neighbor outranking the signage-matched place actually visited, GPS drift putting the visited place 75m from the centroid, and low-review hidden gems. To grow it into a real tuning corpus, add labeled samples from actual trip imports (cluster centroid + candidate places + the place the user actually picked).

## Key Files

| File                                                            | Purpose                                 |
| --------------------------------------------------------------- | --------------------------------------- |
| `mobile/src/screens/photos/PhotoImportScreen.tsx`               | Main photo import UI                    |
| `mobile/src/screens/photos/PhotoTripsScreen.tsx`                | Browse photo-discovered trips           |
| `mobile/src/services/photoImport/visionPhoto.ts`                | Vision photo selection and preparation  |
| `mobile/src/services/photoImport/photoBackgroundSync.ts`        | Background cache refresh                |
| `mobile/src/services/photoImport/photoClustering.ts`            | Geohash clustering with adjacent merge  |
| `mobile/src/hooks/usePhotoTrips.ts`                             | SQLite cache access for photo trips     |
| `mobile/src/hooks/useMultiClusterUpload.ts`                     | Concurrent cluster uploads              |
| `backend/app/api/photos.py`                                     | `/photos/suggest-places` endpoint       |
| `backend/app/services/place_matcher/matcher.py`                 | PlaceMatcher orchestrator               |
| `backend/app/services/place_matcher/_matcher_ranking.py`        | Vision-integrated place ranking         |
| `backend/app/services/place_matcher/_matcher_search.py`         | Density-adaptive search logic           |
| `backend/app/services/photo_vision/classifier.py`               | Photo classification via Gemini         |
