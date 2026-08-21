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

export type ThermalState = 'nominal' | 'fair' | 'serious' | 'critical';

export interface PhotoTaggerCapabilities {
  /** True when VNCalculateImageAestheticsScoresRequest is available (iOS 18+). */
  aesthetics: boolean;
  osMajor: number;
  /** Read fresh on every call - the user can toggle Low Power Mode any time. */
  lowPower: boolean;
  thermalState: ThermalState;
}
