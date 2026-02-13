---
title: "Photo Matching Accuracy Improvements"
type: feat
date: 2026-02-11
---

# Photo Matching Accuracy Improvements

## Overview

Dramatically improve the photo-to-place matching accuracy by solving two core problems: **city disambiguation** (picking the wrong nearby venue in dense areas) and **split clusters** (photos across a large venue creating duplicate suggestions). The solution layers smarter clustering, time-based signals, tourist relevance filtering, an enhanced ranking algorithm, and lightweight vision AI (1 photo per cluster) — keeping costs under $0.25 per import.

## Problem Statement

The current photo import system matches GPS clusters to nearby places using a simple distance + review count formula. This works well in sparse areas but fails in two common scenarios:

1. **Dense urban areas:** A 15m radius in central Tokyo contains dozens of restaurants, bars, and cafes. The system picks whichever has the most reviews closest by, which is often wrong — it might suggest the cafe next door instead of the restaurant the user actually visited.

2. **Large venues:** Photos taken across historical ruins, parks, or resorts span multiple geohash cells (precision 7 = ~153m). Each cell generates its own cluster, and each cluster suggests a different place for what was really one location.

**Current system gaps** (from code audit):
- Geohash precision 7 with **no adjacent cell merging** — boundary-straddling venues get split
- Google `rating` field is fetched but **never used** in ranking ([constants.py:216-217](backend/app/services/place_matcher/constants.py#L216-L217)) — only `userRatingCount`
- Maximum search radius is 125m — remote/rural locations may miss entirely
- No photo content analysis — all venue types treated equally regardless of context
- No time-of-day signals used for category inference
- **No tourist relevance filtering** — laundromats, gas stations, offices appear as suggestions if they have enough reviews
- Ranking formula is only `distance_m/20 - log10(review_count+1)` ([matcher.py:465-479](backend/app/services/place_matcher/matcher.py#L465-L479))

## Proposed Solution

A phased approach that maximizes accuracy gains per phase while controlling complexity and cost.

## Technical Approach

### Architecture

The changes span three layers:

```
┌─────────────────────────────────────────────────────────┐
│  Mobile (photoClustering.ts, usePlaceSuggestions.ts)     │
│  - Adjacent geohash cell merging (Phase 1)              │
│  - Time hint computation from photo timestamps (Phase 1)│
│  - Representative photo selection for vision (Phase 2)  │
│  - Swipeable alternative suggestions UI (Phase 3)       │
└───────────────────────┬─────────────────────────────────┘
                        │ POST /photos/suggest-places
                        │ + time_hint, vision_image (Phase 2)
┌───────────────────────▼─────────────────────────────────┐
│  Backend API (photos.py)                                │
│  - Accept time hints per cluster (Phase 1)              │
│  - Orchestrate vision classification (Phase 2)          │
│  - Route to Text Search when text detected (Phase 3)    │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│  Place Matcher (matcher.py, constants.py)               │
│  - Density detection from first search (Phase 1)        │
│  - Tourist relevance filter (Phase 1)                   │
│  - Enhanced ranking: rating + fame + category (Phase 1) │
│  - Density-adaptive search radii (Phase 1)              │
│  - Vision category filtering (Phase 2)                  │
└─────────────────────────────────────────────────────────┘
```

### Implementation Phases

#### Phase 1: Algorithmic Improvements (No New APIs)

The highest-impact changes that require no new external services, API keys, or costs. Everything here uses data we already have or can compute locally.

##### 1A. Adjacent Geohash Cell Merging (Mobile)

**File:** [photoClustering.ts:34-76](mobile/src/services/photoImport/photoClustering.ts#L34-L76)

Add a `mergeAdjacentClusters()` function that runs after `clusterByLocation()`:

```typescript
// photoClustering.ts

const DEFAULT_MERGE_THRESHOLD_M = 80; // Used before density data is available

export function mergeAdjacentClusters(
  clusters: LocationCluster[],
  thresholdMeters: number = DEFAULT_MERGE_THRESHOLD_M
): LocationCluster[] {
  const n = clusters.length;
  if (n <= 1) return clusters;

  // --- Union-Find (inline, path compression + union by size) ---
  // O(N² × α(N)) ≈ O(N²) since α(N) < 5 for any practical input.
  // For typical trip sizes (5-50 clusters), this runs in <1ms.
  const parent = new Int32Array(n);
  const size = new Int32Array(n);
  for (let i = 0; i < n; i++) { parent[i] = i; size[i] = 1; }

  function find(x: number): number {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    // Iterative path compression (safer than recursive on Hermes)
    while (parent[x] !== root) { const next = parent[x]; parent[x] = root; x = next; }
    return root;
  }
  function union(a: number, b: number): void {
    const rootA = find(a), rootB = find(b);
    if (rootA === rootB) return;
    if (size[rootA] < size[rootB]) { parent[rootA] = rootB; size[rootB] += size[rootA]; }
    else { parent[rootB] = rootA; size[rootA] += size[rootB]; }
  }

  // --- Pairwise distance check with geohash prefix pre-filter ---
  // Clusters not sharing a 5-char geohash prefix are >4.9km apart → skip haversine
  const PREFIX_LEN = 5;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (clusters[i].geohash.substring(0, PREFIX_LEN) !==
          clusters[j].geohash.substring(0, PREFIX_LEN)) continue;

      const dist = haversine(
        clusters[i].centroid.latitude, clusters[i].centroid.longitude,
        clusters[j].centroid.latitude, clusters[j].centroid.longitude
      );
      if (dist <= thresholdMeters) union(i, j);
    }
  }

  // --- Group by root and build merged clusters ---
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const group = groups.get(root) ?? [];
    group.push(i);
    groups.set(root, group);
  }

  const merged: LocationCluster[] = [];
  for (const indices of groups.values()) {
    if (indices.length === 1) { merged.push(clusters[indices[0]]); continue; }

    // Weighted centroid by photo count (anchors centroid near densest cluster)
    let weightedLat = 0, weightedLng = 0, totalPhotos = 0;
    const allPhotos: PhotoWithLocation[] = [];
    let earliest = Infinity, latest = -Infinity;

    for (const idx of indices) {
      const c = clusters[idx];
      const w = c.photos.length;
      weightedLat += c.centroid.latitude * w;
      weightedLng += c.centroid.longitude * w;
      totalPhotos += w;
      allPhotos.push(...c.photos);
      const s = c.timeRange.start.getTime(), e = c.timeRange.end.getTime();
      if (s < earliest) earliest = s;
      if (e > latest) latest = e;
    }

    // Preserve largest constituent cluster's ID for cache stability
    const largestIdx = indices.reduce((best, idx) =>
      clusters[idx].photos.length > clusters[best].photos.length ? idx : best
    );

    merged.push({
      id: clusters[largestIdx].id,
      geohash: clusters[largestIdx].geohash,
      centroid: { latitude: weightedLat / totalPhotos, longitude: weightedLng / totalPhotos },
      photos: allPhotos,
      timeRange: { start: new Date(earliest), end: new Date(latest) },
      countryCode: clusters[largestIdx].countryCode,
    });
  }
  return merged;
}
```

**Key design decisions (from research):**
- **Union-find with Int32Array**: 4 bytes/element vs 8 for regular arrays, avoids Hermes boxing overhead
- **Iterative path compression**: Avoids stack overflow risk on React Native's Hermes engine
- **Weighted centroid by photo count**: A 30-photo cluster's centroid stays anchored vs being pulled by a 2-photo GPS-drift cluster. At 80m scale, arithmetic mean of lat/lng is accurate to <1mm (no great-circle averaging needed).
- **No max cluster diameter check**: Chain merging via union-find transitivity is usually correct (e.g., tourist walking across Angkor Wat). Time-gap segmentation already prevents unreasonable chains. If issues arise, tighten density-aware merge thresholds rather than adding diameter limits.
- **Haversine, not Vincenty**: At <300m distances, haversine error is <1m. GPS phone accuracy (5-15m) dwarfs any formula difference.
- **Stay with geohash+merge over DBSCAN**: Geohash is O(N) for initial grouping, supports incremental updates, and the geohash is already cached in SQLite (`CachedPhoto.geohash`). DBSCAN would be O(N²) on all points and require re-clustering on each import.

Call this in `createTripCandidate()` ([photoClustering.ts:226-244](mobile/src/services/photoImport/photoClustering.ts#L226-L244)) after `clusterByLocation()`:

```typescript
const locationClusters = mergeAdjacentClusters(clusterByLocation(photos, tripPrefix));
```

And in `clusterFromCachedPhotos()` ([photoClustering.ts:468-508](mobile/src/services/photoImport/photoClustering.ts#L468-L508)) — wrap the return value:

```typescript
return mergeAdjacentClusters(Array.from(groups.entries()).map(([hash, clusterPhotos]) => { ... }));
```

Also add a local haversine function to photoClustering.ts (port from [utils.py:48-78](backend/app/services/place_matcher/utils.py#L48-L78)):

```typescript
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
```

**Testing approach:**
- Unit test: Two clusters 50m apart should merge at 80m threshold, stay separate at 40m
- Unit test: Three clusters in a chain (A-B 60m, B-C 60m, A-C 100m) — all merge at 80m via union-find transitivity
- Unit test: Merged cluster has combined photos, extended time range, weighted centroid (not simple average)
- Unit test: Merged cluster preserves largest constituent's ID for cache compatibility
- Unit test: Clusters with different 5-char geohash prefixes are never merged (>4.9km apart)

**Merge threshold rationale (80m default):**
Geohash precision 7 cells are ~153m × ~153m. Two adjacent cell centroids can be up to ~216m apart (diagonal), but photos near a shared boundary produce cluster centroids typically 50-100m apart. An 80m threshold catches the vast majority of boundary splits while being unlikely to merge genuinely separate venues. GPS accuracy on modern phones is 5-15m outdoors, 10-20m in urban canyons, with multipath errors up to 30m.

##### 1B. Time-of-Day Category Inference (Mobile → Backend)

**Mobile files:**
- [usePlaceSuggestions.ts](mobile/src/screens/photos/usePlaceSuggestions.ts) — Compute time hints before sending clusters
- [types.ts:120-136](mobile/src/services/photoImport/types.ts#L120-L136) — Add `time_hint` to `PlaceSuggestionRequest`

**Backend files:**
- [photos.py:68-85](backend/app/schemas/photos.py#L68-L85) — Add `time_hint` field to `PhotoCluster` schema
- [matcher.py:405-487](backend/app/services/place_matcher/matcher.py#L405-L487) — Pass time_hint to ranking

Compute on mobile from cluster's `timeRange`:

```typescript
type TimeHint = 'food' | 'attraction' | 'nightlife' | 'quick_stop' | null;

function computeTimeHint(cluster: LocationCluster): TimeHint {
  const startHour = cluster.timeRange.start.getHours();
  const dwellMs = cluster.timeRange.end.getTime() - cluster.timeRange.start.getTime();
  const dwellMinutes = dwellMs / (1000 * 60);

  const isMealTime = (startHour >= 11 && startHour < 15) || (startHour >= 17 && startHour < 22);
  const isLateNight = startHour >= 22 || startHour < 4;
  const isMorning = startHour >= 6 && startHour < 11;
  const isLongDwell = dwellMinutes >= 90;   // Lowered from 120: 90min museum visits are common
  const isShortDwell = dwellMinutes < 45;

  // Priority order: dwell time > time-of-day (longer signals are stronger)
  if (isLongDwell) return 'attraction';
  if (isLateNight && dwellMinutes < 90) return 'nightlife';  // NEW: covers bars/clubs
  if (isMealTime && isShortDwell) return 'food';
  if (isMorning && isShortDwell) return 'food';  // Breakfast/coffee
  if (isShortDwell) return 'quick_stop';
  if (isMealTime) return 'food';  // Medium dwell at meal time: leisurely meal
  return null;
}
```

**Changes from original plan (research-backed):**
- **Added `nightlife` category**: Covers 22:00-04:00 window (bars, clubs, casinos)
- **Lowered attraction threshold to 90 min**: People often spend 90min at a museum — 120min was too aggressive
- **Added morning short-dwell → food**: Breakfast/coffee stops
- **Added medium dwell (45-90min) at meal time → food**: Leisurely restaurant meals
- **Dwell time is prioritized over time-of-day**: A 3-hour photo span is a stronger signal than "it was lunchtime"

**Backend type mapping** (add to constants.py):

```python
TIME_HINT_TYPE_MATCHES: dict[str, set[str]] = {
    "food": {
        "restaurant", "cafe", "coffee_shop", "bar", "bakery",
        "fine_dining_restaurant", "seafood_restaurant", "steak_house",
        "pizza_restaurant", "sushi_restaurant", "ice_cream_shop",
        "wine_bar", "pub", "tea_house",
        # Plus all *_restaurant types from TYPE_TO_CATEGORY
    },
    "attraction": {
        "museum", "art_gallery", "historical_landmark", "monument",
        "tourist_attraction", "cultural_landmark", "amusement_park",
        "aquarium", "zoo", "botanical_garden", "national_park", "park",
        "beach", "hiking_area", "garden", "wildlife_park",
        "observation_deck", "performing_arts_theater",
    },
    "nightlife": {
        "bar", "night_club", "casino", "wine_bar", "pub", "comedy_club",
    },
    "quick_stop": {
        "cafe", "coffee_shop", "bakery", "ice_cream_shop",
        "market", "store", "shopping_mall",
    },
}
```

##### 1C. Urban Density Detection (Backend)

**File:** [matcher.py:174-201](backend/app/services/place_matcher/matcher.py#L174-L201)

Modify `_search_nearby_tiered()` to detect density from the first search result count:

```python
# matcher.py

class DensityLevel(Enum):
    DENSE = "dense"
    MEDIUM = "medium"
    SPARSE = "sparse"

def _detect_density(self, result_count_at_first_radius: int) -> DensityLevel:
    """Detect area density from first-tier search result count.

    IMPORTANT: Thresholds are calibrated for type-filtered results
    (our 49 SEARCHABLE_PLACE_TYPES), not raw unfiltered counts.
    Getting 3+ tourist-type places in a 15m circle is genuinely dense.
    Getting 0 results at 15m does NOT mean sparse — the area could be
    dense with no tourist POIs at this exact GPS coordinate.
    """
    if result_count_at_first_radius >= 3:
        return DensityLevel.DENSE
    elif result_count_at_first_radius >= 1:
        return DensityLevel.MEDIUM
    else:
        # 0 results at 15m is ambiguous — use medium defaults
        # True sparse areas will also return 0 at wider radii
        return DensityLevel.SPARSE
```

**Key insight from research:** The original plan used 8+ results as the dense threshold, but our `includedTypes` filter (49 tourist types) dramatically reduces result counts vs unfiltered search. A 15m search in Manhattan with type filtering might return 2-3 results where unfiltered would return 10+. Thresholds are recalibrated accordingly.

**Why 0 results → SPARSE, not UNKNOWN:** Treating 0 as ambiguous and defaulting to medium radii is safer, but it means we always expand the search for areas with no immediate matches. Since SPARSE uses wider radii (25m, 100m, 250m), this catches both truly rural locations and dense areas where the GPS point didn't land on a venue.

Density drives all downstream behavior:

| Parameter | Dense (3+) | Medium (1-2) | Sparse (0) |
|-----------|-----------|--------------|--------------|
| Search radii | 15m, 35m, 75m | 15m, 50m, 125m | 25m, 100m, 250m |
| Merge threshold (backend 2nd pass) | 40m | 80m | 150m |

**File:** [constants.py](backend/app/services/place_matcher/constants.py) — Add `DENSITY_SEARCH_RADII` dict:

```python
DENSITY_SEARCH_RADII: dict[str, list[int]] = {
    "dense": [15, 35, 75],
    "medium": [15, 50, 125],   # Current behavior
    "sparse": [25, 100, 250],
}
```

**Implementation in `_search_nearby_tiered()`:**

```python
async def _search_nearby_tiered(self, latitude, longitude, time_hint=None):
    # First search at smallest radius (always 15m for density detection)
    raw_places = await self._execute_search(latitude, longitude, SEARCH_RADII_METERS[0])

    # Detect density from raw result count (BEFORE quality filtering)
    density = self._detect_density(len(raw_places))

    # Quality-filter the first tier results
    quality_places = self._filter_low_quality_places(raw_places)
    if quality_places:
        return quality_places, SEARCH_RADII_METERS[0]

    # Use density-adaptive radii for remaining tiers
    remaining_radii = DENSITY_SEARCH_RADII[density.value][1:]  # Skip first since already searched
    for radius in remaining_radii:
        places = await self._execute_search(latitude, longitude, radius)
        if places:
            quality_places = self._filter_low_quality_places(places)
            if quality_places:
                return quality_places, radius

    return [], 0
```

##### 1D. Tourist Relevance Filter (Backend)

**File:** [constants.py](backend/app/services/place_matcher/constants.py) — Add `NON_TOURIST_TYPES` set
**File:** [matcher.py:351-403](backend/app/services/place_matcher/matcher.py#L351-L403) — Apply in `_filter_low_quality_places()`

```python
# constants.py

NON_TOURIST_TYPES: set[str] = {
    # Services
    "laundry", "dry_cleaner",
    "gas_station", "car_wash", "car_repair",
    "bank", "atm",
    "post_office", "local_government_office",
    "storage",
    # Medical (non-emergency)
    "doctor", "dentist", "pharmacy",
    # Professional offices
    "real_estate_agency", "insurance_agency",
    "accounting", "lawyer",
    # Parking
    "parking",
}
```

This is a **hard filter** applied before ranking — these places are removed entirely, not penalized. If filtering removes ALL results at a radius tier, proceed to the next tier.

**Note on `convenience_store`:** Removed from the blocklist. Research confirms that in Japan, South Korea, Taiwan, and Thailand, convenience stores (konbini) are legitimate tourist experiences — they have guided konbini tours, viral TikTok/Instagram content, and are featured in travel guides. Since our search already uses `includedTypes` with curated tourist types, convenience stores only appear in results if Google tags them as such. No need for a regional exception — just exclude them from the blocklist entirely.

**Note on blocklist vs allowlist:** A blocklist is better than an allowlist because our `includedTypes` filter in the API request already acts as the allowlist (49 tourist types). The blocklist catches types that might appear in results via secondary type tagging (e.g., a building tagged as both `restaurant` and `parking`).

##### 1E. Enhanced Ranking Algorithm (Backend)

**File:** [matcher.py:405-487](backend/app/services/place_matcher/matcher.py#L405-L487)

Replace the current `sort_key` in `_rank_by_distance()` with research-backed scoring:

**1. Bayesian-adjusted rating (replaces raw rating)**

Raw Google ratings are unreliable for places with few reviews (4.8 stars with 5 reviews vs 4.2 stars with 5000 reviews). Use an IMDB-style Bayesian shrinkage estimator:

```python
# constants.py
BAYESIAN_PRIOR_MEAN = 3.8         # Global mean Google rating (approximate)
BAYESIAN_CONFIDENCE = 50          # ~25th percentile of review counts in typical results

# matcher.py
def _bayesian_rating(self, rating: float, review_count: int) -> float:
    """Shrink raw rating toward global mean based on review count.

    Places with few reviews collapse toward 3.8 (average).
    Places with many reviews keep their actual rating.

    Examples:
      4.8 stars, 5 reviews   → 3.89 (pulled toward mean)
      4.2 stars, 500 reviews  → 4.16 (mostly trusted)
      4.5 stars, 2000 reviews → 4.48 (almost fully trusted)
    """
    if not rating or review_count == 0:
        return BAYESIAN_PRIOR_MEAN
    return (review_count * rating + BAYESIAN_CONFIDENCE * BAYESIAN_PRIOR_MEAN) / (
        review_count + BAYESIAN_CONFIDENCE
    )
```

**2. Continuous fame bonus (replaces hard 1000-review threshold)**

A hard cutoff creates cliff effects and doesn't account for regional variation (famous Bangkok restaurant: 500 reviews, NYC spot: 5000). Use log-continuous scaling:

```python
# constants.py
FAME_FLOOR_REVIEWS = 50           # Below this: no fame bonus
FAME_SCALE = 0.5                  # Controls magnitude

# matcher.py
def _fame_bonus(self, review_count: int) -> float:
    """Continuous fame signal with diminishing returns.

    Returns: 0.0 for <50 reviews, ~0.5 for 500, ~1.0 for 5000, ~1.3 for 50000
    """
    if review_count < FAME_FLOOR_REVIEWS:
        return 0.0
    return max(0, (math.log10(review_count) - math.log10(FAME_FLOOR_REVIEWS)) * FAME_SCALE)
```

**3. Dwell-tiered time bonus (replaces flat 0.3 bonus)**

Dwell time is a stronger signal than time-of-day. A 3-hour photo span at a museum is a MUCH stronger signal than "it was lunchtime."

```python
# constants.py
DWELL_BONUS_TIERS: dict[tuple[float, float], float] = {
    (120, float("inf")): 0.8,     # Long visit: strong attraction signal
    (60, 120): 0.5,               # Medium-long visit
    (20, 60): 0.3,                # Typical meal/quick attraction
    (0, 20): 0.2,                 # Very short stop
}
```

**4. Complete scoring function:**

```python
def sort_key(x: dict) -> float:
    distance_m = x["distance_m"]
    review_count = x["_rating_count"]
    rating = x.get("_rating", 0)
    place_types = x.get("types", [])

    # Distance penalty: 1 point per 20m bucket (unchanged)
    distance_penalty = distance_m / 20.0

    # Review bonus: log scale (unchanged)
    review_bonus = math.log10(max(review_count, 1) + 1)

    # Rating bonus: Bayesian-adjusted, not raw
    adj_rating = self._bayesian_rating(rating, review_count)
    rating_bonus = max(0, (adj_rating - BAYESIAN_PRIOR_MEAN) * 0.75)

    # Fame bonus: continuous log scale
    fame = self._fame_bonus(review_count)

    # Dwell-aware category bonus: varies by dwell duration + type match
    dwell_cat = self._dwell_category_bonus(dwell_minutes, place_types, time_hint)

    # Lower score = better rank
    return distance_penalty - review_bonus - rating_bonus - fame - dwell_cat
```

Also requires:
- Passing `rating` through to `_rank_by_distance()` (it's already fetched via `FIELD_MASK` but discarded at [matcher.py:427-459](backend/app/services/place_matcher/matcher.py#L427-L459))
- Adding `_rating` and `_primary_type` internal fields alongside existing `_rating_count`
- Computing `dwell_minutes` from cluster's `start_time` / `end_time` (already sent by mobile)
- Adding `time_hint` parameter to `_rank_by_distance()` and `find_places_for_clusters()`

**Category matching approach:** Time hints use a **soft bonus** (0.2-0.8), never a hard filter. Hard filtering categories risks false negatives (e.g., a food market tagged as `tourist_attraction`). The `NON_TOURIST_TYPES` blocklist is the only hard filter. Foursquare found that switching from deterministic to probabilistic ranking improved accuracy by 4% and doubled unique venue detection.

**Future ML path:** Log every suggestion shown + user accept/reject decision. Once we have 5K+ data points, train XGBoost on the feature vector (distance, review_count, rating, bayesian_rating, dwell_minutes, time_hint_match, density_level, place_type). This is exactly the path Foursquare took — hand-tuned rules first, graduate to ML with training data.

#### Phase 2: Vision Classification (Gemini Flash Lite)

##### 2A. Vision Classification Service (Backend — New)

**New directory:** `backend/app/services/photo_vision/`

```
backend/app/services/photo_vision/
├── __init__.py
├── classifier.py     # Gemini Flash Lite client + prompt
└── constants.py      # Category enum, prompt template, type mappings
```

The classifier sends 1 representative photo per cluster to Gemini 2.5 Flash Lite via the existing OpenRouter setup (reuse `OPENROUTER_API_KEY` and patterns from [llm_client.py](backend/app/services/place_extractor/llm_client.py)). Returns:
- **Category:** food / landmark / stay / shopping / nature / nightlife / transport / unknown
- **Detected text:** Any visible text (signs, menus, facades, plaques) — array of strings
- **Confidence:** high / medium / low (categorical, not numeric — LLM numeric confidence is poorly calibrated)

**Use OpenRouter structured output** (`response_format` with `json_schema`) for guaranteed valid JSON, eliminating parsing issues:

```python
CLASSIFICATION_RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "photo_classification",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "enum": ["food", "landmark", "stay", "shopping",
                             "nature", "nightlife", "transport", "unknown"],
                },
                "detected_text": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "All visible text: signs, menus, logos, plaques, building names.",
                },
                "confidence": {
                    "type": "string",
                    "enum": ["high", "medium", "low"],
                },
                "reasoning": {
                    "type": "string",
                    "description": "Brief explanation (max 50 words)",
                },
            },
            "required": ["category", "detected_text", "confidence", "reasoning"],
            "additionalProperties": False,
        },
    },
}
```

**Cost analysis (research-confirmed):**

At 768px max dimension (1 tile = 258 image tokens):

| Component | Per cluster | 50 clusters |
|-----------|------------|-------------|
| Image tokens (258) | $0.0000258 | $0.00129 |
| Prompt tokens (~150) | $0.0000150 | $0.00075 |
| Output tokens (~100) | $0.0000400 | $0.00200 |
| **Total** | **~$0.00008** | **~$0.004** |

**$0.004 for 50 clusters** — 1.6% of $0.25 budget. Cost is not a constraint. The real cost bottleneck is Google Places API ($0.032/request, potentially $3-5 for 50 clusters with tiered radii).

**Model choice:** Gemini 2.5 Flash Lite remains the best choice:
- Lowest cost ($0.10/1M input tokens, 3-8x cheaper than alternatives)
- Excellent OCR (>95% on sign/menu text)
- Already configured in our OpenRouter setup
- Ultra-low latency (optimized for speed)

##### 2B. Representative Photo Selection (Mobile)

**File:** [usePlaceSuggestions.ts](mobile/src/screens/photos/usePlaceSuggestions.ts)

Select 1 photo per cluster for vision analysis using multi-criteria ranking:

```typescript
function selectRepresentativePhoto(
  cluster: LocationCluster
): PhotoWithLocation {
  if (cluster.photos.length === 1) return cluster.photos[0];

  return cluster.photos.reduce((best, photo) => {
    const bestScore = photoScore(best, cluster.centroid);
    const photoS = photoScore(photo, cluster.centroid);
    return photoS < bestScore ? photo : best;
  });
}

function photoScore(
  photo: PhotoWithLocation,
  centroid: { latitude: number; longitude: number }
): number {
  // Primary: distance to centroid (lower = better, most central photo)
  const distance = haversine(
    centroid.latitude, centroid.longitude,
    photo.location.latitude, photo.location.longitude
  );
  // Secondary: prefer landscape over portrait (selfie avoidance heuristic)
  // Note: Photo dimensions not available from MediaLibrary API without
  // additional fetch — consider adding if available
  return distance;
}
```

**Research findings:**
- **Closest to centroid** is the strongest heuristic — the most "central" photo best represents the location
- **Landscape over portrait** helps avoid selfies but photo dimensions require an extra MediaLibrary fetch. Consider as a future optimization.
- **Highest resolution** is not useful — modern phone photos are all similar resolution
- **Random** misses easy wins from the centroid heuristic

Resize to 768px max dimension and encode as base64 JPEG before sending:

```typescript
// Resize + encode (using expo-image-manipulator)
const resized = await ImageManipulator.manipulateAsync(
  photo.uri,
  [{ resize: { width: 768 } }],
  { format: SaveFormat.JPEG, compress: 0.8, base64: true }
);
```

##### 2C. Vision Integration in API (Backend)

**File:** [photos.py](backend/app/api/photos.py) — Orchestrate vision calls alongside place matching

Flow per cluster:
1. Start vision classification and first-tier place search **in parallel** (no latency increase)
2. If vision returns `confidence: "high"` → hard-filter place types to match category
3. If vision returns `confidence: "medium"` → soft bonus (1.5) to matching types
4. If vision returns `confidence: "low"` → ignore vision entirely
5. If vision detects text that looks like a business name → defer to Text Search (Phase 3)
6. If vision fails → continue with algorithmic-only matching (silent fallback)

**Defense-in-depth fallback chain:**
```
1. Vision + text detected  → Text Search API (highest accuracy)
2. Vision + high confidence → Type-filtered Nearby Search
3. Vision + medium confidence → All-type Nearby Search with category boost
4. Vision + low confidence → All-type Nearby Search (ignore vision)
5. Vision failed/timeout → All-type Nearby Search (current behavior)
```

**File:** [matcher.py](backend/app/services/place_matcher/matcher.py) — Add vision-aware ranking:

```python
# In _rank_by_distance(), add vision signal
category_match_bonus = 0.0
if vision and vision.confidence != "low":
    place_category = TYPE_TO_CATEGORY.get(primary_type, "place")
    vision_entry_cat = _vision_to_entry_category(vision.category)
    if place_category == vision_entry_cat:
        category_match_bonus = 1.5 if vision.confidence == "high" else 0.75
```

##### 2D. Schema Changes (Backend + Mobile)

Add to `PhotoCluster` schema:
- `vision_image_base64: str | None` — Base64 JPEG (768px, ~50-80KB). Simpler than signed URLs, acceptable payload size.
- `time_hint: str | None` — Already from Phase 1B

Add to response `PlaceSuggestion`:
- `vision_category: str | None` — What vision detected (for debugging/analytics)

**Common failure modes and mitigation:**

| Failure Mode | Frequency | Detection | Fallback |
|-------------|-----------|-----------|----------|
| Dark/blurry photos | ~10-15% | `confidence: "low"` | Ignore vision |
| Selfies | ~20-30% | Photo selection heuristic avoids; if selected, low confidence | Ignore vision |
| Interior shots (ambiguous) | ~15% | `confidence: "medium"` | Soft bonus only |
| Nature shots (venue off-camera) | ~10% | `category: "nature"` | Filters to parks/beaches/trails |
| Food close-ups | ~10% | `category: "food"`, `confidence: "high"` | Strong food type filter |
| Model timeout / API error | ~1-2% | httpx.TimeoutException | Silent fallback |

#### Phase 3: Text Search + Swipeable Alternatives UI

##### 3A. Text-Detected Google Places Text Search (Backend)

When vision detects readable text (restaurant name, hotel sign, landmark plaque):
- Use Google Places **Text Search API** instead of Nearby Search
- Search query = detected text + location bias (cluster centroid, 200m radius)
- This is the highest-accuracy path — directly searching by name

**Filter generic text** before triggering text search:

```python
GENERIC_WORDS = {"exit", "open", "closed", "welcome", "push", "pull",
                 "enter", "restroom", "bathroom", "wifi", "menu"}

# Only use text search for:
# - 2+ word phrases (likely a business name)
# - Not in GENERIC_WORDS set
# - From vision result with confidence != "low"
```

**New file:** Add `_execute_text_search()` method to `PlaceMatcher`
**File:** [constants.py](backend/app/services/place_matcher/constants.py) — Add `TEXT_SEARCH_URL`

**Cost consideration:** Text Search costs $0.032/request (same as Nearby Search on the new API). Only triggered when vision detects text with high confidence, so cost impact is minimal.

##### 3B. Swipeable Alternative Suggestions (Mobile)

**File:** [PhotoImportScreen.tsx](mobile/src/screens/photos/PhotoImportScreen.tsx) — Suggestion cards phase

Current: Shows top suggestion as primary card, alternatives require manual search.

New:
- Show top suggestion as primary card (unchanged)
- Add subtle indicator: "2 more options"
- Horizontal swipe/tap through alternatives without opening modal
- If auto-merge combined clusters, show combined photo count ("12 photos from this location")

#### Phase 4: Manual Cluster Merge (Fast Follow)

Deferred. On the suggestions screen, a "merge" action lets users drag one card onto another, combining them and re-running matching. Low priority because Phase 1 adjacent cell merging should handle most cases.

## Acceptance Criteria

### Phase 1: Algorithmic Improvements

#### Adjacent Cell Merging
- [x] Clusters whose centroids are within 80m merge automatically before backend processing
- [x] Merged clusters have combined photo lists, extended time ranges, weighted centroids (by photo count)
- [x] Merging reduces total cluster count sent to backend (fewer API calls)
- [x] Largest constituent cluster's ID is preserved for SQLite cache compatibility
- [x] Geohash prefix pre-filter skips haversine for pairs >4.9km apart
- [x] Unit tests cover: boundary straddling, transitive chain merging, non-overlapping clusters, weighted centroid accuracy

#### Time-of-Day Hints
- [x] Each cluster sent to backend includes a `time_hint` field (food/attraction/nightlife/quick_stop/null)
- [x] Time hints are computed from photo timestamps on mobile
- [x] Backend uses dwell-tiered time bonus (0.2-0.8) in ranking, not flat 0.3
- [x] Dwell time is prioritized over time-of-day in hint computation
- [x] A landmark at lunchtime still matches correctly (time hint never overrides stronger signals)

#### Density Detection
- [x] First Google Places search result count determines density level (dense/medium/sparse)
- [x] Thresholds calibrated for type-filtered results: 3+ = dense, 1-2 = medium, 0 = sparse
- [x] Dense areas use tighter search radii (15m, 35m, 75m)
- [x] Sparse areas use wider radii (25m, 100m, 250m) to catch remote locations
- [x] Density detection requires no additional API calls

#### Tourist Relevance Filter
- [x] Laundromats, gas stations, banks, offices, parking lots never appear as suggestions
- [x] If filtering removes all results at a tier, system expands to next radius
- [x] Filter is a hard blocklist, not a ranking penalty
- [x] `NON_TOURIST_TYPES` set is defined in constants.py for easy maintenance
- [x] Convenience stores are NOT blocked (legitimate tourist experience in Asia)

#### Enhanced Ranking
- [x] Google rating uses Bayesian adjustment (low-review inflation handled)
- [x] Fame bonus is continuous log scale (no 1000-review cliff)
- [x] Scoring formula: `distance/20 - log10(reviews) - bayesian_rating_bonus - fame - dwell_category_bonus`
- [x] A famous 4.5-star landmark at 40m beats a random 3.5-star business at 10m
- [ ] User accept/reject decisions are logged for future ML training data

### Phase 2: Vision Classification

- [x] 1 representative photo per cluster sent to Gemini Flash Lite (768px, base64)
- [x] Vision returns category + detected text + confidence (high/medium/low)
- [x] High confidence → hard type filter; medium → soft bonus (1.5); low → ignored
- [x] OpenRouter structured output ensures valid JSON (no parsing failures)
- [x] Vision runs in parallel with first-tier place search (no latency increase)
- [x] Vision failures fall back silently to algorithmic matching
- [x] Cost per import stays under $0.01 for 50 clusters (well within $0.25 budget)

### Phase 3: Text Search + UI

- [x] Detected business-name text triggers Google Places Text Search instead of Nearby Search
- [x] Generic text (EXIT, OPEN, WELCOME) is filtered out before triggering text search
- [x] Users can swipe through alternative suggestions on each card
- [x] Combined clusters show merged photo count

## Success Metrics

- **Accuracy:** Top suggestion is the correct place >70% of the time (up from estimated ~40-50%)
- **Split reduction:** Adjacent cell merging reduces duplicate suggestions by >50%
- **Relevance:** Zero non-tourist places (laundromats, gas stations) in suggestions
- **Cost:** Vision costs stay under $0.01 per 50-cluster import ($0.25 budget has 25x headroom)
- **Latency:** No significant increase in end-to-end suggestion time (vision runs in parallel with first search)

## Dependencies & Risks

### Phase 1 (Low Risk)
- **No new dependencies** — all changes use existing data and APIs
- **Backward compatible** — mobile-side merging reduces cluster count, backend accepts same schema (plus optional `time_hint`)
- **Risk: Merge threshold tuning.** 40m/80m/150m are starting points based on geohash cell geometry and GPS accuracy research. Plan to add logging to track merge rates and adjust.

### Phase 2 (Medium Risk)
- **New dependency:** OpenRouter API (already configured for social ingest LLM extraction)
- **New dependency:** Gemini 2.5 Flash Lite model access via OpenRouter
- **Photo upload:** Base64 encoding at 768px (~50-80KB per photo). Acceptable payload increase.
- **Risk: Vision accuracy.** Classification quality varies by photo content. Selfies, dark photos, or zoomed-in food shots may not classify well. Mitigated by three-tier confidence system and silent fallback.

### Phase 3 (Medium Risk)
- **Google Places Text Search API** costs $0.032/request (same as Nearby Search on new API). Only triggered on high-confidence text detection.
- **UI complexity:** Swipeable cards need smooth gesture handling. Consider existing library (react-native-pager-view or similar).

## Resolved Questions

From original brainstorm, now answered by research:

1. **Representative photo selection** → Closest to centroid, prefer landscape orientation. Centroid-proximity is the strongest heuristic. Resolution is not a useful signal.

2. **Text search pricing** → Google Places Text Search (New API) costs $0.032/request, same as Nearby Search. No cost concern — only triggered on high-confidence text detection.

3. **Merge threshold tuning** → 80m default is well-supported by geohash cell geometry (~153m cells) and smartphone GPS accuracy research (5-15m outdoor, 10-20m urban canyon). Density-adaptive thresholds (40/80/150m) handle different environments.

4. **Convenience store edge case** → Removed from blocklist entirely. Research confirms konbini are legitimate tourist experiences in Japan/Korea/Taiwan/Thailand — guided tours, viral social media content, travel guide features. Our `includedTypes` filter already limits what appears.

5. **Rating scaling** → Raw rating replaced with IMDB-style Bayesian average. Solves low-review inflation (4.8 stars with 5 reviews → 3.89 Bayesian). `BAYESIAN_CONFIDENCE = 50` as starting parameter.

6. **Fame threshold** → Hard 1000-review cutoff replaced with continuous log scale. Handles regional variation (500-review Bangkok restaurant gets 0.5 bonus, 50K-review Eiffel Tower gets 1.35).

7. **DBSCAN vs geohash** → Stay with geohash+merge. Better mobile performance (O(N) hash vs O(N²) DBSCAN), incremental update support, SQLite cache compatibility. The geohash+merge approach is conceptually equivalent to DBSCAN but optimized for our mobile context.

## Open Questions

1. **Bayesian prior tuning** — `C=3.8` and `m=50` are starting estimates. Track actual rating/review distributions from search results to calibrate.
2. **Dual-query for dense areas** — Research suggests fetching both distance-ranked and popularity-ranked results from Google, with a "consensus bonus" for places in both lists. Doubles API cost for dense areas. Evaluate after Phase 1 accuracy data.
3. **Photo dimensions for selection** — MediaLibrary API may not return width/height without additional fetch. If available cheaply, use landscape preference; otherwise, centroid-proximity alone is sufficient.

## References

### Internal

- [matcher.py](backend/app/services/place_matcher/matcher.py) — Current place matching logic (tiered search, ranking, quality filtering)
- [constants.py](backend/app/services/place_matcher/constants.py) — Search radii, place types, field mask, quality thresholds
- [photos.py](backend/app/api/photos.py) — API endpoint for place suggestions
- [photos schema](backend/app/schemas/photos.py) — Request/response models
- [photoClustering.ts](mobile/src/services/photoImport/photoClustering.ts) — Geohash clustering, trip segmentation
- [types.ts](mobile/src/services/photoImport/types.ts) — LocationCluster, PlaceSuggestion, ClusterSuggestion types
- [usePhotoImport.ts](mobile/src/hooks/usePhotoImport.ts) — Chunked API requests with progress tracking
- [usePlaceSuggestions.ts](mobile/src/screens/photos/usePlaceSuggestions.ts) — Place suggestion fetching with caching
- [PhotoImportScreen.tsx](mobile/src/screens/photos/PhotoImportScreen.tsx) — Suggestion cards UI
- [llm_client.py](backend/app/services/place_extractor/llm_client.py) — Existing OpenRouter client (reuse pattern for vision)
- [llm_utils.py](backend/app/core/llm_utils.py) — Shared LLM utilities (JSON parsing, API URL)
- [Brainstorm](docs/brainstorms/2026-02-11-photo-matching-accuracy-brainstorm.md) — Full brainstorm with decision rationale

### External

- [Google Places Nearby Search (New)](https://developers.google.com/maps/documentation/places/web-service/nearby-search)
- [Google Places Text Search (New)](https://developers.google.com/maps/documentation/places/web-service/text-search)
- [Google Places Place Types](https://developers.google.com/maps/documentation/places/web-service/place-types)
- [Gemini 2.5 Flash Lite via OpenRouter](https://openrouter.ai/google/gemini-2.5-flash-lite)
- [OpenRouter Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs)
- [Bayesian Average Ratings — Evan Miller](https://www.evanmiller.org/bayesian-average-ratings.html)
- [How Not To Sort By Average Rating — Evan Miller](https://www.evanmiller.org/how-not-to-sort-by-average-rating.html)
- [Bayesian Averages in Custom Ranking — Algolia](https://www.algolia.com/doc/guides/managing-results/must-do/custom-ranking/how-to/bayesian-average)
- [Switching to a Probabilistic Model — Foursquare](https://medium.com/foursquare-direct/switching-to-a-probabilistic-model-for-venue-search-in-foursquare-d7535445c09c)
- [Smartphone GPS Accuracy Study — PLOS One](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0219890)
- [Konbini Tourism — Japan Times](https://www.japantimes.co.jp/news/2025/11/02/japan/society/japan-konbini-tourism/)
