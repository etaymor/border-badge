/**
 * Best-photo ranking for curation surfaces (segment previews, gallery sort).
 *
 * Pure: callers pass the photos they already hold plus whatever tag maps they
 * loaded; missing maps degrade every photo to neutral, so an untagged library
 * ranks in its original order (minus duplicate collapse). Ranking, not
 * gatekeeping - only unambiguous utility images (screenshots, receipts) are
 * excluded outright, and even those are kept when excluding them would leave
 * nothing to show.
 */

import type { PhotoIntentTag, PhotoMlTag } from '@services/photoImport/photoTagDb';

import { computeCaptureContexts } from './captureContext';
import { collapseNearDuplicates } from './nearDuplicates';
import { computeQualityScores } from './qualityScore';

import type { CaptureContextPhoto } from './captureContext';

export interface RankBestPhotosOptions {
  mlTags?: Map<string, PhotoMlTag>;
  intentTags?: Map<string, PhotoIntentTag>;
  /** Cap the result; omit for the full ranked list. */
  limit?: number;
}

function isUtilityImage(
  mlTag: PhotoMlTag | undefined,
  intentTag: PhotoIntentTag | undefined
): boolean {
  if (mlTag?.isScreenshot || mlTag?.isUtility === true) return true;
  return intentTag?.subtypes.includes('screenshot') ?? false;
}

/**
 * Rank photos best-first: utility images excluded, near-duplicate runs
 * collapsed to their best frame, remainder sorted by composite quality
 * (stable, so an untagged pool keeps its input order).
 */
export function rankBestPhotos<T extends CaptureContextPhoto>(
  photos: T[],
  options: RankBestPhotosOptions = {}
): T[] {
  const { mlTags, intentTags, limit } = options;
  if (photos.length === 0) return [];

  const presentable = photos.filter(
    (photo) => !isUtilityImage(mlTags?.get(photo.id), intentTags?.get(photo.id))
  );
  // A pool that is ALL screenshots still needs to show something.
  const pool = presentable.length > 0 ? presentable : photos;

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
  const collapsed = collapseNearDuplicates(pool, (group) => {
    // Newest wins ties, matching the collapse default for untagged pools.
    let best = group[group.length - 1];
    for (const photo of group) {
      if (quality(photo) > quality(best)) best = photo;
    }
    return best;
  });

  const ranked = [...collapsed].sort((a, b) => quality(b) - quality(a));
  return limit != null ? ranked.slice(0, limit) : ranked;
}
