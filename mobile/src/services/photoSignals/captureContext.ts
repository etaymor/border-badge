/**
 * Capture-context signals - what the phone was doing when the shutter fired.
 *
 * Everything here derives from data the app already holds (cached timestamps
 * and coordinates, plus the PhotoKit intent row when present). Cheap enough to
 * compute on demand for a candidate set, so nothing is persisted.
 *
 * Every signal is a PRIOR, not a verdict: `savedFromSocialLikely` and
 * `movingCapture` may only down-rank a photo, never drop it. A false positive
 * on a rank is invisible and free; a false positive on a drop hides someone's
 * photo forever.
 */

import type { PhotoIntentTag } from '@services/photoImport/photoTagDb';

import { isNearDuplicatePair } from './nearDuplicates';

import type { NearDupePhoto } from './nearDuplicates';

/** Input shape: a cached photo, with dimensions when the scan captured them. */
export interface CaptureContextPhoto extends NearDupePhoto {
  width?: number;
  height?: number;
}

export interface CaptureContext {
  /** Seconds since the previous photo in the timeline; null for the first. */
  dwellBeforeSec: number | null;
  /**
   * Same-scene shots (near-duplicate pairs) within the retry window, including
   * this one. 1 = a single snap; 4 = the user thought it was worth getting
   * right. An INTEREST signal about the scene, not a quality signal.
   */
  retryCount: number;
  /** Within the flattering low-sun band around sunrise/sunset. */
  goldenHour: boolean;
  /** Sun below the horizon. */
  night: boolean;
  /**
   * Meters above the median altitude of the same country-day group; +50m is a
   * viewpoint/summit prior. Null without enough altitude data to compare.
   */
  altitudeDelta: number | null;
  /** Speed at capture says through-a-vehicle-window (reflections, blur). */
  movingCapture: boolean;
  /** Dimensions/source say this was saved from another app, not shot here. */
  savedFromSocialLikely: boolean;
}

/** Retries cluster tighter than generic near-duplicates. */
export const RETRY_WINDOW_MS = 60_000;

/** ~20 km/h - faster than any walking capture. */
export const MOVING_CAPTURE_SPEED_MPS = 5.5;

/** Sun elevation band (degrees) treated as golden hour. */
export const GOLDEN_HOUR_MIN_ELEVATION_DEG = -6;
export const GOLDEN_HOUR_MAX_ELEVATION_DEG = 10;

/** Altitude delta needs at least this many measured neighbors to mean much. */
const MIN_ALTITUDE_SAMPLES = 3;

/**
 * Exact pixel dimensions of images saved from the major social apps. An exact
 * match plus no deliberate-capture subtype is evidence of a re-save; real
 * camera output lands on sensor dimensions, not these.
 */
const SOCIAL_SAVE_DIMENSIONS = new Set(['1080x1350', '1080x1920', '1080x1080']);

/**
 * Solar elevation in degrees at a moment and place, from the standard low
 * precision ephemeris (accurate to ~0.1 deg, far tighter than the golden-hour
 * band needs). Pure local math - no network, no tables.
 */
export function solarElevationDeg(latitude: number, longitude: number, timeMs: number): number {
  const rad = Math.PI / 180;
  // Days since J2000.0 (2000-01-01T12:00Z).
  const days = timeMs / 86_400_000 - 10_957.5;
  const meanLongitude = (280.46 + 0.9856474 * days) % 360;
  const meanAnomaly = (357.528 + 0.9856003 * days) * rad;
  const eclipticLongitude =
    (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * rad;
  const obliquity = (23.439 - 0.0000004 * days) * rad;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLongitude),
    Math.cos(eclipticLongitude)
  );
  // Local sidereal time, in radians.
  const gmstHours = 18.697374558 + 24.06570982441908 * days;
  const localSiderealRad = ((gmstHours % 24) * 15 + longitude) * rad;
  const hourAngle = localSiderealRad - rightAscension;
  const latRad = latitude * rad;
  const sinElevation =
    Math.sin(latRad) * Math.sin(declination) +
    Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle);
  return Math.asin(Math.max(-1, Math.min(1, sinElevation))) / rad;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Country + LOCAL calendar day, with local approximated from longitude
 * (15 deg/hour). A UTC day would split one day of shooting in two anywhere the
 * local date rolls over mid-outing (e.g. a morning hike in Tokyo), starving
 * the median of samples exactly when the viewpoint signal matters.
 */
