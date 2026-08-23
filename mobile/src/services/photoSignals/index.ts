/**
 * Photo quality signal layer - purpose-agnostic interpretation of the photo
 * cache's raw signals (Vision tags, PhotoKit intent metadata, timestamps).
 *
 * Pure TS, no React, no IO except `photoTagDb` reads from consumers.
 * See docs/plans/2026-08-21-001-feat-photo-quality-signals-plan.md.
 */

export {
  NEAR_DUPLICATE_RADIUS_M,
  NEAR_DUPLICATE_WINDOW_MS,
  collapseNearDuplicates,
  filterNearDuplicatesOf,
  isNearDuplicatePair,
} from './nearDuplicates';
export type { NearDupePhoto } from './nearDuplicates';

export { computeCaptureContexts, solarElevationDeg } from './captureContext';
export type { CaptureContext, CaptureContextPhoto } from './captureContext';

export { computeQualityScores } from './qualityScore';
export type { QualityInput } from './qualityScore';

export { rankBestPhotos } from './bestPhotos';
export type { RankBestPhotosOptions } from './bestPhotos';

export { isUtilityImage, lowSignalPhotoIds } from './lowSignalPhotos';
export type { LowSignalPhotoOptions } from './lowSignalPhotos';
