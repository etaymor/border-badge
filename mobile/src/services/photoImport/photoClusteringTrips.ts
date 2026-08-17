/**
 * Trip segmentation - groups location clusters into trip candidates by country and time gaps.
 *
 * Extracted from photoClustering.ts to keep modules focused and under 500 lines.
 */

import type { LocationCluster, PhotoWithLocation, TripCandidate } from './types';
import { clusterByLocation, mergeAdjacentClusters } from './photoClustering';

const TIME_GAP_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days between trips

/**
 * Segment clusters into trip candidates by country and time gaps.
 *
 * @param clusters - Geocoded location clusters
 * @param homeCountryCode - User's home country to filter out
 * @returns Trip candidates grouped by country and time
 */
export function segmentTripsByTimeGap(
  clusters: LocationCluster[],
  homeCountryCode: string | null
): TripCandidate[] {
  // Filter out home country and clusters without country code
  const travelClusters = clusters.filter((c) => c.countryCode && c.countryCode !== homeCountryCode);

  if (__DEV__) {
    // Debug: count photos by country before filtering
    const photosByCountry = new Map<string, number>();
    for (const cluster of clusters) {
      const code = cluster.countryCode ?? 'unknown';
      photosByCountry.set(code, (photosByCountry.get(code) ?? 0) + cluster.photos.length);
    }
    console.log(
      '[PhotoImport] Photos by country (before home filter):',
      Object.fromEntries(photosByCountry)
    );
    console.log('[PhotoImport] Home country:', homeCountryCode);

    // Debug: count after filtering
    const travelPhotosByCountry = new Map<string, number>();
    for (const cluster of travelClusters) {
      const code = cluster.countryCode!;
      travelPhotosByCountry.set(
        code,
        (travelPhotosByCountry.get(code) ?? 0) + cluster.photos.length
      );
    }
    console.log(
      '[PhotoImport] Photos by country (after home filter):',
      Object.fromEntries(travelPhotosByCountry)
    );
  }

  // Group by country
  const byCountry = new Map<string, LocationCluster[]>();
  for (const cluster of travelClusters) {
    const code = cluster.countryCode!;
    const existing = byCountry.get(code) ?? [];
    existing.push(cluster);
    byCountry.set(code, existing);
  }

  // For each country, segment by time gaps
  const trips: TripCandidate[] = [];

  for (const [countryCode, countryClusters] of byCountry) {
    // Sort all photos across clusters by time
    const allPhotos = countryClusters.flatMap((c) => c.photos);
    const sorted = allPhotos.sort((a, b) => a.creationTime.getTime() - b.creationTime.getTime());

    let currentTrip: PhotoWithLocation[] = [];

    for (const photo of sorted) {
      if (currentTrip.length === 0) {
        currentTrip.push(photo);
      } else {
        const lastPhoto = currentTrip[currentTrip.length - 1];
        const gap = photo.creationTime.getTime() - lastPhoto.creationTime.getTime();

        // Negative gap indicates corrupted/invalid timestamps (photos should be sorted)
        // Treat as same trip to avoid splitting on bad data
        if (gap < 0) {
          currentTrip.push(photo);
        } else if (gap > TIME_GAP_THRESHOLD_MS) {
          // Save current trip, start new one
          trips.push(createTripCandidate(countryCode, currentTrip));
          currentTrip = [photo];
        } else {
          currentTrip.push(photo);
        }
      }
    }

    if (currentTrip.length > 0) {
      trips.push(createTripCandidate(countryCode, currentTrip));
    }
  }

  if (__DEV__) {
    // Debug: show final trip candidates with photo counts
    const tripSummary = trips.map((t) => ({
      country: t.countryCode,
      photos: t.photos.length,
      clusters: t.locationClusters.length,
      dates: `${t.dateRange.start.toISOString().split('T')[0]} to ${t.dateRange.end.toISOString().split('T')[0]}`,
    }));
    console.log('[PhotoImport] Trip candidates:', tripSummary);
  }

  // Sort trips by date (most recent first)
  return trips.sort((a, b) => b.dateRange.end.getTime() - a.dateRange.end.getTime());
}

/**
 * Generate a stable trip prefix from country code and start date.
 *
 * Uses year-month-day granularity to create an identifier that remains stable
 * even if the oldest photo in the trip is deleted. This prevents cluster IDs
 * from changing when photos are added/removed from the cache.
 *
 * Format: {countryCode}_{YYYYMMDD}
 * Example: "JP_20240315" for a Japan trip starting March 15, 2024
 */
function generateStableTripPrefix(countryCode: string, startDate: Date): string {
  const year = startDate.getFullYear();
  const month = String(startDate.getMonth() + 1).padStart(2, '0');
  const day = String(startDate.getDate()).padStart(2, '0');
  return `${countryCode}_${year}${month}${day}`;
}

/**
 * Create a trip candidate from a group of photos.
 */
function createTripCandidate(countryCode: string, photos: PhotoWithLocation[]): TripCandidate {
  const sorted = photos.sort((a, b) => a.creationTime.getTime() - b.creationTime.getTime());
  // Use stable prefix based on country and start date to ensure cluster IDs
  // remain consistent even if the oldest photo is deleted from the device.
  // This prevents orphaned entries in processed_clusters and cached_place_suggestions.
  const tripPrefix = generateStableTripPrefix(countryCode, sorted[0].creationTime);
  const locationClusters = mergeAdjacentClusters(clusterByLocation(photos, tripPrefix));

  return {
    id: `trip_${tripPrefix}`,
    countryCode,
    dateRange: {
      start: sorted[0].creationTime,
      end: sorted[sorted.length - 1].creationTime,
    },
    photos,
    locationClusters,
  };
}
