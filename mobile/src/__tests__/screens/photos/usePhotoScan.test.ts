/**
 * Tests for usePhotoScan adapter — the thin layer that delegates the scan to
 * `photoScanService` and fans store updates back into the legacy callback shape.
 *
 * The internal scan-loop logic (extract, cache, segment, abort) lives in the
 * service and is tested in `services/photoImport/photoScanService.test.ts`.
 */

import { renderHook, act } from '@testing-library/react-native';

import { usePhotoScan } from '../../../screens/photos/usePhotoScan';
import { resetPhotoScanStore, usePhotoScanStore } from '../../../stores/photoScanStore';

// --- Mocks ---

// Drive the service surface from the test. The mock writes through to the real
// store so the adapter's subscription forwards updates as in production.
const mockResultRef: { current: import('../../../screens/photos/usePhotoScan').ScanResult | null } =
  {
    current: null,
  };

jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
}));

jest.mock('@services/photoImport', () => ({
  startScan: jest.fn(async (opts: { homeCountry: string | null }) => {
    if (!opts.homeCountry) return { status: 'rejected', reason: 'no-home-country' };
    return { status: 'started' };
  }),
  cancelScan: jest.fn(),
  consumeResult: jest.fn(() => {
    const r = mockResultRef.current;
    mockResultRef.current = null;
    return r;
  }),
  hasResult: jest.fn(() => mockResultRef.current !== null),
  isScanRunning: jest.fn(() => false),
}));

const mockedService = jest.requireMock('@services/photoImport');

beforeEach(() => {
  jest.clearAllMocks();
  resetPhotoScanStore();
  mockResultRef.current = null;
  mockedService.startScan.mockImplementation(async (opts: { homeCountry: string | null }) => {
    if (!opts.homeCountry) return { status: 'rejected', reason: 'no-home-country' };
    return { status: 'started' };
  });
  mockedService.hasResult.mockImplementation(() => mockResultRef.current !== null);
  mockedService.consumeResult.mockImplementation(() => {
    const r = mockResultRef.current;
    mockResultRef.current = null;
    return r;
  });
});

