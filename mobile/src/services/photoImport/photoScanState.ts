/**
 * Shared scan state primitives accessible without importing photoScanService.
 * Breaks the circular dependency between photoScanService and photoBackgroundSync:
 * the service used to import abortBackgroundSync from photoBackgroundSync, while
 * photoBackgroundSync needed isScanRunning from the service. Both now read this
 * leaf module.
 */

let scanInProgress = false;

export function isScanRunning(): boolean {
  return scanInProgress;
}

/** Internal — set by photoScanService only. */
export function _setScanRunning(value: boolean): void {
  scanInProgress = value;
}
