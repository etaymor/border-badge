/**
 * Focused tests for useAppStateTracking foreground-resume + auth cancel hooks.
 */

import { renderHook } from '@testing-library/react-native';

import { useAppStateTracking } from '../../hooks/useAppStateTracking';
import { resetPhotoScanStore, usePhotoScanStore } from '../../stores/photoScanStore';

// --- Mocks ---

const appStateListeners: Array<(s: string) => void> = [];
const mockSubscriptionRemove = jest.fn();

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn((event: string, cb: (s: string) => void) => {
      appStateListeners.push(cb);
      return { remove: mockSubscriptionRemove };
    }),
  },
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'mock-uuid'),
}));

jest.mock('@services/analytics', () => ({
  Analytics: {
    appOpened: jest.fn(),
  },
}));

jest.mock('@services/shareExtensionBridge', () => ({
  syncOfflineQueueFromExtension: jest.fn().mockResolvedValue(undefined),
  syncShareExtensionUsageFromAppGroup: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@services/shareExtensionAnalytics', () => ({
  syncAnalyticsFromExtension: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@services/photoImport', () => ({
  resetForUserChange: jest.fn().mockResolvedValue(undefined),
  detectStuckScan: jest.fn(),
  performBackgroundPhotoSync: jest.fn().mockResolvedValue(null),
  tryResumeScan: jest.fn().mockResolvedValue({ status: 'skipped', reason: 'no-flag' }),
}));

// The controller is mocked rather than imported: this suite replaces the whole
// `react-native` module with a two-property AppState stub, so pulling in the
// real dispatch module (and the api client behind it) would drag in far more of
// React Native than the stub provides.
jest.mock('@services/photoImport/suggestionDispatch', () => ({
  suggestionDispatch: { pause: jest.fn(), resume: jest.fn() },
}));

const photoImportMock = jest.requireMock('@services/photoImport');
const { suggestionDispatch: dispatchMock } = jest.requireMock(
  '@services/photoImport/suggestionDispatch'
);

beforeEach(() => {
  jest.clearAllMocks();
  appStateListeners.length = 0;
  resetPhotoScanStore();
});

function makeSession(userId: string) {
  return { user: { id: userId } } as unknown as import('@supabase/supabase-js').Session;
}

/**
 * Flush the staggered foreground burst. Foreground jobs are now spread across
 * successive animation frames (scheduleStaggered) so a single resume doesn't
 * spike one frame; drain enough frames to let every job run.
 */
async function flushStagger() {
  for (let i = 0; i < 20; i++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

function fireForeground() {
  // Match the pattern: previous state inactive/background → active.
  // The hook reads appStateRef.current; we have to first send a background
  // event, then send active to trigger the foreground path.
  const cb = appStateListeners[0];
  cb('background');
  cb('active');
}

describe('useAppStateTracking foreground resume', () => {
  it('calls tryResumeScan and detectStuckScan on foreground when authenticated', async () => {
    renderHook(() => useAppStateTracking(makeSession('user-1'), jest.fn(), 'US'));

    fireForeground();
    await flushStagger();

    expect(photoImportMock.tryResumeScan).toHaveBeenCalled();
    expect(photoImportMock.detectStuckScan).toHaveBeenCalled();
    expect(photoImportMock.performBackgroundPhotoSync).toHaveBeenCalledWith('US');
  });

  it('does not call tryResumeScan when unauthenticated', async () => {
    renderHook(() => useAppStateTracking(null, jest.fn(), 'US'));

    fireForeground();
    await flushStagger();

    expect(photoImportMock.tryResumeScan).not.toHaveBeenCalled();
    expect(photoImportMock.performBackgroundPhotoSync).not.toHaveBeenCalled();
  });
});

describe('useAppStateTracking suggestion-dispatch lifecycle (U9/R15/KTD19)', () => {
  it('pauses dispatch when the app backgrounds, without aborting it', () => {
    renderHook(() => useAppStateTracking(makeSession('user-1'), jest.fn(), 'US'));

    appStateListeners[0]('background');

    // pause(), never reset(): batches already on the wire must be allowed to
    // land and cache.
    expect(dispatchMock.pause).toHaveBeenCalledTimes(1);
  });

  it('does not pause on a transient inactive (control centre, app switcher)', () => {
    renderHook(() => useAppStateTracking(makeSession('user-1'), jest.fn(), 'US'));

    appStateListeners[0]('inactive');

    expect(dispatchMock.pause).not.toHaveBeenCalled();
  });

  it('resumes through the staggered foreground burst, not in the event frame', async () => {
    renderHook(() => useAppStateTracking(makeSession('user-1'), jest.fn(), 'US'));

    fireForeground();
    // KTD19: resume rides the app-root hook's frame stagger, so returning to the
    // app does not run resume plus every sync job on one frame.
    expect(dispatchMock.resume).not.toHaveBeenCalled();

    await flushStagger();
    expect(dispatchMock.resume).toHaveBeenCalledTimes(1);
  });

  it('resumes even when unauthenticated, so a signed-out blip cannot strand a pause', async () => {
    renderHook(() => useAppStateTracking(null, jest.fn(), 'US'));

    fireForeground();
    await flushStagger();

    expect(dispatchMock.resume).toHaveBeenCalledTimes(1);
  });
});

describe('useAppStateTracking auth-state reset', () => {
  it('resets scan state when user signs out (session goes from non-null to null)', () => {
    usePhotoScanStore.setState({ phase: 'scanning' });
    const { rerender } = renderHook(
      ({ session }: { session: ReturnType<typeof makeSession> | null }) =>
        useAppStateTracking(session, jest.fn(), 'US'),
      { initialProps: { session: makeSession('user-1') as ReturnType<typeof makeSession> | null } }
    );

    rerender({ session: null });
    // resetForUserChange runs unconditionally on user change so that user A's
    // result Map cannot leak to user B even if no scan was in flight.
    expect(photoImportMock.resetForUserChange).toHaveBeenCalled();
  });

  it('still resets when there is no in-flight scan (defensive)', () => {
    usePhotoScanStore.setState({ phase: 'idle' });
    const { rerender } = renderHook(
      ({ session }: { session: ReturnType<typeof makeSession> | null }) =>
        useAppStateTracking(session, jest.fn(), 'US'),
      { initialProps: { session: makeSession('user-1') as ReturnType<typeof makeSession> | null } }
    );

    rerender({ session: null });
    expect(photoImportMock.resetForUserChange).toHaveBeenCalled();
  });
});
