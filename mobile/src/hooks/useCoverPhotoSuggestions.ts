/**
 * Cover-photo candidates for a trip, drawn from the on-device photo cache.
 *
 * Narrowed to the trip's country (the cache is country-code indexed at scan
 * time) and, when the trip has both dates, to its window; then ranked
 * best-first by `rankBestPhotos`. Returns empty — never throws — when there is
 * no country, no cache, or no tags, so the cover control degrades to exactly
 * what it is today.
 *
 * Modeled on `useNearbyPhotos`: request-id staleness guard, `cacheExists` gate,
 * silent degradation on any failure.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { features } from '@config/features';
import { getCachedPhotosByCountry, hasCachedPhotos } from '@services/photoImport/photoCacheDb';
import { getIntentTagsForIds, getTagsForIds } from '@services/photoImport/photoTagDb';
import type { CachedPhoto } from '@services/photoImport/types';
import { rankBestPhotos } from '@services/photoSignals/bestPhotos';

/**
 * Cap on photos ranked (and tag rows read) per open of the cover control. A
 * country pool can span years of visits; without the cap, opening a form would
 * JSON-parse tag rows for effectively a whole country's library to build a
 * 12-item strip. Sampling is EVENLY SPACED through the pool's chronology — a
 * plain prefix would bias every strip toward the most recent visit.
 * Mirrors `PREVIEW_RANK_POOL_MAX` in photoClusteringCache.ts.
 */
export const COVER_RANK_POOL_MAX = 300;

/** How many candidates the strip shows. */
export const COVER_SUGGESTION_LIMIT = 12;

function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = items.length / max;
  const sampled: T[] = [];
  for (let i = 0; i < max; i++) sampled.push(items[Math.floor(i * step)]);
  return sampled;
}

export interface UseCoverPhotoSuggestionsResult {
  photos: CachedPhoto[];
  isLoading: boolean;
  /** False until the on-device photo cache is known to hold at least one row. */
  cacheExists: boolean;
}

/**
 * @param countryCode ISO 3166-1 alpha-2 for the trip's country; null disables.
 * @param startDateMs Inclusive lower bound (epoch ms). Applied only with `endDateMs`.
 * @param endDateMs Inclusive upper bound (epoch ms). Applied only with `startDateMs`.
 */
export function useCoverPhotoSuggestions(
  countryCode: string | null | undefined,
  startDateMs?: number | null,
  endDateMs?: number | null
): UseCoverPhotoSuggestionsResult {
  const [photos, setPhotos] = useState<CachedPhoto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [cacheExists, setCacheExists] = useState(false);

  // Track the current request so a country/date change discards stale results.
  const requestIdRef = useRef(0);

  // Probed only when suggestions are actually possible, so mounting the cover
  // control on a trip with no country never opens the photo database.
  useEffect(() => {
    if (!features.enableQualityRanking || !features.enableIntentSignals || !countryCode) {
      setCacheExists(false);
      return;
    }
    hasCachedPhotos()
      .then(setCacheExists)
      .catch(() => setCacheExists(false));
  }, [countryCode]);

  const load = useCallback(
    async (code: string, from: number | null, to: number | null, reqId: number) => {
      setIsLoading(true);
      try {
        const cached = await getCachedPhotosByCountry(code);
        const windowed =
          from != null && to != null
            ? cached.filter((p) => p.creationTime >= from && p.creationTime <= to)
            : cached;
        const pool = sampleEvenly(windowed, COVER_RANK_POOL_MAX);

        if (pool.length === 0) {
          if (reqId === requestIdRef.current) setPhotos([]);
          return;
        }

        const ids = pool.map((p) => p.id);
        const [mlTags, intentTags] = await Promise.all([
          getTagsForIds(ids),
          getIntentTagsForIds(ids),
        ]);

        // No rows at all in EITHER table (Android, a binary older than the
        // tagger, an install whose sweep has not run yet): bail rather than
        // rank. The ranker is not neutral without tags — golden hour and retry
        // count come from cached timestamps and coordinates alone — so ranking
        // here would suggest whatever happened to be shot near sunset off a
        // signal the user never provided. Same guard, same reason, as
        // `rankTripSegmentPreviews` and `loadClusterQualityScores`.
        if (mlTags.size === 0 && intentTags.size === 0) {
          if (reqId === requestIdRef.current) setPhotos([]);
          return;
        }

        const ranked = rankBestPhotos(pool, {
          mlTags,
          intentTags,
          limit: COVER_SUGGESTION_LIMIT,
        });

        if (reqId === requestIdRef.current) setPhotos(ranked);
      } catch {
        if (reqId === requestIdRef.current) setPhotos([]);
      } finally {
        if (reqId === requestIdRef.current) setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    const enabled = features.enableQualityRanking && features.enableIntentSignals;
    if (!enabled || !countryCode) {
      ++requestIdRef.current;
      setPhotos([]);
      setIsLoading(false);
      return;
    }

    const reqId = ++requestIdRef.current;
    load(countryCode, startDateMs ?? null, endDateMs ?? null, reqId);
  }, [countryCode, startDateMs, endDateMs, load]);

  return { photos, isLoading, cacheExists };
}
