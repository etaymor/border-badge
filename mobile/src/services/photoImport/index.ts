/**
 * Photo import service - extracts GPS/timestamp metadata from photo library.
 */

export * from './types';
export * from './photoImportService';
export * from './photoClustering';
export * from './photoCacheDb';

// Re-export OptimizedTripData type from photoClustering
export type { OptimizedTripData } from './photoClustering';

// Explicit re-exports for background sync (for clarity)
export {
  performBackgroundPhotoSync,
  isBackgroundSyncInProgress,
  abortBackgroundSync,
  getLastSelectedCandidateId,
  setLastSelectedCandidateId,
} from './photoCacheDb';
