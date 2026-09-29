/**
 * Tagger versioning and the native-to-stored row mapping for `photo_ml_tags`.
 *
 * Split out of photoTagDb.ts (SQL) and photoTaggingService.ts (scheduling) so
 * the version rule has one home that both read.
 *
 * Venue-rollup U10 added signage text recognition to the Swift tagger. That is
 * a native change, but the JS ships over the air ahead of it, so the version is
 * NOT bumped unconditionally: rows are stamped `TAGGER_VERSION + 1` only when
 * the running binary reports `textRecognition`. An older binary therefore
 * neither re-tags the library nor stamps rows as text-recognized, and the first
 * pass on a new binary re-tags existing rows exactly once.
 */

import {
  photoTaggerCapabilities,
  type NativePhotoTag,
  type PhotoTaggerCapabilities,
} from '@modules/photo-tagger';

import type { PhotoMlTag, PhotoSignText } from './photoTagDb';

/**
 * Version of the native signal set WITHOUT text recognition. Bump ONLY when
 * the Swift module changes what it emits (a new request, a different
 * normalization); rows below the effective version are re-tagged on the next
 * pass. Retuning thresholds must NOT bump this - that is the whole point of
 * storing raw signals plus `labels_json`.
 */
export const TAGGER_VERSION = 1;

/** Version stamped by a binary whose tagger also reads text (U10). */
export const TEXT_RECOGNITION_TAGGER_VERSION = TAGGER_VERSION + 1;

/**
 * The version this binary's tagger produces. Reads the live capabilities by
 * default; a missing module, a failed call, or an older binary without the
 * `textRecognition` key all read as the base version.
 */
export function effectiveTaggerVersion(
  capabilities: PhotoTaggerCapabilities | null = photoTaggerCapabilities()
): number {
  return capabilities?.textRecognition === true ? TEXT_RECOGNITION_TAGGER_VERSION : TAGGER_VERSION;
}

/**
 * Normalize the native `text` field. `undefined` (older binary) and `null`
 * (not measured) both store as null; an array is measured, even when empty.
 * Malformed entries are dropped rather than failing the chunk.
 */
function toSignText(text: NativePhotoTag['text']): PhotoSignText[] | null {
  if (!Array.isArray(text)) return null;
  return text.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const { string, confidence, area } = entry as {
      string?: unknown;
      confidence?: unknown;
      area?: unknown;
    };
    if (typeof string !== 'string' || typeof confidence !== 'number') return [];
    return [{ text: string, confidence, area: typeof area === 'number' ? area : 0 }];
  });
}

/** Map the native payload onto stored rows. */
export function toStoredTags(
  native: NativePhotoTag[],
  taggerVersion: number = effectiveTaggerVersion(),
  computedAt: number = Date.now()
): PhotoMlTag[] {
  return native.map((tag) => ({
    id: tag.id,
    taggerVersion,
    status: tag.status,
    isScreenshot: tag.isScreenshot,
    faceCount: tag.faceCount,
    maxFaceArea: tag.maxFaceArea,
    totalFaceArea: tag.totalFaceArea,
    humanCount: tag.humanCount,
    maxHumanArea: tag.maxHumanArea,
    totalHumanArea: tag.totalHumanArea,
    labels: tag.labels,
    aestheticScore: tag.aestheticScore,
    isUtility: tag.isUtility,
    signText: toSignText(tag.text),
    computedAt,
  }));
}

/** Serialize sign text compactly (`{t,c,a}`), or null when not measured. */
export function serializeSignText(signText: PhotoSignText[] | null | undefined): string | null {
  if (!signText) return null;
  return JSON.stringify(signText.map((s) => ({ t: s.text, c: s.confidence, a: s.area })));
}

/** Parse `sign_text_json`; a missing or malformed blob reads as not measured. */
export function parseSignText(json: string | null | undefined): PhotoSignText[] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const { t, c, a } = entry as { t?: unknown; c?: unknown; a?: unknown };
      if (typeof t !== 'string' || typeof c !== 'number') return [];
      return [{ text: t, confidence: c, area: typeof a === 'number' ? a : 0 }];
    });
  } catch {
    return null;
  }
}
