# Photo Matching Accuracy Improvements

**Date:** 2026-02-11
**Status:** Brainstorm complete
**Author:** Emerson + Claude

## What We're Building

A significantly more accurate photo-to-place matching system that solves two core problems:

1. **City disambiguation** — In dense urban areas, the system picks a nearby but wrong venue (e.g., the cafe next door instead of the restaurant you were at). GPS alone can't distinguish between venues 10-30m apart.

2. **Split clusters** — Photos taken across a large venue (historical ruins, parks, resorts) get separated into multiple clusters, each suggesting different places for what was really one location.

The solution combines three layers: smarter clustering, time-based signals, and lightweight vision AI (1 photo per cluster) to dramatically improve accuracy while keeping costs under $0.25 per import.

## Why This Approach

**Vision-Lite (1 photo/cluster)** was chosen over purely algorithmic improvements or a full vision + feedback system because:

- The "nearby but wrong" problem can't be solved with GPS alone — you need to understand _what_ the user was doing (eating vs sightseeing) to filter venue types
- 1 photo per cluster keeps costs at ~$0.003-0.005/cluster ($0.15-0.25 for 50 clusters) — economical enough for all users
- Text detection on signs/menus/facades is a game-changer when it works — directly searching by name is far more accurate than radius search
- Time-based signals (mealtime patterns, dwell duration) are free and correlate with venue type
- Manual merge UI can be added as a fast follow if auto-merging doesn't cover enough cases

## Key Decisions

### 1. Urban Density Detection (Adaptive Matching) — Check First

**Decision:** Detect density first, then use it to drive all downstream behavior — merge thresholds, search radii, signal weights, and filtering strictness.

**Why this comes first:** Density is the single most important context signal. A 50m radius in central Tokyo contains dozens of restaurants, bars, and cafes. The same radius in rural Tuscany might contain a single farmhouse. Every subsequent decision (how aggressively to merge, how much to trust time signals, how tight to search) depends on knowing this.

**Detection approach:**

- **Primary signal: Google Places result count at smallest radius.** After the first search at 15m, use the raw result count (before quality filtering) as a density proxy:
  - **Dense (8+ results at 15m):** Urban core — need maximum disambiguation, must be very specific
  - **Medium (3-7 results):** Suburban or small town — moderate disambiguation
  - **Sparse (0-2 results):** Rural, parks, or isolated landmarks — broader matching is safe
- **Secondary signal: Cluster density.** If multiple clusters exist within 200m of each other in the same time window, the user was likely in a dense walkable area.

**How behavior adapts by density:**

| Parameter             | Dense Urban                                     | Medium                   | Sparse/Rural                                    |
| --------------------- | ----------------------------------------------- | ------------------------ | ----------------------------------------------- |
| Merge threshold       | 40m (tight)                                     | 80m (default)            | 150m (wide)                                     |
| Vision importance     | Critical — must classify to disambiguate        | Useful — helps ranking   | Optional — often only 1 match                   |
| Search radii          | 15m, 35m, 75m (tighter)                         | 15m, 50m, 125m (default) | 25m, 100m, 250m (wider)                         |
| Time signal weight    | Light nudge                                     | Light nudge              | Minimal — fewer venues to distinguish           |
| Suggestion confidence | Require stronger signals before auto-suggesting | Default behavior         | Can suggest more confidently with fewer signals |

**Implementation note:** This doesn't require any new API calls — the density signal comes from the first Google Places search that we already make. It's essentially free metadata from an existing call, used to tune the second-tier search and ranking behavior.

### 2. Adjacent Geohash Cell Merging

**Decision:** Merge clusters whose centroids are within a density-adaptive threshold of each other before sending to backend.

**Context:** Current system uses geohash precision 7 (~153m cells) with no merging. Two photos 10m apart can end up in separate clusters if they straddle a cell boundary. A large venue spanning multiple cells creates duplicate suggestions.

**Implementation direction:**

- After initial geohash clustering, compute pairwise distances between cluster centroids
- Merge clusters within threshold (40m dense / 80m medium / 150m sparse) using union-find or greedy approach
- Recalculate centroid after merge
- Combine photo lists, extend time ranges
- This should be done on the mobile side before sending to backend, reducing API calls

