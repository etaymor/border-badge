---
title: "feat: Nearby Photo Search on Entry Form"
type: feat
status: completed
date: 2026-02-16
---

# Nearby Photo Search on Entry Form

## Overview

When a user selects a place from Google Places autocomplete on the EntryFormScreen, automatically search their local photo library cache for photos taken near that location. Display matching photos as suggestions the user can tap to add to the entry — eliminating the need to manually hunt through their camera roll.

## Problem Statement / Motivation

Users often have photos from places they're adding to their trip log, but finding those photos through the standard image picker is tedious — especially when the photo library has thousands of images. The app already has a GPS-indexed SQLite photo cache from the photo import feature. This feature connects the dots: when you tell us *where* you went, we show you the photos you took *there*.

## Proposed Solution

Leverage the existing `cached_photos` SQLite table (geohash-indexed) to perform fast spatial queries when a place is selected. Display results in a horizontal scrollable strip above the existing PHOTOS section. Users tap photos to add them to the entry via the existing upload pipeline.

### Architecture

```
PlacesAutocomplete.onSelect(place)
  └─> useNearbyPhotos(place.latitude, place.longitude)
        └─> getPhotosNearLocation(lat, lon)  // new SQLite query
              ├─> ngeohash.encode(lat, lon, 6)      // precision 6 ~1.2km cells
              ├─> ngeohash.neighbors(hash)           // 8 surrounding cells
              ├─> SELECT * FROM cached_photos WHERE geohash LIKE ? || '%'
              ├─> haversine post-filter + sort by distance
              └─> Adaptive radius: start 500m, narrow to 200m/100m if >10 results
        └─> Return CachedPhoto[] to UI

NearbyPhotoSuggestions component
  └─> Horizontal thumbnail strip with tap-to-add
        └─> EntryMediaGallery.addPhotos([uri])  // new imperative method
```

**The normal photo picker remains fully functional.** This feature adds suggestions alongside the existing "Add Photos" button — users can always pick photos manually the usual way.

## Technical Approach

### Phase 1: SQLite Query Layer

**New function in** [photoCacheDb.ts](mobile/src/services/photoImport/photoCacheDb.ts):

```typescript
// mobile/src/services/photoImport/photoCacheDb.ts

// Adaptive radius thresholds — narrow the search when too many results
const RADIUS_TIERS = [500, 200, 100]; // meters
const MAX_BEFORE_NARROWING = 10;

/**
 * Find cached photos near the given coordinates using adaptive radius.
 * Starts at 500m, narrows to 200m then 100m if more than 10 photos found.
 * Uses geohash prefix matching for fast indexed lookup, then haversine post-filter.
 */
export function getPhotosNearLocation(
  latitude: number,
  longitude: number,
  maxResults: number = 20,
): CachedPhoto[] {
  const db = getDb();

  // Use precision 6 (~1.2km cells) for the geohash prefix to cover the max search radius
  const centerHash = geohash.encode(latitude, longitude, 6);
  const neighborHashes = geohash.neighbors(centerHash);
  const allHashes = [centerHash, ...Object.values(neighborHashes)];

  // Query all photos whose geohash (precision 7) starts with any of these precision-6 prefixes
  const placeholders = allHashes.map(() => "geohash LIKE ? || '%'").join(' OR ');
  const rows = db.getAllSync<CachedPhotoRow>(
    `SELECT * FROM cached_photos WHERE ${placeholders} ORDER BY creation_time DESC`,
    allHashes,
  );

  // Compute distances once (the expensive part, but still <1ms for hundreds of rows)
  const withDistance = rows.map((row) => ({
    photo: toCachedPhoto(row),
    distance: haversine(latitude, longitude, row.latitude, row.longitude),
  }));

  // Adaptive radius: start wide, narrow if too many results
  for (const radius of RADIUS_TIERS) {
    const filtered = withDistance.filter((p) => p.distance <= radius);
    if (filtered.length <= MAX_BEFORE_NARROWING || radius === RADIUS_TIERS[RADIUS_TIERS.length - 1]) {
      return filtered
        .sort((a, b) => a.distance - b.distance)
        .slice(0, maxResults)
        .map((p) => p.photo);
    }
  }

  // Fallback (shouldn't reach here)
  return withDistance
    .filter((p) => p.distance <= RADIUS_TIERS[RADIUS_TIERS.length - 1])
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxResults)
    .map((p) => p.photo);
}
```

**Why precision 6 for the prefix query:** The cached geohash column uses precision 7 (~153m cells). By searching with precision-6 prefixes (~1.2km cells), the `LIKE ? || '%'` clause covers all precision-7 cells within each ~1.2km area. With the center cell plus 8 neighbors at precision 6, the search covers a ~3.6km x 3.6km bounding box — safely larger than the 500m max haversine radius. This avoids the boundary problem of precision-7 neighbor lookups while still using the geohash index efficiently.

