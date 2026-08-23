/**
 * Vision photo selection and preparation.
 *
 * Selects up to 3 representative photos per cluster,
 * resizes to 768px max dimension, and encodes as base64 JPEG for
 * the vision classification API.
 */

import { Image } from 'react-native';

import { features } from '@config/features';
import {
  collapseNearDuplicates,
  computeCaptureContexts,
  computeQualityScores,
  isNearDuplicatePair,
} from '@services/photoSignals';

import { haversine } from './photoClustering';
import { getIntentTagsForIds, getTagsForIds } from './photoTagDb';
import type { LocationCluster, PhotoWithLocation } from './types';

const VISION_MAX_DIMENSION = 768;
const VISION_JPEG_QUALITY = 0.8;
const MAX_VISION_PHOTOS_PER_CLUSTER = 3;
const MAX_VISION_BASE64_LENGTH = 200_000; // Matches backend 200,000 char limit

/**
 * Bound on ONE photo's native preparation (probe + encode), in ms.
 *
 * `Image.getSize` and `manipulateAsync` are the only unbounded waits in the
 * suggestion pipeline. Over a `ph://` asset whose pixels live only in iCloud
 * ("Optimize iPhone Storage") either can hang without ever calling back — not a
 * rejection, so the `catch` below never runs — and a preparation that never
 * settles freezes the entire import: no batch is posted, no cluster is
 * attributed a failure, and every location renders a pending row forever.
 *
 * Ten seconds is far above a healthy local encode (tens of ms) and below the
 * batch-level backstop in `suggestionDispatch`, so the tight bound is the one
 * that normally fires. Timing out costs this photo its vision image, nothing
 * more — the cluster still goes to the place matcher on its coordinates.
 */
export const VISION_IMAGE_TIMEOUT_MS = 10000;

/**
 * Reject if `work` hasn't settled within `VISION_IMAGE_TIMEOUT_MS`.
 *
 * A rejection rather than a null so it lands in the existing `catch` and is
 * reported through the one failure path. The abandoned promise is left to
 * settle whenever the native layer gets to it; nothing reads it.
 */
function withNativeTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const watchdog = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${VISION_IMAGE_TIMEOUT_MS}ms`)),
      VISION_IMAGE_TIMEOUT_MS
    );
  });
  return Promise.race([work, watchdog]).finally(() => clearTimeout(timer)) as Promise<T>;
}

function getImageDimensions(photoUri: string): Promise<{ width: number; height: number }> {
  return withNativeTimeout(
    new Promise<{ width: number; height: number }>((resolve, reject) => {
      Image.getSize(
        photoUri,
        (width, height) => resolve({ width, height }),
        () => reject(new Error('Failed to get image size'))
      );
    }),
    'Image.getSize'
  );
}

/**
 * Adapter to the flat `photoSignals` shape (ms timestamp, top-level coords).
 * `countryCode` comes from the cluster: near-duplicate detection requires a
 * non-null match, so a cluster without one collapses nothing — a safe no-op.
 */
function toSignalPhoto(photo: PhotoWithLocation, countryCode: string | null) {
  return {
    photo,
    id: photo.id,
    creationTime: photo.creationTime.getTime(),
    latitude: photo.location.latitude,
    longitude: photo.location.longitude,
    countryCode,
    width: photo.width,
    height: photo.height,
  };
}

/**
 * Quality-aware selection (docs/plans/2026-08-21-001, 3b). The
 * closest-to-centroid anchor stays FIRST and unconditional — it is load-bearing
 * for place matching, even when it scores poorly. Remaining slots come from the
 * duplicate-collapsed pool so two frames of one burst are never both sent to
 * Gemini: scored photos in descending quality, then unscored ones in the
 * pre-existing distance order.
 */
function selectByQuality(
  cluster: LocationCluster,
  byDistance: PhotoWithLocation[],
  maxPhotos: number,
  quality: Map<string, number>
): PhotoWithLocation[] {
  const countryCode = cluster.countryCode ?? null;
  const candidates = byDistance.map((photo) => toSignalPhoto(photo, countryCode));

  // Best-quality frame survives each near-duplicate group; newest wins ties
  // (mirrors `bestFrame` in quiz/candidateSelection.ts, so an unscored group
  // collapses exactly like the pre-signals default).
  const collapsed = collapseNearDuplicates(candidates, (group) => {
    let best = group[group.length - 1];
    for (const candidate of group) {
      if ((quality.get(candidate.id) ?? 0) > (quality.get(best.id) ?? 0)) best = candidate;
    }
    return best;
  });

  const anchor = byDistance[0];
  const anchorSignal = toSignalPhoto(anchor, countryCode);

  // The anchor is kept regardless of collapse, so its burst siblings must be
  // excluded here — otherwise the anchor plus its group's surviving frame would
  // reintroduce the very pair the collapse exists to prevent.
  const pool = collapsed.filter(
    (item) => item.id !== anchor.id && !isNearDuplicatePair(anchorSignal, item)
  );
  const scoreOf = (id: string) => quality.get(id) ?? Number.NEGATIVE_INFINITY;
  const ordered = [...pool].sort((a, b) => {
    const scoreA = scoreOf(a.id);
    const scoreB = scoreOf(b.id);
    // Stable sort keeps distance order among equal (and unscored) photos.
    return scoreA === scoreB ? 0 : scoreB - scoreA;
  });

  const selected: PhotoWithLocation[] = [anchor];
  for (const item of ordered) {
    if (selected.length >= maxPhotos) break;
    selected.push(item.photo);
  }
  return selected;
}

/**
 * Select representative photos for vision classification.
 *
 * Selection strategy:
 * - Closest-to-centroid photo (strong location anchor)
 * - Earliest and latest photos (temporal diversity)
 * - Fill remaining slots with next closest photos
 *
 * With a non-empty `quality` map (photo id -> composite quality score), the
 * temporal-diversity slots become quality slots instead: see `selectByQuality`.
 * Without one, behavior is byte-identical to the pre-signals selection. Pure
 * either way — the caller loads the map.
 */
export function selectRepresentativePhotos(
  cluster: LocationCluster,
  maxPhotos: number = MAX_VISION_PHOTOS_PER_CLUSTER,
  quality?: Map<string, number>
): PhotoWithLocation[] {
  if (cluster.photos.length === 0 || maxPhotos <= 0) return [];

  const byDistance = cluster.photos
    .map((photo) => ({
      photo,
      distance: haversine(
        cluster.centroid.latitude,
        cluster.centroid.longitude,
        photo.location.latitude,
        photo.location.longitude
      ),
    }))
    .sort((a, b) => a.distance - b.distance)
    .map((item) => item.photo);

  if (quality !== undefined && quality.size > 0) {
    return selectByQuality(cluster, byDistance, maxPhotos, quality);
  }

  const byTime = [...cluster.photos].sort(
    (a, b) => a.creationTime.getTime() - b.creationTime.getTime()
  );
  const earliest = byTime[0];
  const latest = byTime[byTime.length - 1];

  const selected: PhotoWithLocation[] = [];
  const selectedIds = new Set<string>();

  const addPhoto = (photo: PhotoWithLocation | undefined) => {
    if (!photo || selectedIds.has(photo.id) || selected.length >= maxPhotos) return;
    selected.push(photo);
    selectedIds.add(photo.id);
  };

  addPhoto(byDistance[0]);
  addPhoto(earliest);
  addPhoto(latest);

  for (const photo of byDistance) {
    if (selected.length >= maxPhotos) {
      break;
    }
    addPhoto(photo);
  }

  return selected;
}

/**
 * Select the single representative photo for legacy call sites.
 */
export function selectRepresentativePhoto(cluster: LocationCluster): PhotoWithLocation | null {
  return selectRepresentativePhotos(cluster, 1)[0] ?? null;
}

/** Pixel dimensions carried on a cached photo (U5/R7). Either may be missing. */
export interface KnownImageDimensions {
  width?: number;
  height?: number;
}

/** True when both dimensions are present and usable as a resize decision. */
function hasUsableDimensions(
  dimensions: KnownImageDimensions | undefined
): dimensions is { width: number; height: number } {
  return (
    dimensions !== undefined &&
    typeof dimensions.width === 'number' &&
    typeof dimensions.height === 'number' &&
    dimensions.width > 0 &&
    dimensions.height > 0
  );
}

/**
 * Prepare a photo for vision classification.
 * Resizes to 768px max dimension and encodes as base64 JPEG (~50-80KB).
 *
 * `knownDimensions` (U5/R7) comes from the photo cache and, when present, skips
 * the `Image.getSize` probe — an extra full decode of every representative
 * photo. It is only a resize DECISION input: an image already under the cap
 * must still be passed an empty action list, because an unconditional resize
 * action UPSCALES it, inflating the payload toward the reject threshold.
 *
 * Returns null on failure (silent fallback - vision is optional).
 */
export async function prepareVisionImage(
  photoUri: string,
  knownDimensions?: KnownImageDimensions
): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { manipulateAsync, SaveFormat } = require('expo-image-manipulator');
    const { width, height } = hasUsableDimensions(knownDimensions)
      ? knownDimensions
      : await getImageDimensions(photoUri);
    const shouldResize = width > VISION_MAX_DIMENSION || height > VISION_MAX_DIMENSION;
    const resizeActions = shouldResize
      ? [
          {
            resize:
              width >= height ? { width: VISION_MAX_DIMENSION } : { height: VISION_MAX_DIMENSION },
          },
        ]
      : [];

    const result = await withNativeTimeout<{ uri: string; base64?: string }>(
      manipulateAsync(photoUri, resizeActions, {
        format: SaveFormat.JPEG,
        compress: VISION_JPEG_QUALITY,
        base64: true,
      }),
      'manipulateAsync'
    );
    const base64 = result.base64 ?? null;
    if (base64 && base64.length > MAX_VISION_BASE64_LENGTH) {
      if (__DEV__) {
        console.warn(`[VisionPhoto] Image too large after compression: ${base64.length} chars`);
      }
      return null;
    }
    return base64;
  } catch (error) {
    if (__DEV__) {
      console.warn(
        '[VisionPhoto] Failed to prepare vision image:',
        error instanceof Error ? error.message : error
      );
    }
    return null;
  }
}

/**
 * Load composite quality scores for a cluster's photos, or undefined.
 *
 * Best-effort by design: vision selection must never fail a suggestion fetch,
 * so a read error — or a cluster with no tag rows at all — degrades to
 * undefined, which is the pre-signals selection. Contexts are computed over the
 * cluster's own timeline (the broadest set this call site has), and gated on
 * BOTH flags because the composite score without intent rows is mostly noise.
 */
async function loadClusterQualityScores(
  cluster: LocationCluster
): Promise<Map<string, number> | undefined> {
  if (!features.enableQualityRanking || !features.enableIntentSignals) return undefined;
  try {
    const ids = cluster.photos.map((photo) => photo.id);
    const [tags, intents] = await Promise.all([getTagsForIds(ids), getIntentTagsForIds(ids)]);
    if (tags.size === 0 && intents.size === 0) return undefined;

    const countryCode = cluster.countryCode ?? null;
    const contexts = computeCaptureContexts(
      cluster.photos.map((photo) => toSignalPhoto(photo, countryCode)),
      intents
    );
    return computeQualityScores(
      cluster.photos.map((photo) => ({
        id: photo.id,
        aestheticScore: tags.get(photo.id)?.aestheticScore ?? null,
        intent: intents.get(photo.id),
        context: contexts.get(photo.id),
      }))
    );
  } catch (error) {
    if (__DEV__) {
      console.warn(
        '[VisionPhoto] Quality signal load failed:',
        error instanceof Error ? error.message : error
      );
    }
    return undefined;
  }
}

/**
 * Select and prepare representative photos for a cluster.
 *
 * Returns an array of successfully prepared base64 images (0 to maxPhotos).
 */
export async function getVisionImagesForCluster(
  cluster: LocationCluster,
  maxPhotos: number = MAX_VISION_PHOTOS_PER_CLUSTER
): Promise<string[]> {
  const quality = await loadClusterQualityScores(cluster);
  const photos = selectRepresentativePhotos(cluster, maxPhotos, quality);
  if (photos.length === 0) return [];

  const prepared = await Promise.all(
    photos.map((photo) =>
      prepareVisionImage(photo.uri, { width: photo.width, height: photo.height })
    )
  );
  return prepared.filter((image): image is string => typeof image === 'string' && image.length > 0);
}

/**
 * Select and prepare one representative photo for backwards compatibility.
 */
export async function getVisionImageForCluster(cluster: LocationCluster): Promise<string | null> {
  const images = await getVisionImagesForCluster(cluster, 1);
  return images[0] ?? null;
}
