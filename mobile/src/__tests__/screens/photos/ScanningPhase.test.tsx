import mockReact from 'react';
import { Text as MockText } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

import { ScanningPhase } from '@screens/photos/components/ScanningPhase';
import { SCAN_COPY } from '@constants/scanCopy';
import type { ScanProgress } from '@services/photoImport';
import { patchJobSlice, resetLibraryJobStore, useLibraryJobStore } from '@stores/libraryJobStore';

const mockRowsRender = jest.fn();

jest.mock('@components/photos/ScanStage', () => ({
  ScanStage: mockReact.memo(
    (props: { rows: readonly { code: string }[]; isComplete: boolean; isPaused?: boolean }) => {
      mockRowsRender(props);
      return (
        <MockText testID="mock-scan-stage">{props.rows.map((row) => row.code).join(',')}</MockText>
      );
    }
  ),
}));

jest.mock('@hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
}));

jest.mock('@hooks/useContinuationLeaseState', () => ({
  useLeaseKeepsRunning: () => false,
}));

const progress = (current: number): ScanProgress => ({
  phase: 'scanning',
  current,
  total: 100,
  percentage: current,
  gpsPhotoCount: current,
});

describe('ScanningPhase country preview subscription', () => {
  beforeEach(() => {
    resetLibraryJobStore();
    mockRowsRender.mockClear();
    patchJobSlice('trip-scan', { phase: 'running', progress: progress(1) });
  });

  it('updates rows for country changes but ignores progress-only store patches', () => {
    render(
      <ScanningPhase
        scanProgress={progress(1)}
        isIncremental={false}
        onCancelScan={jest.fn()}
        onLeave={jest.fn()}
      />
    );
    expect(mockRowsRender).toHaveBeenCalledTimes(1);

    act(() => {
      patchJobSlice('trip-scan', { progress: progress(2) });
    });
    expect(mockRowsRender).toHaveBeenCalledTimes(1);

    const slice = useLibraryJobStore.getState().jobs['trip-scan'];
    act(() => {
      patchJobSlice('trip-scan', {
        detail: {
          ...slice.detail,
          countryPreviews: [{ code: 'PT', name: 'Portugal', previews: [] }],
        },
      });
    });
    expect(mockRowsRender).toHaveBeenCalledTimes(2);
    expect(mockRowsRender).toHaveBeenLastCalledWith(
      expect.objectContaining({ rows: [expect.objectContaining({ code: 'PT' })] })
    );
  });

  it('passes actual job completion to settle the queue', () => {
    render(
      <ScanningPhase
        scanProgress={progress(99)}
        isIncremental={false}
        onCancelScan={jest.fn()}
        onLeave={jest.fn()}
      />
    );

    act(() => {
      patchJobSlice('trip-scan', { phase: 'completed' });
    });

    expect(mockRowsRender).toHaveBeenLastCalledWith(expect.objectContaining({ isComplete: true }));
  });

  it('forwards the host pause signal to the arrival queue', () => {
    render(
      <ScanningPhase
        scanProgress={progress(1)}
        isIncremental={false}
        isPaused
        onCancelScan={jest.fn()}
        onLeave={jest.fn()}
      />
    );

    expect(mockRowsRender).toHaveBeenLastCalledWith(expect.objectContaining({ isPaused: true }));
  });

  it('renders the shared sheet without the hint paragraph or a bottom cancel', () => {
    render(
      <ScanningPhase
        scanProgress={progress(12)}
        isIncremental={false}
        onCancelScan={jest.fn()}
        onLeave={jest.fn()}
      />
    );

    expect(screen.getByText(SCAN_COPY.trips.stageTitle)).toBeTruthy();
    expect(screen.getByText(SCAN_COPY.shared.stageLines('trip-scan')[0])).toBeTruthy();
    expect(screen.getByText('12 of 100')).toBeTruthy();
    expect(screen.getByTestId('stage-fill')).toBeTruthy();
    expect(screen.getByTestId('photo-import-leave')).toBeTruthy();
    expect(screen.getByTestId('photo-import-stop')).toBeTruthy();
    expect(screen.queryByTestId('scanningHint')).toBeNull();
    expect(screen.queryByText('Cancel')).toBeNull();
    expect(screen.queryByText(SCAN_COPY.shared.persistenceParagraph)).toBeNull();
  });

  it('hides leave and stop once the scan is incremental', () => {
    render(
      <ScanningPhase
        scanProgress={progress(12)}
        isIncremental
        onCancelScan={jest.fn()}
        onLeave={jest.fn()}
      />
    );

    expect(screen.queryByTestId('photo-import-leave')).toBeNull();
    expect(screen.queryByTestId('photo-import-stop')).toBeNull();
  });
});