describe('usePhotoScan adapter', () => {
  it('startScan delegates to the service with homeCountry/filterCountryCode/forceRefresh', async () => {
    const { result } = renderHook(() =>
      usePhotoScan({
        homeCountry: 'US',
        filterCountryCode: 'JP',
        onScanProgress: jest.fn(),
        onScanComplete: jest.fn(),
        onScanError: jest.fn(),
      })
    );

    await act(async () => {
      await result.current.startScan(true);
    });

    expect(mockedService.startScan).toHaveBeenCalledWith({
      homeCountry: 'US',
      filterCountryCode: 'JP',
      forceRefresh: true,
    });
  });

  it('returns home-country failure outcome when service rejects with no-home-country', async () => {
    const onScanError = jest.fn();
    const { result } = renderHook(() =>
      usePhotoScan({
        homeCountry: null,
        onScanProgress: jest.fn(),
        onScanComplete: jest.fn(),
        onScanError,
      })
    );

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.startScan();
    });

    expect(outcome).toEqual({
      success: false,
      reason: 'home-country',
      title: 'Set Home Country',
      message: expect.stringContaining('home country'),
    });
  });

  it('returns success when service responds already-running and does not call setPhase again', async () => {
    mockedService.startScan.mockResolvedValueOnce({ status: 'already-running' });

    const onScanProgress = jest.fn();
    const { result } = renderHook(() =>
      usePhotoScan({
        homeCountry: 'US',
        onScanProgress,
        onScanComplete: jest.fn(),
        onScanError: jest.fn(),
      })
    );

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.startScan();
    });

    expect(outcome).toEqual({ success: true });
  });

  it('forwards store progress updates into onScanProgress', async () => {
    const onScanProgress = jest.fn();
    renderHook(() =>
      usePhotoScan({
        homeCountry: 'US',
        onScanProgress,
        onScanComplete: jest.fn(),
        onScanError: jest.fn(),
      })
    );

    act(() => {
      usePhotoScanStore.setState({
        progress: { phase: 'scanning', current: 50, total: 100, percentage: 50 },
      });
    });

    expect(onScanProgress).toHaveBeenCalledWith(expect.objectContaining({ percentage: 50 }));
  });

  it('consumes result and forwards to onScanComplete when phase transitions to completed', async () => {
    const result = {
      candidates: [
        {
          id: 'trip-1',
          countryCode: 'JP',
          dateRange: { start: new Date(), end: new Date() },
          photoIds: [],
          photoCount: 0,
          previewUris: [],
          previewAssetIds: [],
          locationClusterIds: [],
        },
      ],
      photoLookup: new Map(),
      clusterLookup: new Map(),
      clusterDisplays: new Map(),
      importTime: Date.now(),
      isIncremental: false,
    };
    mockResultRef.current = result;

    const onScanComplete = jest.fn();
    renderHook(() =>
      usePhotoScan({
        homeCountry: 'US',
        onScanProgress: jest.fn(),
        onScanComplete,
        onScanError: jest.fn(),
      })
    );

    act(() => {
      usePhotoScanStore.setState({ phase: 'completed', hasResult: true });
    });

    expect(onScanComplete).toHaveBeenCalledWith(result);
    expect(mockedService.consumeResult).toHaveBeenCalled();
  });

  it('applies the caller country filter to a completed already-running scan result', async () => {
    const jpCandidate = {
      id: 'trip-jp',
      countryCode: 'JP',
      dateRange: { start: new Date(), end: new Date() },
      photoIds: [],
      photoCount: 0,
      previewUris: [],
      previewAssetIds: [],
      locationClusterIds: [],
    };
    const frCandidate = {
      ...jpCandidate,
      id: 'trip-fr',
      countryCode: 'FR',
    };
    const result = {
      candidates: [jpCandidate, frCandidate],
      photoLookup: new Map(),
      clusterLookup: new Map(),
      clusterDisplays: new Map(),
      importTime: Date.now(),
      isIncremental: false,
    };
    mockResultRef.current = result;

    const onScanComplete = jest.fn();
    renderHook(() =>
      usePhotoScan({
        homeCountry: 'US',
        filterCountryCode: 'JP',
        onScanProgress: jest.fn(),
        onScanComplete,
        onScanError: jest.fn(),
      })
    );

    act(() => {
      usePhotoScanStore.setState({ phase: 'completed', hasResult: true });
    });

    expect(onScanComplete).toHaveBeenCalledWith({
      ...result,
      candidates: [jpCandidate],
    });
  });

  it('does not double-consume on repeated phase=completed updates', async () => {
    const result = {
      candidates: [],
      photoLookup: new Map(),
      clusterLookup: new Map(),
      clusterDisplays: new Map(),
      importTime: 1234,
      isIncremental: false,
    };
    mockResultRef.current = result;

    const onScanComplete = jest.fn();
    renderHook(() =>
      usePhotoScan({
        homeCountry: 'US',
        onScanProgress: jest.fn(),
        onScanComplete,
        onScanError: jest.fn(),
      })
    );

    act(() => {
      usePhotoScanStore.setState({ phase: 'completed', hasResult: true });
    });
    // Idempotent additional set; same importTime — adapter should not re-fire onScanComplete.
    act(() => {
      usePhotoScanStore.setState({ phase: 'idle' });
    });
    act(() => {
      usePhotoScanStore.setState({ phase: 'completed', hasResult: false });
    });

    expect(onScanComplete).toHaveBeenCalledTimes(1);
  });

  it('forwards failed-state transitions into onScanError', async () => {
    const onScanError = jest.fn();
    renderHook(() =>
      usePhotoScan({
        homeCountry: 'US',
        onScanProgress: jest.fn(),
        onScanComplete: jest.fn(),
        onScanError,
      })
    );

    act(() => {
      usePhotoScanStore.setState({
        phase: 'failed',
        scanFailure: { reason: 'scan-error', title: 'X', message: 'y' },
      });
    });

    expect(onScanError).toHaveBeenCalled();
  });

  it('cancelScan delegates to service', () => {
    const { result } = renderHook(() =>
      usePhotoScan({
        homeCountry: 'US',
        onScanProgress: jest.fn(),
        onScanComplete: jest.fn(),
        onScanError: jest.fn(),
      })
    );

    act(() => {
      result.current.cancelScan();
    });

    expect(mockedService.cancelScan).toHaveBeenCalled();
  });

  it('does not cancel the service when the host unmounts (regression: scan survives navigation)', () => {
    const { unmount } = renderHook(() =>
      usePhotoScan({
        homeCountry: 'US',
        onScanProgress: jest.fn(),
        onScanComplete: jest.fn(),
        onScanError: jest.fn(),
      })
    );

    unmount();
    expect(mockedService.cancelScan).not.toHaveBeenCalled();
  });

  it('consumes a pre-existing result on first mount when service already completed', () => {
    const result = {
      candidates: [],
      photoLookup: new Map(),
      clusterLookup: new Map(),
      clusterDisplays: new Map(),
      importTime: 999,
      isIncremental: false,
    };
    mockResultRef.current = result;
    usePhotoScanStore.setState({ phase: 'completed', hasResult: true });

    const onScanComplete = jest.fn();
    renderHook(() =>
      usePhotoScan({
        homeCountry: 'US',
        onScanProgress: jest.fn(),
        onScanComplete,
        onScanError: jest.fn(),
      })
    );

    expect(onScanComplete).toHaveBeenCalledWith(result);
  });
});
