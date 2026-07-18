/**
 * Photo import service - extracts GPS/timestamp metadata from photo library.
 */

export * from './types';
export * from './photoImportService';
export * from './photoClustering';
export * from './photoClusteringTrips';
export * from './photoClusteringDisplay';
export * from './photoClusteringCache';
export * from './photoCacheDb';
export * from './photoCacheDbSuggestions';
export * from './photoBackgroundSync';
export * from './resolveLoadableUri';
// Explicit named re-exports of the public photoScanService API. Internal helpers
// (markFailed, readScanInProgressMetadata, clearScanInProgressMetadata,
// __resetForTesting) are intentionally NOT re-exported here; package-internal
// callers reach them via the relative path './photoScanService'.
export {
  startScan,
  cancelScan,
  consumeResult,
  hasResult,
  getLastProgressAt,
  getScanStartedAt,
  getLastStartOptions,
  resetForUserChange,
} from './photoScanService';
export type {
  PhotoScanResult,
  PhotoScanStartOptions,
  PhotoScanStartResult,
} from './photoScanService';
export { isScanRunning } from './photoScanState';
export * from './photoScanResume';
export * from './errors';
