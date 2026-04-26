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
  cancelScan: jest.fn(),
  detectStuckScan: jest.fn(),
  performBackgroundPhotoSync: jest.fn().mockResolvedValue(null),
  tryResumeScan: jest.fn().mockResolvedValue({ status: 'skipped', reason: 'no-flag' }),
}));

const photoImportMock = jest.requireMock('@services/photoImport');

beforeEach(() => {
  jest.clearAllMocks();
  appStateListeners.length = 0;
  resetPhotoScanStore();
});

function makeSession(userId: string) {
  return { user: { id: userId } } as unknown as import('@supabase/supabase-js').Session;
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
  it('calls tryResumeScan and detectStuckScan on foreground when authenticated', () => {
    renderHook(() => useAppStateTracking(makeSession('user-1'), jest.fn(), 'US'));

    fireForeground();

    expect(photoImportMock.tryResumeScan).toHaveBeenCalled();
    expect(photoImportMock.detectStuckScan).toHaveBeenCalled();
    expect(photoImportMock.performBackgroundPhotoSync).toHaveBeenCalledWith('US');
  });

  it('does not call tryResumeScan when unauthenticated', () => {
    renderHook(() => useAppStateTracking(null, jest.fn(), 'US'));

    fireForeground();

    expect(photoImportMock.tryResumeScan).not.toHaveBeenCalled();
    expect(photoImportMock.performBackgroundPhotoSync).not.toHaveBeenCalled();
  });
});

describe('useAppStateTracking auth-state cancel', () => {
  it('cancels an in-flight scan when user signs out (session goes from non-null to null)', () => {
    usePhotoScanStore.setState({ phase: 'scanning' });
    const { rerender } = renderHook(
      ({ session }: { session: ReturnType<typeof makeSession> | null }) =>
        useAppStateTracking(session, jest.fn(), 'US'),
      { initialProps: { session: makeSession('user-1') as ReturnType<typeof makeSession> | null } }
    );

    rerender({ session: null });
    expect(photoImportMock.cancelScan).toHaveBeenCalled();
  });

  it('does not cancel when there is no in-flight scan', () => {
    usePhotoScanStore.setState({ phase: 'idle' });
    const { rerender } = renderHook(
      ({ session }: { session: ReturnType<typeof makeSession> | null }) =>
        useAppStateTracking(session, jest.fn(), 'US'),
      { initialProps: { session: makeSession('user-1') as ReturnType<typeof makeSession> | null } }
    );

    rerender({ session: null });
    expect(photoImportMock.cancelScan).not.toHaveBeenCalled();
  });
});
