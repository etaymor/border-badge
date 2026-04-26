/**
 * Tests for the foreground auto-resume gates.
 *
 * Each of the seven gates from the plan gets at least one explicit case;
 * happy path, stale flag, missing permission, missing home country (hydrated
 * vs not hydrated), expired subscription, already-running, and the no-flag
 * skip.
 */

import {
  RESUME_STALENESS_MS,
  STUCK_SCAN_THRESHOLD_MS,
  detectStuckScan,
  tryResumeScan,
} from '../../../services/photoImport/photoScanResume';
import { resetPhotoScanStore, usePhotoScanStore } from '../../../stores/photoScanStore';

// --- Mocks ---

jest.mock('expo-media-library', () => ({
  getPermissionsAsync: jest.fn(),
}));

jest.mock('@stores/onboardingStore', () => {
  const state = { homeCountry: 'US' as string | null };
  const useOnboardingStore = Object.assign(() => state, {
    getState: () => state,
    persist: { hasHydrated: () => true },
    __setState: (next: { homeCountry: string | null }) => Object.assign(state, next),
  });
  return { useOnboardingStore };
});

jest.mock('@stores/subscriptionStore', () => {
  const state = {
    status: 'premium' as 'premium' | 'trial' | 'free' | 'loading',
    photoImportUsage: 0,
  };
  const useSubscriptionStore = Object.assign(() => state, {
    getState: () => state,
    __setState: (next: Partial<typeof state>) => Object.assign(state, next),
  });
  return {
    FREE_LIMITS: { shareExtension: 5, photoImport: 1, entriesPerTrip: 10 },
    useSubscriptionStore,
  };
});

jest.mock('../../../services/photoImport/photoScanService', () => ({
  isScanRunning: jest.fn(() => false),
  readScanInProgressMetadata: jest.fn(),
  clearScanInProgressMetadata: jest.fn().mockResolvedValue(undefined),
  markFailed: jest.fn(),
  startScan: jest.fn(),
  getLastProgressAt: jest.fn(() => 0),
}));

const photoScanServiceMock = jest.requireMock('../../../services/photoImport/photoScanService');
const MediaLibrary = jest.requireMock('expo-media-library');

beforeEach(() => {
  jest.clearAllMocks();
  resetPhotoScanStore();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useOnboardingStore } = require('@stores/onboardingStore');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useSubscriptionStore } = require('@stores/subscriptionStore');
  useOnboardingStore.__setState({ homeCountry: 'US' });
  useOnboardingStore.persist.hasHydrated = () => true;
  useSubscriptionStore.__setState({ status: 'premium', photoImportUsage: 0 });
  photoScanServiceMock.isScanRunning.mockReturnValue(false);
  photoScanServiceMock.startScan.mockResolvedValue({ status: 'started' });
  MediaLibrary.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
});

