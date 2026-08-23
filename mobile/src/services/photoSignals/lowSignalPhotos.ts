/**
 * Low-signal photo selection for the trip matching gallery.
 *
 * Deliberately NARROWER than `rankBestPhotos`. Ranking may reorder on any
 * signal it likes, because a mis-ranked photo costs nothing. This function
 * decides what to HIDE, and a mis-hidden photo is invisible - so it only ever
 * acts on the two rules that are unambiguous:
 *
 *   1. Utility images (screenshots, receipts, scans).
 *   2. Near-duplicate runs - every frame except the group's best.
 *
 * The composite quality score is explicitly NOT a drop input. It is a ranking
 * signal tuned for ordering; using it here would remove the very photo the
 * user opened the cluster to find. It is used only to pick WHICH frame of a
 * near-duplicate run survives, never to drop anything on its own.
 *
 * Two floors keep the result safe:
 *   - the cluster's anchor photo (closest to the centroid) is never hidden; it
 *     is what the place match was made from;
 *   - if the rules would hide everything, nothing is hidden.
 *
 * Pure: no IO, no React. Callers pass the tag maps they already loaded. An
 * untagged pool loses rule 1 entirely (there is no evidence of a screenshot
 * without a tag row); the decision to skip the call altogether on a library
 * with no tag rows at all belongs to the caller, exactly as it does for
 * `rankTripSegmentPreviews`.
 */

import { haversine } from '@services/photoImport/photoClustering';

import type { PhotoIntentTag, PhotoMlTag } from '@services/photoImport/photoTagDb';

import { computeCaptureContexts } from './captureContext';
import { collapseNearDuplicates } from './nearDuplicates';
import { computeQualityScores } from './qualityScore';

import type { CaptureContextPhoto } from './captureContext';

/**
 * Unambiguous non-photograph: a screenshot, a receipt, a document scan. Shared
 * with `rankBestPhotos`, which excludes the same set from its ranking pool -
 * one predicate so the gallery can never hide something the ranker would have
 * shown, or vice versa.
 */
export function isUtilityImage(
  mlTag: PhotoMlTag | undefined,
  intentTag: PhotoIntentTag | undefined
): boolean {
  if (mlTag?.isScreenshot || mlTag?.isUtility === true) return true;
  return intentTag?.subtypes.includes('screenshot') ?? false;
}

export interface LowSignalPhotoOptions {
  mlTags?: Map<string, PhotoMlTag>;
  intentTags?: Map<string, PhotoIntentTag>;
  /**
   * Cluster centroid. The photo nearest it is the anchor - the frame the place
   * lookup was made from - and is exempt from every rule. Omit and no photo is
   * exempt (the all-hidden floor still applies).
   */
  anchor?: { latitude: number; longitude: number };
}

/**
 * The ids to de-emphasize in a cluster. Input order is irrelevant and is never
 * used: this returns a SET, and callers must not reorder their photos on the
 * strength of it (cluster display order feeds manual cluster splitting).
 */
export function lowSignalPhotoIds<T extends CaptureContextPhoto>(
  photos: T[],
  options: LowSignalPhotoOptions = {}
): Set<string> {
  const { mlTags, intentTags, anchor } = options;
  const hidden = new Set<string>();
  // One photo can never be "the low-signal ones": hiding it would empty the
  // cluster, and the floor below would undo it anyway.
  if (photos.length < 2) return hidden;

  // Rule 1 - utility images.
  for (const photo of photos) {
    if (isUtilityImage(mlTags?.get(photo.id), intentTags?.get(photo.id))) hidden.add(photo.id);
  }

  // Rule 2 - near-duplicate runs, over what rule 1 left. Quality picks the
  // survivor of each run, the same comparator idiom `rankBestPhotos` uses.
  const pool = photos.filter((photo) => !hidden.has(photo.id));
  if (pool.length >= 2) {
    const contexts = computeCaptureContexts(pool, intentTags);
    const scores = computeQualityScores(
      pool.map((photo) => ({
        id: photo.id,
        aestheticScore: mlTags?.get(photo.id)?.aestheticScore ?? null,
        intent: intentTags?.get(photo.id),
        context: contexts.get(photo.id),
      }))
    );
    const quality = (photo: T) => scores.get(photo.id) ?? 0;
    const kept = new Set(
      collapseNearDuplicates(pool, (group) => {
        // Newest wins ties, matching the collapse default for untagged pools.
        let best = group[group.length - 1];
        for (const photo of group) {
          if (quality(photo) > quality(best)) best = photo;
        }
        return best;
      }).map((photo) => photo.id)
    );
    for (const photo of pool) {
      if (!kept.has(photo.id)) hidden.add(photo.id);
    }
  }

  // Floor 1 - the anchor is load-bearing for the match; never hide it.
  const anchorId = anchor ? nearestPhotoId(photos, anchor, hidden) : null;
  if (anchorId !== null) hidden.delete(anchorId);

  // Floor 2 - a cluster that is ALL screenshots (or all one burst) still has to
  // show something. Hide nothing rather than everything.
  if (hidden.size >= photos.length) return new Set();

  return hidden;
}

/**
 * The photo nearest the centroid. Ties - and inside one cluster a great many
 * photos share a coordinate exactly - go to a photo the rules did NOT flag:
 * any of them anchors the match equally well, so spending the exemption on a
 * screenshot would keep a screenshot on screen for nothing.
 */
function nearestPhotoId<T extends CaptureContextPhoto>(
  photos: T[],
  anchor: { latitude: number; longitude: number },
  hidden: Set<string>
): string | null {
  let nearest: T | null = null;
  let nearestDistance = Infinity;
  for (const photo of photos) {
    const distance = haversine(anchor.latitude, anchor.longitude, photo.latitude, photo.longitude);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = photo;
    } else if (
      distance === nearestDistance &&
      nearest !== null &&
      hidden.has(nearest.id) &&
      !hidden.has(photo.id)
    ) {
      nearest = photo;
    }
  }
  return nearest?.id ?? null;
}
