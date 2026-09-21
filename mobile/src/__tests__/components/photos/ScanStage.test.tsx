import { AccessibilityInfo, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { withRepeat, withSpring, withTiming } from 'react-native-reanimated';

import { ScanStage } from '@components/photos/ScanStage';
import { SCAN_MIN_ARRIVAL_GAP } from '@components/photos/scanMotion';
import { resolveLoadableUri } from '@services/photoImport/resolveLoadableUri';
import type { CountryPreviewRow } from '@services/photoImport/scanPreviewPicker';

jest.mock('@services/photoImport/resolveLoadableUri', () => ({
  resolveLoadableUri: jest.fn(),
}));

const row = (code: string, previewCount = 2): CountryPreviewRow => ({
  code,
  name: `Country ${code}`,
  previews: Array.from({ length: previewCount }, (_, index) => ({
    assetId: `${code}-${index}`,
    uri: `file:///${code}-${index}.jpg`,
  })),
});

describe('ScanStage', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(jest.fn());
    jest.mocked(resolveLoadableUri).mockReset();
    jest.mocked(withSpring).mockClear();
    jest.mocked(withTiming).mockClear();
    jest.mocked(withRepeat).mockClear();
  });

  afterEach(() => {
    act(() => jest.runOnlyPendingTimers());
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('renders the reading sweep grid when no rows have arrived', () => {
    render(<ScanStage rows={[]} isComplete={false} reduceMotion={false} />);

    expect(screen.getByTestId('scan-stage-reading-grid')).toBeTruthy();
    expect(screen.getByTestId('scan-stage-sweep')).toBeTruthy();
    expect(screen.getAllByTestId(/scan-stage-grid-placeholder-/)).toHaveLength(20);
    expect(screen.queryByTestId('scan-stage-shelf')).toBeTruthy();
    expect(withRepeat).toHaveBeenCalled();
  });

  it('holds the placeholder grid still under Reduce Motion', () => {
    render(<ScanStage rows={[]} isComplete={false} reduceMotion />);

    expect(screen.getByTestId('scan-stage-reading-grid')).toBeTruthy();
    expect(screen.queryByTestId('scan-stage-sweep')).toBeNull();
    expect(withRepeat).not.toHaveBeenCalled();
  });

  it('crossfades to the shelf layout on the first arrival', () => {
    const { rerender } = render(<ScanStage rows={[]} isComplete={false} reduceMotion={false} />);

    expect(screen.getByTestId('scan-stage-sweep')).toBeTruthy();

    rerender(<ScanStage rows={[row('PT')]} isComplete={false} reduceMotion={false} />);

    expect(screen.getByTestId('scan-stage-row-PT')).toBeTruthy();
    expect(screen.getByText('Country PT')).toBeTruthy();
    expect(screen.queryByTestId('scan-stage-sweep')).toBeNull();
    expect(withTiming).toHaveBeenCalled();
  });

  it('drains the remaining queue immediately when completion arrives', () => {
    const { rerender } = render(<ScanStage rows={[]} isComplete={false} reduceMotion={false} />);
    const rows = ['PT', 'JP', 'MX', 'IT', 'FR', 'DE'].map((code) => row(code));
    rerender(<ScanStage rows={rows} isComplete={false} reduceMotion={false} />);
    rerender(<ScanStage rows={rows} isComplete reduceMotion={false} />);

    for (const item of rows) {
      expect(
        screen.getByTestId(`scan-stage-row-${item.code}`).props.accessibilityElementsHidden
      ).toBe(false);
    }
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(6);
  });

  it('dequeues a burst in FIFO order with the minimum gap', () => {
    const { rerender } = render(<ScanStage rows={[]} isComplete={false} reduceMotion={false} />);
    const rows = ['PT', 'JP', 'MX'].map((code) => row(code));

    rerender(<ScanStage rows={rows} isComplete={false} reduceMotion={false} />);

    expect(screen.getByTestId('scan-stage-row-PT').props.accessibilityElementsHidden).toBe(false);
    expect(
      screen.getByTestId('scan-stage-row-JP', { includeHiddenElements: true }).props
        .accessibilityElementsHidden
    ).toBe(true);

    act(() => jest.advanceTimersByTime(SCAN_MIN_ARRIVAL_GAP));
    expect(screen.getByTestId('scan-stage-row-JP').props.accessibilityElementsHidden).toBe(false);
  });

  it('fills empty preview slots with the placeholder tile', () => {
    render(<ScanStage rows={[row('PT', 0)]} isComplete={false} reduceMotion />);

    expect(screen.getByTestId('scan-stage-slot-placeholder-PT-0')).toBeTruthy();
    expect(screen.getByTestId('scan-stage-slot-placeholder-PT-1')).toBeTruthy();
    expect(screen.getAllByTestId(/country-row-slot-/)).toHaveLength(2);
  });

  it('replaces a failed thumbnail with the placeholder tile', () => {
    render(<ScanStage rows={[row('PT', 1)]} isComplete={false} reduceMotion />);

    fireEvent(
      screen.getByTestId('scan-stage-thumbnail-PT-0', { includeHiddenElements: true }),
      'error',
      { nativeEvent: { error: 'load failed' } }
    );

    expect(screen.queryByTestId('scan-stage-thumbnail-PT-0')).toBeNull();
    expect(screen.getByTestId('scan-stage-slot-placeholder-PT-0')).toBeTruthy();
    expect(screen.getByTestId('scan-stage-slot-placeholder-PT-1')).toBeTruthy();
    expect(resolveLoadableUri).not.toHaveBeenCalled();
  });

  it('masks older rows behind a top gradient', () => {
    const twelve = Array.from({ length: 12 }, (_, index) =>
      row(['PT', 'JP', 'MX', 'IT', 'FR', 'DE'][index % 6] + index)
    );
    render(<ScanStage rows={twelve} isComplete reduceMotion />);

    expect(screen.getByTestId('scan-stage-top-mask')).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByTestId('scan-stage').props.style)).toMatchObject({
      flex: 1,
    });
  });
});
