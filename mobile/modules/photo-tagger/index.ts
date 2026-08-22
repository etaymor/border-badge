/**
 * photo-tagger - on-device photo signals via Apple's Vision framework.
 *
 * iOS only, and OPTIONAL by construction: `requireOptionalNativeModule` returns
 * null on Android, in Jest, and in any app binary built before this module
 * existed. Every consumer must treat absence as "no tags available" and fall
 * back to today's behavior, which is what lets the TypeScript half of this
 * feature ship over-the-air ahead of the binary that contains the module.
 */

import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import type {
  NativePhotoTag,
  NativePhotoLabel,
  NativePhotoTagStatus,
  NativePhotoMeta,
  PhotoMetaSubtype,
  PhotoTaggerCapabilities,
  ThermalState,
} from './src/PhotoTagger.types';

export type {
  NativePhotoTag,
  NativePhotoLabel,
  NativePhotoTagStatus,
  NativePhotoMeta,
  PhotoMetaSubtype,
  PhotoTaggerCapabilities,
  ThermalState,
};

interface PhotoTaggerNativeModule {
  capabilities(): PhotoTaggerCapabilities;
  tagPhotos(assetIds: string[]): Promise<NativePhotoTag[]>;
  readPhotoMeta(assetIds: string[]): Promise<NativePhotoMeta[]>;
}

const nativeModule =
  Platform.OS === 'ios'
    ? requireOptionalNativeModule<PhotoTaggerNativeModule>('PhotoTagger')
    : null;

/**
 * Largest id list per native call. Small enough to keep the bridge payload
 * modest and bounded native memory per chunk, and to give the scheduler an
 * abort point between chunks.
 */
export const TAG_CHUNK_SIZE = 32;

/** Metadata-only rows are tiny (no pixels, no Vision), so a much larger chunk than TAG_CHUNK_SIZE keeps the bridge payload modest. */
export const META_CHUNK_SIZE = 250;

export function isPhotoTaggerAvailable(): boolean {
  return nativeModule != null;
}

/** Returns null when the module is unavailable. */
export function photoTaggerCapabilities(): PhotoTaggerCapabilities | null {
  if (!nativeModule) return null;
  try {
    return nativeModule.capabilities();
  } catch {
    return null;
  }
}

/**
 * Tag a chunk of photos. Resolves to one entry per requested id (order is not
 * guaranteed to be meaningful - match on `id`). Resolves to an empty array when
 * the module is unavailable rather than throwing, so callers never need a
 * platform check of their own.
 */
export async function tagPhotos(assetIds: string[]): Promise<NativePhotoTag[]> {
  if (!nativeModule || assetIds.length === 0) return [];
  return nativeModule.tagPhotos(assetIds);
}

/**
 * Read intent/context metadata for a chunk of photos - zero pixels. Same
 * degradation contract as `tagPhotos`: resolves to an empty array when the
 * module is unavailable rather than throwing.
 */
export async function readPhotoMeta(assetIds: string[]): Promise<NativePhotoMeta[]> {
  if (!nativeModule || assetIds.length === 0) return [];
  return nativeModule.readPhotoMeta(assetIds);
}
