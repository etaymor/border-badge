/**
 * The native module is absent in Jest exactly as it is on Android and in any app
 * binary built before it existed. That absence is the contract the whole feature
 * leans on: the TypeScript half ships over-the-air first and must no-op cleanly
 * until the binary catches up.
 */

import {
  isPhotoTaggerAvailable,
  photoTaggerCapabilities,
  readPhotoMeta,
  tagPhotos,
  META_CHUNK_SIZE,
  TAG_CHUNK_SIZE,
} from '@modules/photo-tagger';

describe('photo-tagger module surface', () => {
  it('reports unavailable when the native module is not linked', () => {
    expect(isPhotoTaggerAvailable()).toBe(false);
  });

  it('returns null capabilities instead of throwing', () => {
    expect(photoTaggerCapabilities()).toBeNull();
  });

  it('resolves to an empty array rather than rejecting', async () => {
    await expect(tagPhotos(['photo-1', 'photo-2'])).resolves.toEqual([]);
  });

  it('resolves empty for an empty id list', async () => {
    await expect(tagPhotos([])).resolves.toEqual([]);
  });

  it('exposes a chunk size small enough to keep bridge payloads bounded', () => {
    expect(TAG_CHUNK_SIZE).toBeGreaterThan(0);
    expect(TAG_CHUNK_SIZE).toBeLessThanOrEqual(64);
  });

  it('resolves readPhotoMeta to an empty array rather than rejecting', async () => {
    await expect(readPhotoMeta(['photo-1', 'photo-2'])).resolves.toEqual([]);
  });

  it('exposes a metadata chunk size larger than the pixel one', () => {
    // Metadata rows carry no pixels, so the sweep may take bigger bites.
    expect(META_CHUNK_SIZE).toBeGreaterThan(TAG_CHUNK_SIZE);
  });
});