**Note:** For the initial mobile-side merge (before we have density data from Google), use the default 80m threshold. The backend can then do a second-pass merge after density detection if needed.

### 3. Tourist Relevance Filter

**Decision:** Filter out places that tourists would never recommend, before ranking.

**Why:** The current quality filter only removes closed businesses and those with <5 reviews. But a laundromat with 50 reviews, a gas station, or a random office building should never be suggested to a traveler — these aren't places people recommend.

**Excluded place types (blocklist):**

- Laundromats / dry cleaners
- Gas stations / car washes / auto repair
- Banks / ATMs
- Post offices / government offices
- Storage facilities
- Medical offices / dentists / pharmacies (non-emergency)
- Real estate agencies / insurance offices
- Parking lots / garages
- Convenience stores (unless no better match exists)
- Generic "business" or "establishment" types with no specific travel category

**Implementation:** Add a `NON_TOURIST_TYPES` set to `constants.py`. Places matching these types are filtered out before ranking, similar to how closed businesses are already filtered. This is a hard filter, not a ranking penalty — these places should never appear as suggestions.

**Edge case:** If filtering removes ALL results at a radius tier, proceed to the next tier rather than showing a non-tourist result. Only show non-tourist places if absolutely nothing else matches (better to show "no suggestion" than a laundromat).

### 4. Improved Ranking Algorithm

**Decision:** Enhance the current distance + review count ranking with additional signals. Give ratings and famous landmarks a strong boost.

**New ranking factors:**

- **Google rating score** (currently fetched but unused) — a 4.5-star place should strongly beat a 3.0-star place at similar distance. This is one of the most reliable signals for "is this a place worth recommending?"
- **Famous landmark / high review count bonus** — places with 1000+ reviews are almost certainly notable landmarks, popular restaurants, or well-known attractions. These deserve a significant boost because they're the kind of places travelers actually visit and recommend.
- **Vision category match bonus** — if vision says "food" and the place is a restaurant, boost it
- **Time hint match bonus** — light nudge only, not dominant. A soft tiebreaker, not a primary signal.
- **Photo count in cluster** — more photos suggest the user spent more time there, which correlates with it being a notable/intentional visit (this is already available data)

**Proposed scoring:**

```
score = distance_penalty - review_bonus - rating_bonus - fame_bonus - category_match_bonus - time_match_bonus
```

Where:

- `distance_penalty = distance_m / 20.0` (unchanged)
- `review_bonus = log10(review_count + 1)` (unchanged)
- `rating_bonus = (rating - 3.0) * 0.75` if rating >= 3.0, else 0 (new — stronger than before)
- `fame_bonus = 1.0` if review_count >= 1000 (famous/notable place boost)
- `category_match_bonus = 1.5` if vision category matches place type (new)
- `time_match_bonus = 0.3` if time hint matches place type (new — deliberately light, just a nudge)

**Effect:** A famous 4.5-star landmark with 2000 reviews at 40m beats a random 3.5-star business at 10m. A well-rated restaurant at 25m beats an unrated one at 5m. Time hints gently nudge but never override stronger signals.

### 5. Time-of-Day Category Inference

**Decision:** Use photo timestamps as a lightweight signal — a gentle nudge for ranking, not a hard filter or dominant signal.

**Signals:**

- **Meal windows:** 11:00-14:30 or 17:30-22:00 → slight preference for food venues
- **Dwell duration:** Photos spanning 2+ hours at one location → slight preference for attractions/landmarks
- **Short dwell:** Under 45 minutes → slight preference for restaurants or quick stops

**How it's used:** Sent as a `time_hint` field with each cluster to the backend. Backend uses it as a soft tiebreaker in ranking (0.3 bonus — the weakest signal in the scoring formula). A landmark at lunchtime should absolutely still match correctly. Time hints should never cause the system to pick a worse place just because it matches the time pattern.

### 6. Vision Classification (1 Photo Per Cluster)

**Decision:** Send 1 representative photo per cluster to Gemini Flash Lite for classification.

**What the vision model returns:**

- **Category:** food / landmark / stay / shopping / nature / nightlife / transport
- **Detected text:** Any visible text — restaurant names, signs, menus, hotel logos, landmark plaques
- **Confidence:** How certain the classification is

