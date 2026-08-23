---
title: De-emphasize Low-Quality Photos in the Trip Matching Gallery - Plan
type: feat
date: 2026-08-23
status: draft
source: docs/plans/2026-08-21-001-feat-photo-quality-signals-plan.md (3c target 2, never wired)
---

# De-emphasize Low-Quality Photos in the Trip Matching Gallery

## Goal Capsule

- **Objective:** Stop making the user scroll past screenshots, receipts, and the
  four near-identical frames of one burst when reviewing a location's photos.
- **Scope anchor:** The photo-import matching surfaces only — cluster cards and
  `PhotoGalleryModal`. Not the passport, not trip detail, not entry galleries.
- **Mechanism:** SEED THE EXISTING EXCLUSION SET. This ships almost no new
  machinery; the per-cluster exclude/restore interaction already exists.
- **Non-negotiables:** chronological order is preserved (see below); every
  auto-exclusion is visible and reversible in one tap; no emojis/icons.

## The constraint that shapes the whole design

3c originally proposed "best-first default sort" for the gallery. That was
**correctly not shipped**, and this plan does not revive it.
`photoScanSteps.ts:225` records why:

> Cluster displays stay chronological — their order feeds gallery selection and
> splitting.

Reordering cluster photos would scramble manual cluster splitting, which is
positional. So the intervention has to preserve order and change EMPHASIS, not
sequence.

## What already exists (do NOT rebuild)

- `excludedPhotoIds: Map<clusterId, Set<photoId>>` in `PhotoImportScreen` — the
  full exclusion mechanism: dimming overlay in `PhotoGalleryModal`, an excluded
  COUNT on `ClusterListItem`, honored by `ManualPlaceSearch` and the upload
  path. Today it only ever fills from user taps.
- `rankBestPhotos` / `computeQualityScores` / `collapseNearDuplicates`
  (`photoSignals/`), and the same two flags every other consumer gates on.
- `getTagsForIds` / `getIntentTagsForIds`.

So the feature is: compute a per-cluster "de-emphasized" set once, seed
`excludedPhotoIds` with it, and tell the user it happened.

## Units

**U1 — `lowSignalPhotoIds(photos, { mlTags, intentTags })`**
New pure function in `photoSignals/`. Returns the ids to seed. Deliberately
NARROWER than `rankBestPhotos`' ranking:

1. Utility images — `isScreenshot`, `isUtility`, intent subtype `screenshot`.
   Same predicate `bestPhotos.ts` already uses; extract and share it rather
   than writing a second one.
2. Near-duplicate runs — every frame except the group's best (the existing
   `collapseNearDuplicates` + best-frame comparator).

That is ALL. Composite quality score is explicitly NOT a seed input: it is a
ranking signal, tuned for ordering, and a wrong drop here removes a photo the
user came to find. The asymmetry is the same one the quiz prefilter shipped on
— a mis-ranked photo costs nothing, a mis-dropped photo is invisible.
Never seeds when it would exclude everything, and never seeds the cluster's
anchor photo (closest to centroid) — that one is load-bearing for matching.
Jest: each rule, the all-excluded floor, the anchor exemption, the untagged
pool (seeds nothing).

**U2 — seed on cluster display build**
Where the screen first builds `clusterDisplays`, load both tag maps once for the
candidate (one read, all clusters) and seed `excludedPhotoIds` per cluster.
Flag-gated on `enableQualityRanking && enableIntentSignals`, bails when both tag
maps are empty, and — critically — **seeds only once per cluster**, never
re-applying over a user's own restore. Track seeded cluster ids in a ref so a
re-render, a re-fetch, or a return to the screen cannot resurrect an exclusion
the user undid.

**U3 — make it visible**
`ClusterListItem` already renders an excluded count. Extend that line to name
the cause when the count is seeded rather than tapped ("3 hidden — screenshots
and repeats"), with the existing count text as the tapped case. Text only.

**U4 — one-tap restore for the whole cluster**
`PhotoGalleryModal` already toggles per photo. Add a single "Show all" control
that clears the cluster's set — the honest escape hatch when the seed is wrong,
and the thing that makes U1 safe to ship at all.

**U5 — Analytics.** `photo_gallery_deemphasis` per import:
`{ seeded_count, restored_count, clusters_seeded }`. `restored_count` is the
false-positive rate. If it is meaningfully non-zero, U1's rules are wrong and
they loosen; that is the OTA lever, exactly as `quiz_prefilter_agreement` is.

## Sequencing

| Step | Contents                  | Size | Ships |
| ---- | ------------------------- | ---- | ----- |
| 1    | U1 + Jest                 | S    | OTA   |
| 2    | U2 seeding + U3 copy      | M    | OTA   |
| 3    | U4 restore + U5 analytics | S    | OTA   |

All OTA.

## Risks

- **Seeding fights the user.** The only way this is bad is if a restore can be
  undone by the app. U2's once-per-cluster ref is the whole mitigation and
  deserves its own test.
- **"Hidden" reads as "deleted".** Copy says hidden, the count is always
  visible, and U4 restores. Nothing is removed from the cluster.
- **Untagged libraries.** Android, pre-tagger binaries, an install whose sweep
  has not run: seeds nothing, and the screen is byte-identical to today.

## Explicit non-goals

Reordering cluster photos (breaks splitting — see above); applying this to trip
detail, entries, or the passport; a persisted per-photo "hidden" flag in
`photos.db` (the exclusion is per-import session, like the taps it mirrors);
using the composite quality score as a drop rule.