function altitudeGroupKey(photo: CaptureContextPhoto): string {
  const localMs = photo.creationTime + (photo.longitude / 15) * 3_600_000;
  return `${photo.countryCode ?? '?'}:${new Date(localMs).toISOString().slice(0, 10)}`;
}

function isSavedFromSocial(
  photo: CaptureContextPhoto,
  intent: PhotoIntentTag | undefined
): boolean {
  if (!intent) return false;
  if (!intent.sourceUserLibrary) return true;
  if (intent.subtypes.length > 0) return false;
  if (!photo.width || !photo.height) return false;
  return SOCIAL_SAVE_DIMENSIONS.has(`${photo.width}x${photo.height}`);
}

/**
 * Compute contexts for a set of photos in one pass.
 *
 * `photos` should be the broadest timeline available to the caller (e.g. the
 * whole geo-eligible pool), because dwell and retry are relative measures -
 * computing them over a 3-photo slice would make everything look composed.
 */
export function computeCaptureContexts(
  photos: CaptureContextPhoto[],
  intentById: Map<string, PhotoIntentTag> = new Map()
): Map<string, CaptureContext> {
  const contexts = new Map<string, CaptureContext>();
  if (photos.length === 0) return contexts;

  const byTime = [...photos].sort((a, b) => a.creationTime - b.creationTime);

  // Median altitude per country-day group, from the intent rows that carry one.
  const altitudesByGroup = new Map<string, number[]>();
  for (const photo of byTime) {
    const altitude = intentById.get(photo.id)?.altitude;
    if (altitude == null) continue;
    const key = altitudeGroupKey(photo);
    const list = altitudesByGroup.get(key);
    if (list) {
      list.push(altitude);
    } else {
      altitudesByGroup.set(key, [altitude]);
    }
  }

  for (let index = 0; index < byTime.length; index++) {
    const photo = byTime[index];
    const intent = intentById.get(photo.id);

    // Same-scene retries: scan the tight time window around this photo. The
    // window bound keeps this near-linear on real libraries.
    let retryCount = 1;
    for (let back = index - 1; back >= 0; back--) {
      if (photo.creationTime - byTime[back].creationTime >= RETRY_WINDOW_MS) break;
      if (isNearDuplicatePair(photo, byTime[back])) retryCount += 1;
    }
    for (let ahead = index + 1; ahead < byTime.length; ahead++) {
      if (byTime[ahead].creationTime - photo.creationTime >= RETRY_WINDOW_MS) break;
      if (isNearDuplicatePair(photo, byTime[ahead])) retryCount += 1;
    }

    const elevation = solarElevationDeg(photo.latitude, photo.longitude, photo.creationTime);

    let altitudeDelta: number | null = null;
    const altitude = intent?.altitude;
    if (altitude != null) {
      const groupAltitudes = altitudesByGroup.get(altitudeGroupKey(photo));
      if (groupAltitudes && groupAltitudes.length >= MIN_ALTITUDE_SAMPLES) {
        altitudeDelta = altitude - median(groupAltitudes);
      }
    }

    contexts.set(photo.id, {
      dwellBeforeSec:
        index === 0 ? null : (photo.creationTime - byTime[index - 1].creationTime) / 1000,
      retryCount,
      goldenHour:
        elevation >= GOLDEN_HOUR_MIN_ELEVATION_DEG && elevation <= GOLDEN_HOUR_MAX_ELEVATION_DEG,
      night: elevation < GOLDEN_HOUR_MIN_ELEVATION_DEG,
      altitudeDelta,
      movingCapture: (intent?.gpsSpeed ?? 0) > MOVING_CAPTURE_SPEED_MPS,
      savedFromSocialLikely: isSavedFromSocial(photo, intent),
    });
  }

  return contexts;
}
