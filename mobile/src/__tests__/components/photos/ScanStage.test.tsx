import { AccessibilityInfo, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { withSpring } from 'react-native-reanimated';

import { READING_GRID_TICK_MS } from '@components/photos/ReadingGrid';
import { ScanStage } from '@components/photos/ScanStage';
import { SCAN_MIN_ARRIVAL_GAP } from '@components/photos/scanMotion';
import { resolveLoadableUri } from '@services/photoImport/resolveLoadableUri';
import type { CountryPreviewRow, ReadingPreview } from '@services/photoImport/scanPreviewPicker';

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

const reading = (count: number, isTravel = false): ReadingPreview[] =>
  Array.from({ length: count }, (_, index) => ({
    assetId: `read-${index}`,
    uri: `file:///read-${index}.jpg`,
    isTravel,
  }));

describe('ScanStage', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(jest.fn());
    jest.mocked(resolveLoadableUri).mockReset();
    jest.mocked(withSpring).mockClear();
  });

  afterEach(() => {
    act(() => jest.runOnlyPendingTimers());
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('renders no text at all — stamps carry the countries, never names or codes', () => {
    const rows = ['PT', 'JP', 'MX'].map((code) => row(code));
    const { toJSON } = render(
      <ScanStage rows={rows} readingPreviews={reading(6)} isComplete reduceMotion />
    );

    const json = JSON.stringify(toJSON());
    expect(screen.queryAllByText(/.+/)).toHaveLength(0);
    for (const code of ['PT', 'JP', 'MX']) {
      expect(json).not.toContain(`"Country ${code}"`);
    }
  });

  it('fills the whole stage with a placeholder grid before any photo is read', () => {
    render(<ScanStage rows={[]} isComplete={false} reduceMotion={false} />);

    const grid = screen.getByTestId('scan-stage-reading-grid', { includeHiddenElements: true });
    expect(StyleSheet.flatten(grid.props.style)).toMatchObject({ position: 'absolute', top: 0 });
    expect(
      screen.getAllByTestId(/^scan-stage-grid-tile-/, { includeHiddenElements: true })
    ).toHaveLength(12);
    expect(screen.queryByTestId('scan-stage-scatter')).toBeNull();
  });

  it('places read photos into the grid one tick at a time', () => {
    render(
      <ScanStage rows={[]} readingPreviews={reading(3)} isComplete={false} reduceMotion={false} />
    );

    const photos = () =>
      screen.queryAllByTestId(/^reading-grid-photo-/, { includeHiddenElements: true });
    expect(photos()).toHaveLength(1);

    act(() => jest.advanceTimersByTime(READING_GRID_TICK_MS * 2));
    expect(photos()).toHaveLength(3);
  });

  it('badges trip photos with a check', () => {
    render(
      <ScanStage rows={[]} readingPreviews={reading(1, true)} isComplete={false} reduceMotion />
    );
    expect(
      screen.getAllByTestId(/^reading-grid-check-/, { includeHiddenElements: true }).length
    ).toBeGreaterThan(0);
  });

  it('dims the grid and pops stamps on the first arrival', () => {
    const { rerender } = render(<ScanStage rows={[]} isComplete={false} reduceMotion />);
    const gridOpacity = () =>
      StyleSheet.flatten(
        screen.getByTestId('scan-stage-reading-grid', { includeHiddenElements: true }).props.style
      ).opacity;
    expect(gridOpacity()).toBe(1);

    rerender(<ScanStage rows={[row('PT')]} isComplete={false} reduceMotion />);

    expect(screen.getByTestId('scan-stage-scatter')).toBeTruthy();
    expect(screen.getByTestId('stamp-scatter-PT')).toBeTruthy();
    expect(gridOpacity()).toBeLessThan(0.5);
  });

  it('springs a newly found stamp in, but not one already on the page at mount', () => {
    const { rerender } = render(
      <ScanStage rows={[row('PT')]} isComplete={false} reduceMotion={false} />
    );
    jest.mocked(withSpring).mockClear();

    rerender(<ScanStage rows={[row('PT'), row('JP')]} isComplete={false} reduceMotion={false} />);
    act(() => jest.advanceTimersByTime(SCAN_MIN_ARRIVAL_GAP));

    expect(withSpring).toHaveBeenCalled();
  });

  it('labels each stamp for VoiceOver with the full country name', () => {
    render(<ScanStage rows={[row('PT')]} isComplete reduceMotion />);

    expect(screen.getByLabelText('Found photos from Country PT')).toBeTruthy();
  });

  it('drains the remaining queue immediately when completion arrives', () => {
    const { rerender } = render(<ScanStage rows={[]} isComplete={false} reduceMotion={false} />);
    const rows = ['PT', 'JP', 'MX', 'IT', 'FR', 'DE'].map((code) => row(code));
    rerender(<ScanStage rows={rows} isComplete={false} reduceMotion={false} />);
    rerender(<ScanStage rows={rows} isComplete reduceMotion={false} />);

    for (const item of rows) {
      expect(
        screen.getByTestId(`stamp-scatter-${item.code}`).props.accessibilityElementsHidden
      ).toBe(false);
    }
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(6);
  });

  it('dequeues a burst in FIFO order with the minimum gap', () => {
    const { rerender } = render(<ScanStage rows={[]} isComplete={false} reduceMotion={false} />);
    const rows = ['PT', 'JP', 'MX'].map((code) => row(code));

    rerender(<ScanStage rows={rows} isComplete={false} reduceMotion={false} />);

    expect(screen.getByTestId('stamp-scatter-PT').props.accessibilityElementsHidden).toBe(false);
    expect(
      screen.getByTestId('stamp-scatter-JP', { includeHiddenElements: true }).props
        .accessibilityElementsHidden
    ).toBe(true);

    act(() => jest.advanceTimersByTime(SCAN_MIN_ARRIVAL_GAP));
    expect(screen.getByTestId('stamp-scatter-JP').props.accessibilityElementsHidden).toBe(false);
  });

  it('tucks up to two photos behind each stamp and drops a failed one', () => {
    render(<ScanStage rows={[row('PT', 2)]} isComplete reduceMotion />);

    expect(screen.getAllByTestId(/^stamp-scatter-photo-PT-/)).toHaveLength(2);

    fireEvent(
      screen.getByTestId('scan-stage-thumbnail-PT-0', { includeHiddenElements: true }),
      'error',
      { nativeEvent: { error: 'load failed' } }
    );

    expect(screen.queryByTestId('scan-stage-thumbnail-PT-0')).toBeNull();
    expect(screen.getByTestId('scan-stage-thumbnail-PT-1')).toBeTruthy();
    expect(resolveLoadableUri).not.toHaveBeenCalled();
  });

  it('scatters stamps to distinct spots rather than stacking them', () => {
    const rows = ['PT', 'JP', 'MX', 'IT', 'FR'].map((code) => row(code));
    render(<ScanStage rows={rows} isComplete reduceMotion />);

    const spots = rows.map((item) => {
      const style = StyleSheet.flatten(
        screen.getByTestId(`stamp-scatter-${item.code}`).props.style
      );
      return `${Math.round(style.left)},${Math.round(style.top)}`;
    });
    expect(new Set(spots).size).toBe(rows.length);
    const lefts = new Set(spots.map((spot) => spot.split(',')[0]));
    expect(lefts.size).toBeGreaterThan(1);
  });
});
