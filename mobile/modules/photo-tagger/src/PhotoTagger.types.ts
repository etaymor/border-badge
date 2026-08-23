/** Per-photo outcome of a tagging attempt. */
export type NativePhotoTagStatus =
  /** Signals were computed. */
  | 'ok'
  /** No locally-stored pixels (iCloud-offloaded). Retryable later. */
  | 'no-local-image'
  /** The asset id no longer resolves to a photo. */
  | 'not-found'
  /** Vision or the image decode failed. */
  | 'error';

export interface NativePhotoLabel {
  /** Vision taxonomy identifier, e.g. "beach", "document", "food". */
  identifier: string;
  confidence: number;
}

/**
 * Raw signals for one photo. Deliberately uninterpreted: no thresholds, no
 * verdicts, no scores. See `src/services/quiz/tagSignals.ts` for the reading.
 *
 * All areas are fractions of the frame (normalized bounding-box area), so they
 * are independent of the source resolution.
 */
export interface NativePhotoTag {
  /** PHAsset localIdentifier; matches `cached_photos.id`. */
  id: string;
  status: NativePhotoTagStatus;
  isScreenshot: boolean;
  faceCount: number;
  maxFaceArea: number;
  totalFaceArea: number;
  humanCount: number;
  maxHumanArea: number;
  totalHumanArea: number;
  /** Top-N labels above a low confidence floor, highest confidence first. */
  labels: NativePhotoLabel[];
  /**
   * Apple's overall aesthetics score in -1..1, or null on iOS < 18 where the
   * API does not exist. Null means "not measured", never "unattractive".
   */
  aestheticScore: number | null;
  /**
   * Apple's "utility image" flag - receipts, screenshots of text, documents.
   * Null on iOS < 18.
   */
  isUtility: boolean | null;
}

/**
 * Deliberate-capture subtypes reported by `readPhotoMeta` (nobody takes an
 * accidental panorama). Mirrors `PhotoCaptureSubtype` in `photoTagDb.ts`.
 */
export type PhotoMetaSubtype = 'pano' | 'hdr' | 'live' | 'depthEffect' | 'screenshot';

/**
 * PhotoKit intent/context metadata for one photo - zero pixels read. Like
 * `NativePhotoTag`, deliberately uninterpreted: raw values only, every
 * threshold lives in TypeScript. An id that no longer resolves still returns a
 * row, with every boolean false and every nullable null - EXCEPT
 * `sourceUserLibrary`, which reads true there: false means "saved from another
 * app" downstream, so an unresolved id must read neutral, not suspicious.
 */
export interface NativePhotoMeta {
  /** PHAsset localIdentifier; matches `cached_photos.id`. */
  id: string;
  /** Explicit like - PHAsset.isFavorite. */
  isFavorite: boolean;
  /** The asset carries adjustment data (the user edited it). */
  hasAdjustments: boolean;
  subtypes: PhotoMetaSubtype[];
  /** PHAsset.burstIdentifier; null outside a burst. */
  burstId: string | null;
  /** iOS (or the user) picked this as the best frame of its burst. */
  burstIsRepresentative: boolean;
  /** True when the asset came from the camera/user library, not an app save. */
  sourceUserLibrary: boolean;
  /** GPS altitude in meters; null when the fix carried no valid altitude. */
  altitude: number | null;
  /** GPS speed in m/s at capture; null when unknown. */
  gpsSpeed: number | null;
  /** Member of at least one user-created album. */
  inUserAlbum: boolean;
}

export type ThermalState = 'nominal' | 'fair' | 'serious' | 'critical';

export interface PhotoTaggerCapabilities {
  /** True when VNCalculateImageAestheticsScoresRequest is available (iOS 18+). */
  aesthetics: boolean;
  osMajor: number;
  /** Read fresh on every call - the user can toggle Low Power Mode any time. */
  lowPower: boolean;
  thermalState: ThermalState;
}
