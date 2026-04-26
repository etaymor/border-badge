import { renderHook } from '@testing-library/react-native';

import {
  useScanLifecycle,
  type UseScanLifecycleOptions,
} from '../../../screens/photos/useScanLifecycle';

// expo-keep-awake is used by useScanLifecycle
jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn().mockResolvedValue(undefined),
  deactivateKeepAwake: jest.fn(),
}));

let mockIsFocused = true;
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockIsFocused,
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
    global.__mockAlert.alert.mockReset();
    mockIsFocused = true;
  });

  describe('scan failure alert', () => {
    it('navigates back when phase is idle at dismiss time and autoStart is true', () => {
      const navigation = createMockNavigation();
      const clearScanFailure = jest.fn();

      const { rerender } = renderHook((props: UseScanLifecycleOptions) => useScanLifecycle(props), {
        initialProps: {
          phase: 'idle',
          cancelScan: jest.fn(),
          scanFailure: null as { title: string; message: string } | null,
          clearScanFailure,
          autoStart: true as boolean | undefined,
          navigation,
        },
      });

      rerender({
        phase: 'idle',
        cancelScan: jest.fn(),
        scanFailure: { title: 'No Photos Found', message: 'No photos with location data' },
        clearScanFailure,
        autoStart: true,
        navigation,
      });

      expect(global.__mockAlert.alert).toHaveBeenCalledTimes(1);

      const okButton = global.__mockAlert.alert.mock.calls[0][2][0];
      okButton.onPress();

      expect(clearScanFailure).toHaveBeenCalled();
      expect(navigation.goBack).toHaveBeenCalled();
    });

    it('does not navigate back when autoStart is false', () => {
      const navigation = createMockNavigation();
      const clearScanFailure = jest.fn();

      const { rerender } = renderHook((props: UseScanLifecycleOptions) => useScanLifecycle(props), {
        initialProps: {
          phase: 'idle',
          cancelScan: jest.fn(),
          scanFailure: null as { title: string; message: string } | null,
          clearScanFailure,
          autoStart: false as boolean | undefined,
          navigation,
        },
      });

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

  describe('unmount behavior', () => {
    it('does NOT cancel the scan when component unmounts during scanning (regression)', () => {
      // Old behavior was to call cancelScan on unmount. The scan now lives in
      // a singleton service and survives navigation; cancellation is only
      // triggered by explicit user action.
      const navigation = createMockNavigation();
      const cancelScan = jest.fn();

      const { unmount } = renderHook((props: UseScanLifecycleOptions) => useScanLifecycle(props), {
        initialProps: {
          phase: 'scanning',
          cancelScan,
          scanFailure: null as { title: string; message: string } | null,
          clearScanFailure: jest.fn(),
          autoStart: false as boolean | undefined,
          navigation,
        },
      });

      unmount();

      expect(cancelScan).not.toHaveBeenCalled();
    });

    it('does not cancel scan when component unmounts while not scanning', () => {
      const navigation = createMockNavigation();
      const cancelScan = jest.fn();

      const { unmount } = renderHook((props: UseScanLifecycleOptions) => useScanLifecycle(props), {
        initialProps: {
          phase: 'candidates',
          cancelScan,
          scanFailure: null as { title: string; message: string } | null,
          clearScanFailure: jest.fn(),
          autoStart: false as boolean | undefined,
          navigation,
        },
      });

      unmount();

      expect(cancelScan).not.toHaveBeenCalled();
    });
  });

  describe('keep-awake gating on focus', () => {
    it('activates keep-awake when scanning and focused', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const KeepAwake = require('expo-keep-awake');
      mockIsFocused = true;

      renderHook((props: UseScanLifecycleOptions) => useScanLifecycle(props), {
        initialProps: {
          phase: 'scanning',
          cancelScan: jest.fn(),
          scanFailure: null as { title: string; message: string } | null,
          clearScanFailure: jest.fn(),
          autoStart: false as boolean | undefined,
          navigation: createMockNavigation(),
        },
      });

      expect(KeepAwake.activateKeepAwakeAsync).toHaveBeenCalledWith('photo-scan');
    });

    it('does not activate keep-awake when scanning but not focused (background nav)', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const KeepAwake = require('expo-keep-awake');
      mockIsFocused = false;

      renderHook((props: UseScanLifecycleOptions) => useScanLifecycle(props), {
        initialProps: {
          phase: 'scanning',
          cancelScan: jest.fn(),
          scanFailure: null as { title: string; message: string } | null,
          clearScanFailure: jest.fn(),
          autoStart: false as boolean | undefined,
          navigation: createMockNavigation(),
        },
      });

      expect(KeepAwake.activateKeepAwakeAsync).not.toHaveBeenCalled();
      expect(KeepAwake.deactivateKeepAwake).toHaveBeenCalledWith('photo-scan');
    });
  });

  describe('beforeRemove navigation guard', () => {
    it('shows the soft-block alert with Continue in Background and Cancel Scan options', () => {
      const navigation = createMockNavigation();
      renderHook((props: UseScanLifecycleOptions) => useScanLifecycle(props), {
        initialProps: {
          phase: 'scanning',
          cancelScan: jest.fn(),
          scanFailure: null as { title: string; message: string } | null,
          clearScanFailure: jest.fn(),
          autoStart: false as boolean | undefined,
          navigation,
        },
      });

      const beforeRemove = (
        navigation as unknown as { _listeners: Record<string, (e: unknown) => void> }
      )._listeners.beforeRemove;
      const event = { preventDefault: jest.fn(), data: { action: { type: 'POP' } } };
      beforeRemove(event);

      expect(event.preventDefault).toHaveBeenCalled();
      const buttons = global.__mockAlert.alert.mock.calls[0][2];
      const labels = buttons.map((b: { text: string }) => b.text);
      expect(labels).toEqual(['Keep Scanning', 'Continue in Background', 'Cancel Scan']);
    });

    it('Continue in Background dispatches navigation without calling cancel', () => {
      const navigation = createMockNavigation();
      const cancelScan = jest.fn();
      renderHook((props: UseScanLifecycleOptions) => useScanLifecycle(props), {
        initialProps: {
          phase: 'scanning',
          cancelScan,
          scanFailure: null as { title: string; message: string } | null,
          clearScanFailure: jest.fn(),
          autoStart: false as boolean | undefined,
          navigation,
        },
      });

      const beforeRemove = (
        navigation as unknown as { _listeners: Record<string, (e: unknown) => void> }
      )._listeners.beforeRemove;
      const event = { preventDefault: jest.fn(), data: { action: { type: 'POP' } } };
      beforeRemove(event);

      const continueBtn = global.__mockAlert.alert.mock.calls[0][2][1];
      continueBtn.onPress();

      expect(navigation.dispatch).toHaveBeenCalledWith({ type: 'POP' });
      expect(cancelScan).not.toHaveBeenCalled();
    });

    it('does not block navigation when not scanning', () => {
      const navigation = createMockNavigation();
      renderHook((props: UseScanLifecycleOptions) => useScanLifecycle(props), {
        initialProps: {
          phase: 'idle',
          cancelScan: jest.fn(),
          scanFailure: null as { title: string; message: string } | null,
          clearScanFailure: jest.fn(),
          autoStart: false as boolean | undefined,
          navigation,
        },
      });

      const beforeRemove = (
        navigation as unknown as { _listeners: Record<string, (e: unknown) => void> }
      )._listeners.beforeRemove;
      const event = { preventDefault: jest.fn(), data: { action: { type: 'POP' } } };
      beforeRemove(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(global.__mockAlert.alert).not.toHaveBeenCalled();
    });
  });
});