describe('tryResumeScan gates', () => {
  it('skips with no-flag when scan_in_progress is false', async () => {
    photoScanServiceMock.readScanInProgressMetadata.mockResolvedValue({
      inProgress: false,
      startedAt: null,
    });

    const result = await tryResumeScan();
    expect(result).toEqual({ status: 'skipped', reason: 'no-flag' });
    expect(photoScanServiceMock.startScan).not.toHaveBeenCalled();
  });

  it('happy path: starts a resumed scan when all gates pass', async () => {
    photoScanServiceMock.readScanInProgressMetadata.mockResolvedValue({
      inProgress: true,
      startedAt: Date.now() - 5 * 60 * 1000,
    });

    const result = await tryResumeScan();
    expect(result).toEqual({ status: 'started' });
    expect(photoScanServiceMock.startScan).toHaveBeenCalledWith({
      homeCountry: 'US',
      resumed: true,
    });
  });

  it('gate 3 (stale): clears flag and surfaces stale failure when started_at is too old', async () => {
    photoScanServiceMock.readScanInProgressMetadata.mockResolvedValue({
      inProgress: true,
      startedAt: Date.now() - RESUME_STALENESS_MS - 1000,
    });

    const result = await tryResumeScan();
    expect(result).toEqual({ status: 'failed-gate', reason: 'stale' });
    expect(photoScanServiceMock.clearScanInProgressMetadata).toHaveBeenCalled();
    expect(photoScanServiceMock.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'stale' })
    );
  });

  it('gate 4 (permission): clears flag and surfaces no-permission when permission is denied', async () => {
    photoScanServiceMock.readScanInProgressMetadata.mockResolvedValue({
      inProgress: true,
      startedAt: Date.now() - 1000,
    });
    MediaLibrary.getPermissionsAsync.mockResolvedValue({ status: 'denied' });

    const result = await tryResumeScan();
    expect(result).toEqual({ status: 'failed-gate', reason: 'no-permission' });
    expect(photoScanServiceMock.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'no-permission' })
    );
  });

  it('gate 5a (no home country, not hydrated): defers without clearing flag', async () => {
    photoScanServiceMock.readScanInProgressMetadata.mockResolvedValue({
      inProgress: true,
      startedAt: Date.now() - 1000,
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const onboarding = jest.requireMock('@stores/onboardingStore');
    onboarding.useOnboardingStore.__setState({ homeCountry: null });
    onboarding.useOnboardingStore.persist.hasHydrated = () => false;

    const result = await tryResumeScan();
    expect(result).toEqual({ status: 'skipped', reason: 'deferred' });
    expect(photoScanServiceMock.clearScanInProgressMetadata).not.toHaveBeenCalled();
    expect(photoScanServiceMock.markFailed).not.toHaveBeenCalled();

    // Reset hydrated for subsequent tests
    onboarding.useOnboardingStore.persist.hasHydrated = () => true;
  });

  it('gate 5b (no home country, hydrated): clears flag and surfaces home-country failure', async () => {
    photoScanServiceMock.readScanInProgressMetadata.mockResolvedValue({
      inProgress: true,
      startedAt: Date.now() - 1000,
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    jest
      .requireMock('@stores/onboardingStore')
      .useOnboardingStore.__setState({ homeCountry: null });

    const result = await tryResumeScan();
    expect(result).toEqual({ status: 'failed-gate', reason: 'no-home-country' });
    expect(photoScanServiceMock.clearScanInProgressMetadata).toHaveBeenCalled();
    expect(photoScanServiceMock.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'home-country' })
    );
  });

  it('gate 6 (subscription): clears flag and surfaces subscription-expired when not premium and free limit reached', async () => {
    photoScanServiceMock.readScanInProgressMetadata.mockResolvedValue({
      inProgress: true,
      startedAt: Date.now() - 1000,
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    jest.requireMock('@stores/subscriptionStore').useSubscriptionStore.__setState({
      status: 'free',
      photoImportUsage: 5,
    });

    const result = await tryResumeScan();
    expect(result).toEqual({ status: 'failed-gate', reason: 'subscription-expired' });
    expect(photoScanServiceMock.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'subscription-expired' })
    );
  });

  it('gate 7 (already running): skips with already-running reason', async () => {
    photoScanServiceMock.isScanRunning.mockReturnValue(true);

    const result = await tryResumeScan();
    expect(result).toEqual({ status: 'skipped', reason: 'already-running' });
    expect(photoScanServiceMock.readScanInProgressMetadata).not.toHaveBeenCalled();
  });
});

describe('detectStuckScan', () => {
  it('returns false when not scanning', () => {
    usePhotoScanStore.setState({ phase: 'idle' });
    expect(detectStuckScan()).toBe(false);
    expect(photoScanServiceMock.markFailed).not.toHaveBeenCalled();
  });

  it('returns false when scanning but no progress yet emitted (lastProgressAt=0)', () => {
    usePhotoScanStore.setState({ phase: 'scanning' });
    photoScanServiceMock.getLastProgressAt.mockReturnValue(0);
    expect(detectStuckScan()).toBe(false);
    expect(photoScanServiceMock.markFailed).not.toHaveBeenCalled();
  });

  it('returns false when last progress is recent', () => {
    usePhotoScanStore.setState({ phase: 'scanning' });
    photoScanServiceMock.getLastProgressAt.mockReturnValue(Date.now() - 1000);
    expect(detectStuckScan()).toBe(false);
    expect(photoScanServiceMock.markFailed).not.toHaveBeenCalled();
  });

  it('returns true and marks failed when last progress is older than threshold', () => {
    usePhotoScanStore.setState({ phase: 'scanning' });
    photoScanServiceMock.getLastProgressAt.mockReturnValue(
      Date.now() - STUCK_SCAN_THRESHOLD_MS - 1000
    );
    expect(detectStuckScan()).toBe(true);
    expect(photoScanServiceMock.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'stuck' })
    );
  });
});
