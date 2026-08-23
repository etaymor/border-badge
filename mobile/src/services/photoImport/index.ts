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
// (markFailed, __resetForTesting) are intentionally NOT re-exported here;
// package-internal callers reach them via the relative path './photoScanService'.
//
// Importing this module REGISTERS the `trip-scan` job descriptor as a side
// effect. Resume is driven by `services/jobs` now, so there is no
// `photoScanResume` to re-export.
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
  PhotoScanFailure,
  PhotoScanFailureReason,
  PhotoScanResult,
  PhotoScanStartOptions,
  PhotoScanStartResult,
} from './photoScanTypes';
export { isAlertScanFailure } from './photoScanTypes';
export { isScanRunning } from '@services/jobs/jobRuntimeState';
export * from './errors';
