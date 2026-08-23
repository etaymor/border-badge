/**
 * Types for the `job-continuation` native module.
 *
 * Mirrors `ios/ContinuedTaskHolder.swift` + `ios/JobContinuationModule.swift`.
 */

export interface JobContinuationCapabilities {
  /** True only on iOS 26+ with the static identifier permitted in Info.plist. */
  continuedProcessing: boolean;
  /** True whenever the module is present: `UIApplication.beginBackgroundTask` always exists. */
  graceWindow: boolean;
  osMajor?: number;
  lowPowerMode?: boolean;
  identifierPermitted?: boolean;
}

export type BackgroundRefreshStatus = 'available' | 'denied' | 'restricted' | 'unknown';

/**
 * What `begin()` resolved to.
 * - `pending`: a continued-processing request was submitted; `stateChanged
 *   {state:'running'}` follows when the launch handler fires.
 * - `grace-only`: the request could not be submitted (older iOS, identifier
 *   not permitted, or submit threw); only the grace window will be held.
 * - `already-running`: a lease is already active; `leaseId` is the current one.
 * - `unavailable`: the module is absent (Android, Jest, an older binary).
 */
export type LeaseBeginState = 'pending' | 'grace-only' | 'already-running' | 'unavailable';

export interface LeaseBeginResult {
  leaseId: string;
  state: LeaseBeginState;
  reason?: string;
}

export type LeaseTier = 'continued' | 'grace';

export interface LeaseStateChangedEvent {
  leaseId: string;
  state: 'running';
}

export interface LeaseExpiredEvent {
  leaseId: string;
  tier: LeaseTier;
}
