/**
 * Focused tests for useAppStateTracking foreground-resume + auth cancel hooks.
 */

import { renderHook } from '@testing-library/react-native';

import { useAppStateTracking } from '../../hooks/useAppStateTracking';
import { patchJobSlice, resetLibraryJobStore } from '../../stores/libraryJobStore';

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
  performBackgroundPhotoSync: jest.fn().mockResolvedValue(null),
}));

// Same reasoning for the job runtime barrel: it reaches subscriptionStore and
// its App Group bridge, which the two-property AppState stub cannot satisfy.
jest.mock('@services/jobs', () => ({
  tryResumeJobs: jest.fn().mockResolvedValue({}),
  detectStuckJobs: jest.fn(() => []),
  resetAllForUserChange: jest.fn().mockResolvedValue(undefined),
}));

// The controller is mocked rather than imported: this suite replaces the whole
// `react-native` module with a two-property AppState stub, so pulling in the
// real dispatch module (and the api client behind it) would drag in far more of
// React Native than the stub provides.
jest.mock('@services/photoImport/suggestionDispatch', () => ({
  suggestionDispatch: { pause: jest.fn(), resume: jest.fn() },
}));

const photoImportMock = jest.requireMock('@services/photoImport');
const jobsMock = jest.requireMock('@services/jobs');
const { suggestionDispatch: dispatchMock } = jest.requireMock(
  '@services/photoImport/suggestionDispatch'
);

beforeEach(() => {
  jest.clearAllMocks();
  appStateListeners.length = 0;
  resetLibraryJobStore();
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
  it('resumes every library job and runs stuck detection when authenticated', async () => {
    renderHook(() => useAppStateTracking(makeSession('user-1'), jest.fn(), 'US'));

    fireForeground();
    await flushStagger();

    // One entry covers the trip scan and the quiz build: the scan lost its
    // separate resume path when it moved onto the runtime.
    expect(jobsMock.tryResumeJobs).toHaveBeenCalledTimes(1);
    expect(jobsMock.detectStuckJobs).toHaveBeenCalledTimes(1);
    expect(photoImportMock.performBackgroundPhotoSync).toHaveBeenCalledWith('US');
  });

  it('does not resume jobs when unauthenticated', async () => {
    renderHook(() => useAppStateTracking(null, jest.fn(), 'US'));

    fireForeground();
    await flushStagger();

    expect(jobsMock.tryResumeJobs).not.toHaveBeenCalled();
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

  it('resumes SYNCHRONOUSLY in the foreground event, not from the staggered burst', async () => {
    renderHook(() => useAppStateTracking(makeSession('user-1'), jest.fn(), 'US'));

    fireForeground();
    // `pause()` is synchronous and this is its only release. Deferring it by a
    // frame put it inside a cancellable burst; it is a flag flip, so it costs
    // nothing to run here and cannot be lost.
    expect(dispatchMock.resume).toHaveBeenCalledTimes(1);

    // ...and it is not ALSO queued in the burst, which would double-resume.
    await flushStagger();
    expect(dispatchMock.resume).toHaveBeenCalledTimes(1);
  });

  it('resumes even when the burst is cancelled before its first frame', () => {
    // The burst is cancelled wholesale by `cancelStaggerRef.current?.()`, which
    // runs from the effect cleanup AND from the top of the next foreground
    // event; the effect's deps change on foreground (Supabase refreshes the
    // session then), so losing the burst before frame 0 is reachable. As job 0,
    // resume died with it — and a stranded pause is permanent: workers stay
    // parked, `dispatch()` never settles, the owner bracket never releases, and
    // every remaining cluster is a pending row with no way out.
    const { unmount } = renderHook(() =>
      useAppStateTracking(makeSession('user-1'), jest.fn(), 'US')
    );

    const cb = appStateListeners[0];
    cb('background');
    cb('active');
    // Unmount before any animation frame runs: the cleanup cancels the burst.
    unmount();

    expect(dispatchMock.pause).toHaveBeenCalledTimes(1);
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
    patchJobSlice('trip-scan', { phase: 'running' });
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
    patchJobSlice('trip-scan', { phase: 'idle' });
    const { rerender } = renderHook(
      ({ session }: { session: ReturnType<typeof makeSession> | null }) =>
        useAppStateTracking(session, jest.fn(), 'US'),
      { initialProps: { session: makeSession('user-1') as ReturnType<typeof makeSession> | null } }
    );

    rerender({ session: null });
    expect(photoImportMock.resetForUserChange).toHaveBeenCalled();
  });
});
