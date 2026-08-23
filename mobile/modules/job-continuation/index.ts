/**
 * job-continuation - keeps a library job running after the app is backgrounded.
 *
 * iOS only, and OPTIONAL by construction: `requireOptionalNativeModule` returns
 * null on Android, in Jest, and in any app binary built before this module
 * existed. Every function below is a no-op (or resolves to an inert value) in
 * that case, which is what lets the TypeScript driver ship over-the-air ahead
 * of the binary that contains the module. `capabilities()` is the single
 * feature probe; nothing in the runtime imports this module statically.
 */

import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import type {
  BackgroundRefreshStatus,
  JobContinuationCapabilities,
  LeaseBeginResult,
  LeaseBeginState,
  LeaseExpiredEvent,
  LeaseStateChangedEvent,
  LeaseTier,
} from './src/JobContinuation.types';

export type {
  BackgroundRefreshStatus,
  JobContinuationCapabilities,
  LeaseBeginResult,
  LeaseBeginState,
  LeaseExpiredEvent,
  LeaseStateChangedEvent,
  LeaseTier,
};

interface Subscription {
  remove(): void;
}

interface JobContinuationNativeModule {
  capabilities(): JobContinuationCapabilities;
  backgroundRefreshStatus(): Promise<BackgroundRefreshStatus>;
  begin(options: { title: string; subtitle: string }): Promise<LeaseBeginResult>;
  updateProgress(completed: number, total: number): void;
  updateTitle(title: string, subtitle: string): void;
  end(success: boolean): Promise<void>;
  addListener(event: 'stateChanged', listener: (e: LeaseStateChangedEvent) => void): Subscription;
  addListener(event: 'expired', listener: (e: LeaseExpiredEvent) => void): Subscription;
}

const nativeModule =
  Platform.OS === 'ios'
    ? requireOptionalNativeModule<JobContinuationNativeModule>('JobContinuation')
    : null;

const ABSENT_CAPABILITIES: JobContinuationCapabilities = {
  continuedProcessing: false,
  graceWindow: false,
};

export function isJobContinuationAvailable(): boolean {
  return nativeModule != null;
}

/** The single feature probe. `{continuedProcessing:false, graceWindow:false}` when absent. */
export function jobContinuationCapabilities(): JobContinuationCapabilities {
  if (!nativeModule) return ABSENT_CAPABILITIES;
  try {
    return nativeModule.capabilities();
  } catch {
    return ABSENT_CAPABILITIES;
  }
}

export async function backgroundRefreshStatus(): Promise<BackgroundRefreshStatus> {
  if (!nativeModule) return 'unknown';
  try {
    return await nativeModule.backgroundRefreshStatus();
  } catch {
    return 'unknown';
  }
}

/** Begin a lease. Resolves `{leaseId:'', state:'unavailable'}` when the module is absent. */
export async function beginLease(options: {
  title: string;
  subtitle: string;
}): Promise<LeaseBeginResult> {
  if (!nativeModule) return { leaseId: '', state: 'unavailable' };
  return nativeModule.begin(options);
}

/** Push monotonic progress to the system UI. Coalesced natively; no-op when absent. */
export function updateLeaseProgress(completed: number, total: number): void {
  if (!nativeModule) return;
  try {
    nativeModule.updateProgress(Math.max(0, Math.floor(completed)), Math.max(0, Math.floor(total)));
  } catch {
    // A progress push is never worth a crash.
  }
}

export function updateLeaseTitle(title: string, subtitle: string): void {
  if (!nativeModule) return;
  try {
    nativeModule.updateTitle(title, subtitle);
  } catch {
    // See updateLeaseProgress.
  }
}

/** End the lease: cancels a pending request, completes a running task, drops the grace assertion. */
export async function endLease(success: boolean): Promise<void> {
  if (!nativeModule) return;
  try {
    await nativeModule.end(success);
  } catch {
    // Ending twice, or after a reload, is fine.
  }
}

const NOOP_REMOVER = (): void => {};

/** Subscribe to `stateChanged`. Returns a remover; never throws when absent. */
export function addLeaseStateListener(listener: (e: LeaseStateChangedEvent) => void): () => void {
  if (!nativeModule) return NOOP_REMOVER;
  const subscription = nativeModule.addListener('stateChanged', listener);
  return () => subscription.remove();
}

/** Subscribe to `expired`. Returns a remover; never throws when absent. */
export function addLeaseExpiredListener(listener: (e: LeaseExpiredEvent) => void): () => void {
  if (!nativeModule) return NOOP_REMOVER;
  const subscription = nativeModule.addListener('expired', listener);
  return () => subscription.remove();
}
