/**
 * Foreground auto-resume gates for photoScanService.
 *
 * On app foreground (or other safe trigger), this module checks the durable
 * scan-in-progress flag and seven gating conditions before kicking off
 * `photoScanService.start({ resumed: true })`. If any gate fails, the flag
 * is cleared and (depending on the gate) the store transitions to `failed`
 * with the appropriate reason.
 */

import * as MediaLibrary from 'expo-media-library';

import { useOnboardingStore } from '@stores/onboardingStore';
import { FREE_LIMITS, useSubscriptionStore } from '@stores/subscriptionStore';
import {
  clearScanInProgressMetadata,
  getCancelInFlight,
  getLastProgressAt,
  markFailed,
  readScanInProgressMetadata,
  startScan,
} from './photoScanService';
import { isScanRunning } from './photoScanState';
import { usePhotoScanStore } from '@stores/photoScanStore';

/** Auto-resume considers the scan-in-progress flag stale after this long. */
export const RESUME_STALENESS_MS = 60 * 60 * 1000; // 60 minutes

/** Stuck-scan detection: no progress for this long while phase=scanning. */
export const STUCK_SCAN_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export type ResumeOutcome =
  | { status: 'started' }
  | { status: 'skipped'; reason: 'no-flag' | 'already-running' | 'deferred' }
  | {
      status: 'failed-gate';
      reason: 'stale' | 'no-permission' | 'no-home-country' | 'subscription-expired';
    };

/**
 * Read the seven resume gates and either start the service or surface the
 * appropriate failure. Safe to call from foreground transitions; callers
 * should also rely on `photoScanService` foreground-event serialization to
 * avoid double-fire on rapid bounces.
 */
export async function tryResumeScan(): Promise<ResumeOutcome> {
  // If a recent cancelScan() kicked off async metadata clearing, await it
  // before reading the durable flag — otherwise a fast cancel + foreground
  // bounce reads the stale 'true' flag and resurrects the scan.
  const pendingCancel = getCancelInFlight();
  if (pendingCancel) {
    await pendingCancel;
  }

  // Gate 7 fast-path: already running, nothing to do.
  if (isScanRunning()) {
    return { status: 'skipped', reason: 'already-running' };
  }

  // Gate 1: durable flag must say a scan was in progress.
  const meta = await readScanInProgressMetadata();
  if (!meta.inProgress) {
    return { status: 'skipped', reason: 'no-flag' };
  }

  // Gate 3: stale flag (>60min) → clear and fail.
  if (meta.startedAt != null && Date.now() - meta.startedAt > RESUME_STALENESS_MS) {
    await clearScanInProgressMetadata();
    markFailed({
      reason: 'stale',
      title: 'Scan Stopped',
      message: 'The previous scan was interrupted. Tap to start over.',
    });
    return { status: 'failed-gate', reason: 'stale' };
  }

  // Gate 4: media library permission must still be granted.
  const perms = await MediaLibrary.getPermissionsAsync();
  if (perms.status !== 'granted') {
    await clearScanInProgressMetadata();
    markFailed({
      reason: 'no-permission',
      title: 'Photo Access Needed',
      message: 'Re-enable photo library access in Settings to resume the scan.',
    });
    return { status: 'failed-gate', reason: 'no-permission' };
  }

  // Gate 5: home country gating — defer if onboarding hasn't hydrated yet.
  const onboardingState = useOnboardingStore.getState();
  // useOnboardingStore.persist.hasHydrated() returns true when AsyncStorage rehydration
  // has completed. Treat missing persist as "not hydrated" so the gate defers —
  // surfaces real bugs (e.g. accidentally dropping persist middleware) rather
  // than silently passing the gate.
  const hydrated = useOnboardingStore.persist?.hasHydrated() ?? false;
  if (!onboardingState.homeCountry) {
    if (!hydrated) {
      // Defer: let the next foreground or a hydration-driven retry handle it.
      return { status: 'skipped', reason: 'deferred' };
    }
    await clearScanInProgressMetadata();
    markFailed({
      reason: 'home-country',
      title: 'Set Home Country',
      message: 'Please set your home country in settings to resume the scan.',
    });
    return { status: 'failed-gate', reason: 'no-home-country' };
  }

  // Gate 6: subscription state must still allow photo import.
  // Defer if the subscription store hasn't rehydrated yet — otherwise a stale
  // 'free' default could falsely trip the gate before RevenueCat sync lands.
  const subHydrated = useSubscriptionStore.persist?.hasHydrated() ?? false;
  if (!subHydrated) {
    return { status: 'skipped', reason: 'deferred' };
  }
  // Premium = subscribed or trialing; otherwise check the free-tier counter.
  // Mirrors useCanImportPhotos in subscriptionStore.
  const subscriptionState = useSubscriptionStore.getState();
  const isPremium = subscriptionState.status === 'premium' || subscriptionState.status === 'trial';
  const canImportPhotos = isPremium || subscriptionState.photoImportUsage < FREE_LIMITS.photoImport;
  if (!canImportPhotos) {
    await clearScanInProgressMetadata();
    markFailed({
      reason: 'subscription-expired',
      title: 'Subscription Required',
      message: 'A subscription is required to continue scanning photos.',
    });
    return { status: 'failed-gate', reason: 'subscription-expired' };
  }

  // All gates pass — kick off the resume.
  const result = await startScan({
    homeCountry: onboardingState.homeCountry,
    resumed: true,
  });
  if (result.status === 'started') {
    return { status: 'started' };
  }
  // The service may have flipped 'already-running' between our gate check and
  // its own atomic check. Either way, treat this as no-op.
  return { status: 'skipped', reason: 'already-running' };
}

/**
 * Stuck-scan detector. Surfaces a `failed` state with reason='stuck' when
 * the service is supposedly scanning but `lastProgressAt` hasn't advanced for
 * `STUCK_SCAN_THRESHOLD_MS`. Safe to call on any tick; no-op when not scanning.
 */
export function detectStuckScan(): boolean {
  const phase = usePhotoScanStore.getState().phase;
  if (phase !== 'scanning') return false;
  const lastAt = getLastProgressAt();
  if (lastAt === 0) return false; // Scan just started; no progress yet is fine.
  if (Date.now() - lastAt <= STUCK_SCAN_THRESHOLD_MS) return false;

  markFailed({
    reason: 'stuck',
    title: 'Scan Stopped',
    message: 'The scan stopped making progress. Tap to retry.',
  });
  return true;
}
