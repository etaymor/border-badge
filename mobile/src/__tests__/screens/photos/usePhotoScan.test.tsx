/**
 * Behavioral tests for usePhotoScan adapter — complements `usePhotoScan.test.ts`
 * by covering the structured outcome shapes that callers depend on.
 *
 * The internal scan loop (extraction, caching, segmentation, abort propagation)
 * lives in `photoScanService` and is tested in
 * `services/photoImport/photoScanService.test.ts`.
 */

import { renderHook, act } from '@testing-library/react-native';

import { usePhotoScan } from '../../../screens/photos/usePhotoScan';

jest.mock('@services/photoImport', () => ({
  startScan: jest.fn(),
  cancelScan: jest.fn(),
  consumeResult: jest.fn(() => null),
  hasResult: jest.fn(() => false),
  isScanRunning: jest.fn(() => false),
}));

const mockedService = jest.requireMock('@services/photoImport');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('usePhotoScan structured outcomes', () => {
  it('returns home-country reason without showing alert when service rejects', async () => {
    mockedService.startScan.mockResolvedValueOnce({
      status: 'rejected',
      reason: 'no-home-country',
    });

    const { result } = renderHook(() =>
      usePhotoScan({
        homeCountry: 'US',
        onScanProgress: jest.fn(),
        onScanComplete: jest.fn(),
        onScanError: jest.fn(),
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

  it('returns success outcome when service starts the scan', async () => {
    mockedService.startScan.mockResolvedValueOnce({ status: 'started' });

    const { result } = renderHook(() =>
      usePhotoScan({
        homeCountry: 'US',
        onScanProgress: jest.fn(),
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

  it('returns success outcome when service responds already-running', async () => {
    mockedService.startScan.mockResolvedValueOnce({ status: 'already-running' });

    const { result } = renderHook(() =>
      usePhotoScan({
        homeCountry: 'US',
        onScanProgress: jest.fn(),
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
});
