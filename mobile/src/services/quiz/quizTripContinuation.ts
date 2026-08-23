/**
 * quizTripContinuation - Keeping the promise the quiz door already makes.
 *
 * Both entry points tell the user "the same scan builds your trips, too". The
 * cache made that true in principle - one SQLite `photos.db` serves both
 * features - but the quiz path never ran SEGMENTATION, so someone who only ever
 * built challenges had a fully-extracted library and no trips to show for it.
 * The sentence was a promise about data, and the user hears a promise about
 * what they will see.
 *
 * This closes that gap by running the LIGHT half of the trip scan - the half
 * that turns already-extracted photos into trip segments. It deliberately does
 * NOT start a `trip-scan` job: extraction is the expensive part and the quiz
 * build's own refresh step just did it. Re-extracting would double the cost of
 * the very scan we are telling the user only happens once.
 *
 * It runs AFTER the challenge outcome is published, so nothing here can delay
 * the user reaching their finished game, and every failure is swallowed: a
 * built challenge must never turn into a failed build because segmentation
 * tripped over something.
 */

import { getHomeCountry } from '@services/countriesDb';
import {
  getAllCachedPhotos,
  getLastImportTime,
  getMetadata,
  getTripSegments,
  saveTripSegments,
  setMetadata,
} from '@services/photoImport/photoCacheDb';
import {
  getAllSavedPhotoIds,
  getClusterSplitsForParents,
} from '@services/photoImport/photoCacheDbSuggestions';
import {
  rankTripSegmentPreviews,
  segmentTripsFromCache,
} from '@services/photoImport/photoClusteringCache';
import {
  applyPersistedSplits,
  applySavedPhotoFilter,
} from '@services/photoImport/photoClusteringDisplay';
import { maybeRunTaggingPass } from '@services/photoImport/photoTaggingService';

/**
 * The `last_import_time` the most recent continuation segmented at. Lets a
 * repeat challenge skip re-segmenting a library that has not changed - on a
 * large cache that pass is seconds of CPU for an identical result.
 */
const SEGMENTED_AT_KEY = 'quiz_trip_continuation_import_time';

export type TripContinuationResult =
  /** Segmentation ran; `segmentCount` trips are now on the suggestions list. */
  | { status: 'segmented'; segmentCount: number }
  /** Nothing to do, for a reason that is not a failure. */
  | { status: 'skipped'; reason: 'no-home-country' | 'unchanged' | 'no-photos' | 'cancelled' }
  | { status: 'failed' };

/**
 * Turn the photos the challenge build already extracted into trip segments.
 *
 * Never throws. Never starts a scan. Safe to call after every successful
 * build - the `unchanged` guard is what keeps that from being wasteful.
 */
export async function runQuizTripContinuation(
  signal?: AbortSignal
): Promise<TripContinuationResult> {
  try {
    // Segmentation without a home country produces "trips" full of everyday
    // life - the user's own town, their office, their school run. Better to
    // have no trips than a suggestions list they have to reject one by one.
    const homeCountry = await getHomeCountry().catch(() => null);
    if (!homeCountry) return { status: 'skipped', reason: 'no-home-country' };

    const importTime = await getLastImportTime();
    const segmentedAt = await getMetadata(SEGMENTED_AT_KEY);
    const existing = await getTripSegments().catch(() => []);
    // Trips already exist AND nothing has been imported since we made them.
    // Re-running would burn the CPU to rebuild exactly what is on screen.
    if (existing.length > 0 && segmentedAt && importTime && Number(segmentedAt) >= importTime) {
      return { status: 'skipped', reason: 'unchanged' };
    }

    const photos = await getAllCachedPhotos();
    if (photos.length === 0) return { status: 'skipped', reason: 'no-photos' };
    if (signal?.aborted) return { status: 'skipped', reason: 'cancelled' };

    const segmented = segmentTripsFromCache(photos, homeCountry);
    if (signal?.aborted) return { status: 'skipped', reason: 'cancelled' };

    // Re-apply persisted manual splits: re-segmentation from cached photos
    // rebuilds the parent geohash IDs, so without this the user's split
    // disappears every time they return to suggestions.
    const allClusterIds = Array.from(segmented.clusterLookup.keys());
    const [splitsByParent, savedPhotoIds] = await Promise.all([
      getClusterSplitsForParents(allClusterIds).catch(() => new Map()),
      getAllSavedPhotoIds().catch(() => new Set<string>()),
    ]);
    if (signal?.aborted) return { status: 'skipped', reason: 'cancelled' };

    const splitApplied = applyPersistedSplits(segmented, splitsByParent);
    const { data: optimizedData } = applySavedPhotoFilter(splitApplied, savedPhotoIds);

    // Best-first preview strips for the trip segment cards (flag-gated inside;
    // degrades to the chronological previews on any failure).
    const ranked = await rankTripSegmentPreviews(
      optimizedData.candidates,
      optimizedData.photoLookup
    );
    if (signal?.aborted) return { status: 'skipped', reason: 'cancelled' };

    await saveTripSegments(
      ranked.map((candidate) => ({
        id: candidate.id,
        countryCode: candidate.countryCode,
        startTime: candidate.dateRange.start.getTime(),
        endTime: candidate.dateRange.end.getTime(),
        photoCount: candidate.photoCount,
        clusterCount: candidate.locationClusterIds.length,
        previewUris: candidate.previewUris,
        previewAssetIds: candidate.previewAssetIds,
        clusterIds: candidate.locationClusterIds,
        photoIds: candidate.photoIds,
      }))
    );
    if (importTime) await setMetadata(SEGMENTED_AT_KEY, String(importTime));

    // Fire-and-forget, exactly as the trip scan does it: the tagging pass is
    // an enrichment, and nothing downstream waits on it.
    void maybeRunTaggingPass();

    return { status: 'segmented', segmentCount: ranked.length };
  } catch (error) {
    // A built challenge must never become a failed build because segmentation
    // threw. Log and move on.
    console.warn(
      '[QuizTripContinuation] Segmentation failed:',
      error instanceof Error ? error.message : error
    );
    return { status: 'failed' };
  }
}

/**
 * How many segments the continuation left for the user to review, or 0 when it
 * has not run. Read by the results-screen cross-sell so it can stay silent
 * until there is genuinely something to offer.
 */
export async function countUnreviewedTripSegments(): Promise<number> {
  try {
    const segments = await getTripSegments();
    return segments.length;
  } catch {
    return 0;
  }
}