**Representative photo selection:** Pick the photo closest to the cluster centroid (most "central" to the location). Avoid selfies if possible (heuristic: photos in portrait orientation with face detection metadata may be selfies — prefer landscape or non-face photos).

**How it's used on backend:**

- If **text is detected** (e.g., restaurant name): Use as a **text search query** via Google Places Text Search API instead of radius-based Nearby Search. This is the highest-accuracy path.
- If **category is detected** with high confidence: Filter place types to match the category before ranking. E.g., vision says "food" → only consider restaurant/cafe/bar types.
- If **vision fails or low confidence**: Fall back silently to algorithmic-only behavior (all types, distance + review + rating ranking). No user notification needed.

**Cost model:**

- Gemini 2.5 Flash Lite: ~$0.003 per image (at typical photo sizes)
- 50 clusters per trip = ~$0.15
- Premium feature gating: It is already gated as 1 photo trip per free user

### 7. Suggestion Card UX

**Decision:** Keep the current card-based flow but make alternatives more accessible via swipe/tap-through.

**Changes:**

- Show top suggestion as the primary card (unchanged)
- Add a subtle indicator showing "2 more options" or similar
- User can swipe/tap through alternatives without opening a separate modal
- No map view — keep it lightweight
- If auto-merge combined clusters, show the combined photo count ("12 photos from this location")

### 8. Manual Cluster Merge (Fast Follow)

**Decision:** Defer to a fast follow after the core accuracy improvements ship.

**Concept:** On the suggestions screen, a "merge" action that lets users drag one card onto another to combine them, then re-runs the matching. Low priority because adjacent cell merging (Decision 2) should handle most cases automatically.

## Open Questions

1. **Representative photo selection heuristic** — Should we use the most "central" photo, or the most recent, or the one with the best resolution? Need to test what works best for vision classification.

2. **Text search cost** — Google Places Text Search may cost more than Nearby Search per call. Need to verify pricing and whether the accuracy improvement justifies it for text-detected clusters.

3. **Merge threshold tuning** — The density-adaptive thresholds (40m/80m/150m) are starting points. Will need real-world tuning, possibly per-region.

4. **Convenience store edge case** — In some countries (Japan, South Korea), convenience stores are legitimate tourist recommendations. The tourist relevance filter may need regional exceptions.

## Resolved Questions

- **Vision API fallback:** Fall back silently to algorithmic-only matching. No user notification.
- **Premium gating for vision:** Already gated — free users get 1 photo trip import, so vision cost is bounded.

## Technical Notes

### Current System Gaps (from research)

- Geohash precision 7 (~153m) with **no adjacent cell merging** — boundary-straddling venues get split
- Google `rating` field is fetched but **never used** in ranking — only `userRatingCount`
- Maximum search radius is 125m — remote/rural locations may miss
- No photo content analysis — all venue types treated equally regardless of context
- No time-of-day signals used for category inference
- UI merging only happens post-hoc when two clusters independently resolve to the same `place_id`
- **No tourist relevance filtering** — laundromats, gas stations, offices can appear as suggestions if they have enough reviews

### Key Files to Modify

| File                                                 | Change                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------- |
| `mobile/src/services/photoImport/photoClustering.ts` | Add adjacent cell merging after initial clustering                |
| `mobile/src/screens/photos/usePlaceSuggestions.ts`   | Send time hints and request vision classification                 |
| `backend/app/services/place_matcher/matcher.py`      | Density detection, new ranking, tourist filter, vision type filter |
| `backend/app/services/place_matcher/constants.py`    | NON_TOURIST_TYPES, category match mappings, fame threshold        |
| `backend/app/api/photos.py`                          | Accept time hints, orchestrate vision calls                       |
| New: `backend/app/services/photo_vision/`            | Vision classification service (Gemini Flash Lite)                 |
| `mobile/src/screens/photos/PhotoImportScreen.tsx`    | Swipeable alternative suggestions                                 |

### Phased Rollout Suggestion

1. **Phase 1:** Density detection + adjacent cell merging + tourist relevance filter + improved ranking with rating/fame boost + time signals (no new APIs)
2. **Phase 2:** Vision classification integration (Gemini Flash Lite)
3. **Phase 3:** Text-detected search + swipeable alternatives UI
4. **Phase 4 (fast follow):** Manual merge UI if needed