**Why adaptive radius:** In dense urban areas (Manhattan, Tokyo, etc.), a 500m radius around a restaurant could include hundreds of photos from different venues on the same block. The adaptive approach queries the DB once, then narrows the in-memory result set — essentially free since the haversine distances are already computed. The tiers (500m → 200m → 100m) ensure sparse rural areas still find photos while dense cities stay focused.

### Phase 2: React Hook

**New file:** `mobile/src/hooks/useNearbyPhotos.ts`

```typescript
// mobile/src/hooks/useNearbyPhotos.ts

export function useNearbyPhotos(
  place: SelectedPlace | null,
): {
  photos: CachedPhoto[];
  isLoading: boolean;
  cacheExists: boolean;
} {
  // 1. Check if cached_photos has any data (hasCachedPhotos())
  // 2. If place has valid lat/long, query getPhotosNearLocation()
  // 3. Track a requestId to discard stale results when place changes
  // 4. Return empty array if place is null or coordinates are null
}
```

Key behaviors:
- Returns empty results immediately if `place` is null or `latitude`/`longitude` are null
- Uses a `requestId` ref to prevent stale results from a previously-selected place
- Checks `hasCachedPhotos()` once to set `cacheExists` (determines empty state messaging)
- SQLite queries are synchronous and fast (~1-5ms), so no debounce needed

### Phase 3: UI Component

**New file:** `mobile/src/components/entries/NearbyPhotoSuggestions.tsx`

A horizontal thumbnail strip that appears between LOCATION and PHOTOS sections when nearby photos are found.

```
┌──────────────────────────────────────────┐
│ PHOTOS FROM YOUR LIBRARY                 │
│ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐        │
│ │     │ │     │ │     │ │     │  ...    │
│ │ +   │ │ +   │ │ +   │ │ +   │        │
│ └─────┘ └─────┘ └─────┘ └─────┘        │
└──────────────────────────────────────────┘
```

- Horizontal `FlatList` of photo thumbnails (~80x80 dp)
- Tap a photo to add it to the entry (triggers upload)
- Photos already added show a checkmark overlay and are non-interactive
- Shows "Scan your photo library to see suggestions" prompt if `cacheExists` is false
- Hidden entirely when place has no coordinates or when entry type is "experience"
- Subtle fade-in animation when results load

### Phase 4: Upload Integration

**Extend [EntryMediaGallery.tsx](mobile/src/components/media/EntryMediaGallery.tsx):**

Add an imperative ref or callback to allow external code to inject photo URIs:

```typescript
// Add to EntryMediaGalleryProps
onAddExternalPhotos?: (uris: string[]) => void; // setter provided by parent

// Or expose via useImperativeHandle:
export interface EntryMediaGalleryRef {
  addPhotos: (uris: string[]) => void;
}
```

The added URIs go through the same upload flow as `initialPhotoUris`: convert `ph://` to `file://`, create upload request, upload to Supabase Storage, track pending media IDs.

### Phase 5: Integration in EntryFormScreen

Wire everything together in [EntryFormScreen.tsx](mobile/src/screens/entries/EntryFormScreen.tsx):

```typescript
// In EntryFormScreen:
const { photos: nearbyPhotos, isLoading: nearbyLoading, cacheExists } =
  useNearbyPhotos(selectedPlace);

const mediaGalleryRef = useRef<EntryMediaGalleryRef>(null);

const handleAddNearbyPhoto = useCallback((photo: CachedPhoto) => {
  mediaGalleryRef.current?.addPhotos([photo.uri]);
}, []);

// In JSX, between LOCATION and PHOTOS sections:
{showPlaceInput && selectedPlace?.latitude != null && (
  <NearbyPhotoSuggestions
    photos={nearbyPhotos}
    isLoading={nearbyLoading}
    cacheExists={cacheExists}
    onPhotoSelect={handleAddNearbyPhoto}
    remainingSlots={MAX_PHOTOS_PER_ENTRY - photoCount}
    addedPhotoIds={addedNearbyPhotoIds} // track which suggestions were already added
  />
)}
```

## Design Decisions

### Adaptive search radius: 500m → 200m → 100m

A fixed radius doesn't work well across environments. In rural areas, 500m is needed to find anything. In dense cities, 500m pulls in photos from dozens of different venues. The adaptive approach queries at 500m, then narrows to 200m or 100m if more than 10 results are found. This is effectively free — the DB query runs once and the narrowing is just an in-memory filter on already-computed haversine distances.

### Normal photo picker unchanged

This feature adds suggestions *alongside* the existing "Add Photos" button. Users can always pick photos manually through the standard image picker. The two mechanisms are complementary.

### No time filtering in v1

