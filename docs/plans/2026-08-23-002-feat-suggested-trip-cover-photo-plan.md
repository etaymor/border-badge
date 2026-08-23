---
title: Suggested Trip Cover Photo - Plan
type: feat
date: 2026-08-23
status: draft
source: follow-up to docs/plans/2026-08-21-001-feat-photo-quality-signals-plan.md (3c, Deferred)
---

# Suggested Trip Cover Photo

## Goal Capsule

- **Objective:** When a user opens the cover photo control on a trip, offer a
  short strip of on-device candidates already narrowed to that trip's country
  and dates and ranked best-first, so the common case is one tap instead of
  hunting the system picker.
- **Scope anchor:** A suggestion source and a strip inside the existing
  `CoverImagePicker`. The existing pick/camera/upload path is unchanged and
  stays the fallback. No backend change, no new table, no auto-assignment.
- **Platform posture:** iOS-first by inheritance — candidates come from
  `photos.db`, which only fills on a device that has run a library scan. With no
  cache, no tags, or no permission the strip does not render and the control is
  exactly what it is today.
- **Non-negotiables:** no emojis/icons; nothing auto-publishes (the user picks,
  then the existing upload runs); no coordinates or asset ids in analytics.

## What already exists (do NOT rebuild)

- `CoverImagePicker` (`src/components/media/CoverImagePicker.tsx`) — owns pick,
  camera, validate, streamed upload to `media/{user_id}/covers/...`, progress,
  abort-on-unmount, and `onChange(publicUrl)`. `TripFormScreen` holds
  `coverImageUrl` and sends it as `cover_image_url`.
- `rankBestPhotos` (`src/services/photoSignals/bestPhotos.ts`) — utility images
  excluded, near-duplicate runs collapsed to their best frame, remainder by
  composite quality. Takes `mlTags` / `intentTags` maps and a `limit`.
- `getCachedPhotosByCountry(countryCode)` (`photoCacheDb.ts`) — the country
  narrowing, already geohash/country-code indexed at scan time.
- `getTagsForIds` / `getIntentTagsForIds` (`photoTagDb.ts`).
- `useNearbyPhotos` — the precedent for reading the photo cache from a form
  screen (request-id staleness guard, `cacheExists` gate, silent degradation).
- `resolveLoadableUri` — re-resolve a `ph://`/evicted URI on thumbnail load
  failure. Required here: cover candidates are old photos, the population most
  likely to be iCloud-offloaded.

## The one real decision: which pool

A trip's country comes from `trip.country_id`, its window from
`start_date`/`end_date`. Both are optional in practice (a trip can be saved with
neither).

- **Country + date window** — the intended case. Narrow, obviously "this trip".
- **Country only** (no dates) — still useful, but can span years of visits.
  Ship it, labeled by nothing: the strip is candidates, not claims.
- **Neither** — render no strip. A best-of-whole-library cover suggestion is a
  different feature and a worse one.

Ranking pool is capped and evenly sampled the way `rankTripSegmentPreviews`
does it (`PREVIEW_RANK_POOL_MAX = 300`), so a five-year country pool cannot
turn opening a form into a full-library rank.

## Units

**U1 — `useCoverPhotoSuggestions(countryCode, startDate, endDate)`**
New hook in `src/hooks/`. Mirrors `useNearbyPhotos`: request-id guard, loading
flag, empty on any failure. Reads `getCachedPhotosByCountry`, filters to the
date window when both dates exist, evenly samples to the pool cap, loads both
tag maps, calls `rankBestPhotos` with `limit: 12`. Returns `{ photos, isLoading,
cacheExists }`. Returns empty when `countryCode` is null.
Guarded by the existing `features.enableQualityRanking && enableIntentSignals`
so the strip disappears with the rest of the signal layer, and — like every
other consumer — bails when both tag maps are empty rather than ranking blind.
Jest: pool cap, date filter, no-tags bail, stale-request discard.

**U2 — `CoverSuggestionStrip`**
Presentational row of square thumbnails above the existing control. `expo-image`
with `recyclingKey`, `onError` → `resolveLoadableUri` retry once (the pattern
already used for cluster thumbnails). Selecting one calls back with the
`CachedPhoto`. No labels, no badges, no icons — thumbnails and a section header
in the existing `styles.label` idiom ("SUGGESTED").

**U3 — wire into `CoverImagePicker`**
New optional props `suggestionCountryCode`, `suggestionStartDate`,
`suggestionEndDate`. Absent → today's component exactly. Present → render the
strip above the existing button. Choosing a suggestion routes into the SAME
`uploadImage(file)` path already there, with `{ uri, name, type }` built from
the cached photo; `validateFile` still applies, so an oversized original is
rejected identically. One addition: cover photos are full-resolution originals,
so pass them through `expo-image-manipulator` (long edge 2048, JPEG 0.85)
before upload — reuse the bound `withNativeTimeout` idiom from `visionPhoto.ts`
rather than a bare await, and fall back to the original file on failure.

**U4 — `TripFormScreen` passes the trip's country + dates.**
`country_id` → ISO code via the countries query already loaded on that screen.

**U5 — Analytics.** One event, `trip_cover_suggestion_used`, with
`{ source: 'suggested' | 'picker' | 'camera', candidate_count, chosen_index }`.
Nothing identifying. This is the number that decides whether U6 is worth it.

**U6 — (gated on U5) TripDetail empty-cover affordance.** A trip with no cover
shows a fallback color today; if U5 shows the strip is used, offer the same
strip from `TripDetailScreen` so a cover can be set without entering the form.
Not built in this pass.

## Sequencing

| Step | Contents                  | Size | Ships |
| ---- | ------------------------- | ---- | ----- |
| 1    | U1 hook + Jest            | S    | OTA   |
| 2    | U2 strip + U3 wiring + U4 | M    | OTA   |
| 3    | U5 analytics              | S    | OTA   |

All OTA — no native module, no plugin, no version bump.

## Risks

- **Empty strip is the common first run.** Users who never ran a photo import
  have no cache. The strip must be absent, not empty-with-a-message.
- **iCloud eviction.** Old photos are exactly the evicted ones. `onError` →
  `resolveLoadableUri` covers display; the upload path can still stall on a
  `ph://` original, so the U3 resize is bounded and falls back.
- **Cover ≠ best photo.** A cover is a design decision, not a quality ranking.
  This is why nothing auto-assigns and the picker keeps top billing.

## Explicit non-goals

Auto-setting a cover; server-side cover selection; suggestions for entries,
lists, or passport/country thumbnails (still the Deferred follow-ups from the
quality-signals plan); Android.
