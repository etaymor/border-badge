import { renderHook } from '@testing-library/react-native';

import { useScanLifecycle } from '../../../screens/photos/useScanLifecycle';

// expo-keep-awake is used by useScanLifecycle
jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn().mockResolvedValue(undefined),
  deactivateKeepAwake: jest.fn(),
}));

describe('useScanLifecycle', () => {
  const createMockNavigation = () => {
    const listeners: Record<string, (e: unknown) => void> = {};
    return {
      goBack: jest.fn(),
      dispatch: jest.fn(),
      addListener: jest.fn((event: string, callback: (e: unknown) => void) => {
        listeners[event] = callback;
        return jest.fn(); // unsubscribe
      }),
      _listeners: listeners,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset Alert mock between tests
    global.__mockAlert.alert.mockReset();
  });

  describe('scan failure alert - TOCTOU race condition', () => {
    it('navigates back when phase is idle at dismiss time', () => {
      const navigation = createMockNavigation();
      const clearScanFailure = jest.fn();

      const { rerender } = renderHook(
        (props) => useScanLifecycle(props),
        {
          initialProps: {
            phase: 'idle',
            cancelScan: jest.fn(),
            scanFailure: null as { title: string; message: string } | null,
            clearScanFailure,
            autoStart: true as boolean | undefined,
            navigation,
          },
        }
      );

      // Scan fails, scanFailure is set while phase is idle
      rerender({
        phase: 'idle',
        cancelScan: jest.fn(),
        scanFailure: { title: 'No Photos Found', message: 'No photos with location data' },
        clearScanFailure,
        autoStart: true,
        navigation,
      });

      // Alert should have been shown
      expect(global.__mockAlert.alert).toHaveBeenCalledTimes(1);

      // Simulate pressing OK on the alert
      const okButton = global.__mockAlert.alert.mock.calls[0][2][0];
      okButton.onPress();

      expect(clearScanFailure).toHaveBeenCalled();
      expect(navigation.goBack).toHaveBeenCalled();
    });

    it('navigates back even when phase changes between alert show and dismiss', () => {
      // Regression test for TOCTOU race condition:
      // 1. Scan fails → phase=idle, scanFailure set, alert shown
      // 2. User starts another scan → phase=scanning
      // 3. User presses OK on stale alert
      // Phase was 'idle' when the alert was shown, so navigation should proceed.

      const navigation = createMockNavigation();
      const clearScanFailure = jest.fn();

      const { rerender } = renderHook(
        (props) => useScanLifecycle(props),
        {
          initialProps: {
            phase: 'idle',
            cancelScan: jest.fn(),
            scanFailure: null as { title: string; message: string } | null,
            clearScanFailure,
            autoStart: true as boolean | undefined,
            navigation,
          },
        }
      );

      // Step 1: Scan fails with no-photos, phase = idle, scanFailure set
      rerender({
        phase: 'idle',
        cancelScan: jest.fn(),
        scanFailure: { title: 'No Photos Found', message: 'No photos with location data' },
        clearScanFailure,
        autoStart: true,
        navigation,
      });

      expect(global.__mockAlert.alert).toHaveBeenCalledTimes(1);

      // Step 2: User manually triggers another scan, phase changes to scanning
      // (alert is still visible but user hasn't pressed OK yet)
      rerender({
        phase: 'scanning',
        cancelScan: jest.fn(),
        scanFailure: { title: 'No Photos Found', message: 'No photos with location data' },
        clearScanFailure,
        autoStart: true,
        navigation,
      });

      // Step 3: User presses OK on the stale alert
      const okButton = global.__mockAlert.alert.mock.calls[0][2][0];
      okButton.onPress();

      // Phase was 'idle' when the alert was shown, so goBack should be called
      // even though phaseRef.current is now 'scanning'
      expect(clearScanFailure).toHaveBeenCalled();
      expect(navigation.goBack).toHaveBeenCalled();
    });
  });

  describe('scan failure alert - non-autoStart', () => {
    it('does not navigate back when autoStart is false', () => {
      const navigation = createMockNavigation();
      const clearScanFailure = jest.fn();

      const { rerender } = renderHook(
        (props) => useScanLifecycle(props),
        {
          initialProps: {
            phase: 'idle',
            cancelScan: jest.fn(),
            scanFailure: null as { title: string; message: string } | null,
            clearScanFailure,
            autoStart: false as boolean | undefined,
            navigation,
          },
        }
      );

      rerender({
        phase: 'idle',
        cancelScan: jest.fn(),
        scanFailure: { title: 'No Photos Found', message: 'No photos' },
        clearScanFailure,
        autoStart: false,
        navigation,
      });

      const okButton = global.__mockAlert.alert.mock.calls[0][2][0];
      okButton.onPress();

      expect(clearScanFailure).toHaveBeenCalled();
      expect(navigation.goBack).not.toHaveBeenCalled();
    });
  });
});
