/**
 * Vision photo selection and preparation.
 *
 * Selects up to 3 representative photos per cluster,
 * resizes to 768px max dimension, and encodes as base64 JPEG for
 * the vision classification API.
 */

import * as ImageManipulator from 'expo-image-manipulator';
import { SaveFormat } from 'expo-image-manipulator';
import { Image } from 'react-native';

import { haversine } from './photoClustering';
import type { LocationCluster, PhotoWithLocation } from './types';

const VISION_MAX_DIMENSION = 768;
const VISION_JPEG_QUALITY = 0.8;
const MAX_VISION_PHOTOS_PER_CLUSTER = 3;

function getImageDimensions(photoUri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      photoUri,
      (width, height) => resolve({ width, height }),
      () => reject(new Error('Failed to get image size'))
    );
  });
}

/**
 * Select representative photos for vision classification.
 *
 * Selection strategy:
 * - Closest-to-centroid photo (strong location anchor)
 * - Earliest and latest photos (temporal diversity)
 * - Fill remaining slots with next closest photos
 */
export function selectRepresentativePhotos(
  cluster: LocationCluster,
  maxPhotos: number = MAX_VISION_PHOTOS_PER_CLUSTER
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

/**
 * Prepare a photo for vision classification.
 * Resizes to 768px max dimension and encodes as base64 JPEG (~50-80KB).
 *
 * Returns null on failure (silent fallback - vision is optional).
 */
export async function prepareVisionImage(photoUri: string): Promise<string | null> {
  try {
    const { width, height } = await getImageDimensions(photoUri);
    const shouldResize = width > VISION_MAX_DIMENSION || height > VISION_MAX_DIMENSION;
    const resizeActions = shouldResize
      ? [
          {
            resize:
              width >= height ? { width: VISION_MAX_DIMENSION } : { height: VISION_MAX_DIMENSION },
          },
        ]
      : [];

    const result = await ImageManipulator.manipulateAsync(photoUri, resizeActions, {
      format: SaveFormat.JPEG,
      compress: VISION_JPEG_QUALITY,
      base64: true,
    });
    return result.base64 ?? null;
  } catch {
    if (__DEV__) {
      console.warn('[VisionPhoto] Failed to prepare vision image');
    }
    return null;
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
  const photos = selectRepresentativePhotos(cluster, maxPhotos);
  if (photos.length === 0) return [];

  const prepared = await Promise.all(photos.map((photo) => prepareVisionImage(photo.uri)));
  return prepared.filter((image): image is string => typeof image === 'string' && image.length > 0);
}

/**
 * Select and prepare one representative photo for backwards compatibility.
 */
export async function getVisionImageForCluster(cluster: LocationCluster): Promise<string | null> {
  const images = await getVisionImagesForCluster(cluster, 1);
  return images[0] ?? null;
}
