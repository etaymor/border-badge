/**
 * photoScanTypes - Leaf types shared by the trip scan's descriptor and its step.
 *
 * Exists so `photoScanSteps` can describe what it returns without importing
 * `photoScanService`, which imports it. Same leaf discipline as `jobTypes`.
 */

import type {
  LocationCluster,
  LocationClusterDisplay,
  PhotoWithLocation,
  TripCandidateDisplay,
} from './types';

export interface PhotoScanResult {
  candidates: TripCandidateDisplay[];
  photoLookup: Map<string, PhotoWithLocation>;
  clusterLookup: Map<string, LocationCluster>;
  clusterDisplays: Map<string, LocationClusterDisplay>;
  importTime: number;
  isIncremental: boolean;
  /**
   * Cluster IDs auto-dismissed during this scan because every one of their
   * photos has been uploaded to a saved entry. Merged into the workflow's
   * dismissed set on receipt; never persisted (cheap to recompute).
   *
   * Optional for backward compatibility with older results that may sit on the
   * module ref across an app upgrade. Treat absence as "no auto-dismissals".
   */
  autoDismissedClusterIds?: Set<string>;
  /**
   * Photos added to the cache by this pass. Reported to the shared sync status
   * so other library consumers (the quiz build) can see how fresh the cache is.
   */
  newPhotosCount?: number;
}

export interface PhotoScanStartOptions {
  homeCountry: string | null;
  filterCountryCode?: string;
  forceRefresh?: boolean;
  /** True when invoked by the foreground auto-resume path. Disables `forceRefresh`. */
  resumed?: boolean;
}

export type PhotoScanStartResult =
  | { status: 'started' }
  | { status: 'already-running' }
  | { status: 'queued'; blockedBy: 'quiz-build' }
  | {
      status: 'rejected';
      reason: 'no-home-country' | 'no-permission' | 'not-premium';
    };

/**
 * Every way the trip scan can fail. Unchanged from the pre-runtime store: the
 * screen's alert-vs-inline decision is an exhaustive switch over exactly these.
 */
export type PhotoScanFailureReason =
  | 'no-photos'
  | 'no-trips'
  | 'home-country'
  | 'scan-error'
  | 'stuck'
  | 'stale'
  | 'no-permission'
  | 'subscription-expired';

export interface PhotoScanFailure {
  reason: PhotoScanFailureReason;
  title: string;
  message: string;
}

/**
 * True for failure reasons that should drop the screen to idle and surface an
 * alert. False for reasons that keep the screen in place and render the inline
 * Retry button. The exhaustive switch forces every new reason to get an
 * explicit decision rather than inheriting a default.
 */
export function isAlertScanFailure(reason: string): boolean {
  switch (reason as PhotoScanFailureReason) {
    case 'no-photos':
    case 'no-trips':
    case 'home-country':
    case 'scan-error':
      return true;
    case 'stuck':
    case 'stale':
    case 'no-permission':
    case 'subscription-expired':
      return false;
    default:
      // An unrecognized reason came from outside this vocabulary (a runtime
      // gate, a future job). Treat it as inline rather than hijacking the
      // screen with an alert we have no copy for.
      return false;
  }
}
