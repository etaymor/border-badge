/**
 * Best-photo ranking for curation surfaces (segment previews, gallery sort).
 *
 * Pure: callers pass the photos they already hold plus whatever tag maps they
 * loaded. Missing maps drop the tag-derived terms (aesthetics, intent) but NOT
 * the capture-context ones - golden hour and retry count derive from cached
 * timestamps and coordinates alone, so a wholly untagged pool is still scored
 * and still reordered. Callers that must preserve their input order on a
 * library with no tag rows (Android, pre-tagger binaries, an install whose
 * sweep has not run) have to skip this call, the way
 * `rankTripSegmentPreviews` and `loadClusterQualityScores` do. Ranking, not
 * gatekeeping - only unambiguous utility images (screenshots, receipts) are
 * excluded outright, and even those are kept when excluding them would leave
 * nothing to show.
 */

import type { PhotoIntentTag, PhotoMlTag } from '@services/photoImport/photoTagDb';

import { computeCaptureContexts } from './captureContext';
import { isUtilityImage } from './lowSignalPhotos';
import { collapseNearDuplicates } from './nearDuplicates';
import { computeQualityScores } from './qualityScore';

import type { CaptureContextPhoto } from './captureContext';

export interface RankBestPhotosOptions {
  mlTags?: Map<string, PhotoMlTag>;
  intentTags?: Map<string, PhotoIntentTag>;
  /** Cap the result; omit for the full ranked list. */
  limit?: number;
}

/**
 * Rank photos best-first: utility images excluded, near-duplicate runs
 * collapsed to their best frame, remainder sorted by composite quality. The
 * sort is stable, so photos that tie keep their input order - but an untagged
 * pool does not necessarily tie, because capture context scores without tags.
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