Time filtering (scoping to the trip's date range) would improve relevance for frequently-visited locations, but adds complexity. For v1, sort by distance (nearest first) with recency as a tiebreaker. Time filtering can be added later as a refinement.

### Display cap: 20 photos

Show a maximum of 20 thumbnail suggestions. This keeps the horizontal strip manageable and avoids performance issues with thumbnail rendering. If more exist, the 20 nearest are shown.

### Eager upload on tap

When the user taps a suggested photo, upload it immediately (same as the standard photo picker flow). This matches user expectations — they see the photo appear in the gallery with an upload progress indicator. If they change their mind, they can delete it from the gallery.

### Keep uploads when place changes

If a user added suggested photos, then changes the selected place, the already-added photos remain. They were explicitly selected by the user and are valid media. Only the suggestion list refreshes.

## Acceptance Criteria

- [x] When a place with valid lat/long is selected from PlacesAutocomplete, nearby cached photos appear in a horizontal strip above the PHOTOS section
- [x] Tapping a suggested photo adds it to the entry's photo gallery and starts upload
- [x] Photos already added to the entry show a checkmark overlay in the suggestion strip
- [x] Suggestion strip is hidden when: no place selected, coordinates are null, entry type is "experience"
- [x] When place is cleared or changed, suggestion strip updates to match the new place
- [x] If photo cache is empty (user hasn't scanned), show a "Scan your photos" prompt with navigation to PhotoImport
- [x] If no nearby photos found, show a brief "No nearby photos found" message (then auto-hide)
- [x] Remaining photo slots are respected — disable tap-to-add when `MAX_PHOTOS_PER_ENTRY` is reached
- [x] Works in both create and edit modes

## Files to Create or Modify

| File | Action | Description |
|------|--------|-------------|
| [photoCacheDb.ts](mobile/src/services/photoImport/photoCacheDb.ts) | Modify | Add `getPhotosNearLocation()` function |
| `mobile/src/hooks/useNearbyPhotos.ts` | **Create** | Hook to query and manage nearby photo state |
| `mobile/src/components/entries/NearbyPhotoSuggestions.tsx` | **Create** | Horizontal thumbnail suggestion strip component |
| [EntryMediaGallery.tsx](mobile/src/components/media/EntryMediaGallery.tsx) | Modify | Add imperative ref or callback for external photo injection |
| [EntryFormScreen.tsx](mobile/src/screens/entries/EntryFormScreen.tsx) | Modify | Wire up hook, component, and gallery integration |
| [photoClustering.ts](mobile/src/services/photoImport/photoClustering.ts) | None | `haversine()` already exported, reusable as-is |
| [types.ts](mobile/src/services/photoImport/types.ts) | None | `CachedPhoto` type already defined |

## Dependencies & Risks

### Dependencies
- **Photo cache must be populated.** User needs to have run a photo import scan at least once. The feature degrades gracefully (shows "Scan your photos" prompt) but won't provide value until the cache exists.
- **Google Places must return coordinates.** When Place Details API fails or the user enters a place manually, coordinates are null and the feature is hidden.

### Risks
- **Stale cache entries.** Photos deleted from the device may still appear in the cache. Thumbnails using `ph://` URIs will fail to render — React Native's `<Image>` handles this gracefully (shows nothing). Upload attempts would fail and show the retry UI.
- **Limited photo permission.** iOS "Limited" access may make some cached photos inaccessible. Same graceful degradation as stale entries.
- **No duplicate detection with existing media.** There's no mapping between `cached_photos.id` (device asset ID) and `media_files.id` (server UUID), so a photo already attached to the entry could appear as a suggestion. Acceptable for v1 — the user simply won't tap it again.

## Future Considerations

- **Time filtering:** Scope suggestions to the trip's date range for frequently-visited locations
- **On-demand mini-scan:** If cache is empty, offer to do a quick scan of recent photos (last 30 days) instead of a full library scan
- **Experience entries:** Allow searching by name/coordinates entered manually
- **Smart radius:** Adjust search radius based on place type (wider for parks, tighter for restaurants)

## References

### Internal References
- [PlacesAutocomplete.tsx](mobile/src/components/places/PlacesAutocomplete.tsx) — place selection with lat/long
- [photoCacheDb.ts](mobile/src/services/photoImport/photoCacheDb.ts) — SQLite cache schema and existing queries
- [photoClustering.ts:25-34](mobile/src/services/photoImport/photoClustering.ts) — exported `haversine()` function
- [EntryMediaGallery.tsx](mobile/src/components/media/EntryMediaGallery.tsx) — photo upload pipeline
- [EntryFormScreen.tsx](mobile/src/screens/entries/EntryFormScreen.tsx) — integration target
- [types.ts:151-160](mobile/src/services/photoImport/types.ts) — `CachedPhoto` type
- [placesApi.ts:81-90](mobile/src/services/placesApi.ts) — `SelectedPlace` type with lat/long
