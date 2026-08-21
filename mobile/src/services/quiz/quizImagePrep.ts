/**
 * Turning a cached library photo into bytes we can send.
 *
 * Both paths here share one hazard. The photo cache stores whatever the scan
 * captured (`info.localUri ?? info.uri`, with `shouldDownloadFromNetwork:
 * false`), and on an iCloud-optimized library that URI is frequently
 * unreadable later: the local copy is evicted, or the value is a volatile
 * `ph://` for an offloaded original. So every failed encode earns exactly ONE
 * `resolveLoadableUri` retry - the same on-demand iCloud materialization the
 * photo thumbnails use - and a successful retry rewrites the URI in place so
 * the next stage reuses the one already proven to load.
 *
 * Module-load discipline: expo-image-manipulator is required inline, keeping
 * the native module off the app's boot path (mirrors visionPhoto).
 */

import { getImageDimensions } from '@services/mediaUpload';
import { resolveLoadableUri } from '@services/photoImport/resolveLoadableUri';
import { prepareVisionImage } from '@services/photoImport/visionPhoto';

import type { GeoEligibleCandidate } from './candidateSelection';
import type { DraftPick } from './quizCreationTypes';

/** Bounded concurrency for local thumbnail preparation (I/O + native resize). */
export const PREPARE_CONCURRENCY = 6;

const QUIZ_UPLOAD_MAX_DIMENSION = 2048;
const QUIZ_UPLOAD_JPEG_QUALITY = 0.8;

/**
 * Prepare one candidate's vision thumbnail, recovering from a stale cached URI.
 *
 * Without the retry, every offloaded photo silently returned null, the
 * classifier saw a fraction of the batch, and a library with thousands of
 * eligible photos declined as "not enough photos".
 */
export async function prepareCandidateImage(
  candidate: GeoEligibleCandidate
): Promise<string | null> {
  const direct = await prepareVisionImage(candidate.uri);
  if (direct) return direct;

  const fresh = await resolveLoadableUri(candidate.id);
  if (!fresh || fresh === candidate.uri) return null;

  const recovered = await prepareVisionImage(fresh);
  if (recovered) {
    candidate.uri = fresh;
  }
  return recovered;
}

/**
 * Prepare a final quiz photo for upload.
 *
 * ALWAYS re-encodes through expo-image-manipulator - no pass-through for
 * already-small images (unlike `resizeImageForUpload` in mediaUpload.ts).
 * The manipulator's native save serializes pixels only (`UIImage.jpegData` on
 * iOS, `Bitmap.compress` on Android), so the output carries no EXIF GPS; the
 * unconditional re-encode is the explicit strip.
 */
export async function prepareQuizUploadImage(uri: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { manipulateAsync, SaveFormat } = require('expo-image-manipulator');

  let actions: Array<{ resize: { width?: number; height?: number } }> = [];
  try {
    const { width, height } = await getImageDimensions(uri);
    if (Math.max(width, height) > QUIZ_UPLOAD_MAX_DIMENSION) {
      actions = [
        {
          resize:
            width >= height
              ? { width: QUIZ_UPLOAD_MAX_DIMENSION }
              : { height: QUIZ_UPLOAD_MAX_DIMENSION },
        },
      ];
    }
  } catch {
    // Dimension probe failed: re-encode without resizing (strip still applies).
  }

  const result = await manipulateAsync(uri, actions, {
    format: SaveFormat.JPEG,
    compress: QUIZ_UPLOAD_JPEG_QUALITY,
  });
  return result.uri as string;
}

/**
 * Upload-side mirror of `prepareCandidateImage`: a pick chosen minutes ago can
 * still have its local copy evicted before the upload runs, so one failed
 * encode earns one re-resolve before the upload is called interrupted.
 */
export async function prepareQuizUploadImageForPick(pick: DraftPick): Promise<string> {
  try {
    return await prepareQuizUploadImage(pick.uri);
  } catch (error) {
    const fresh = await resolveLoadableUri(pick.assetId);
    if (!fresh || fresh === pick.uri) throw error;
    const prepared = await prepareQuizUploadImage(fresh);
    pick.uri = fresh;
    return prepared;
  }
}
