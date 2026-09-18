import { AccessibilityInfo, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { withSpring, withTiming } from 'react-native-reanimated';

import {
  CountryDiscoveryRows,
  COUNTRY_DISCOVERY_VIEWPORT_HEIGHT,
} from '@components/photos/CountryDiscoveryRows';
import { SCAN_MIN_ARRIVAL_GAP } from '@components/photos/scanMotion';
import { SCAN_COPY } from '@constants/scanCopy';
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

describe('CountryDiscoveryRows', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(jest.fn());
    jest.mocked(resolveLoadableUri).mockReset();
    jest.mocked(withSpring).mockClear();
    jest.mocked(withTiming).mockClear();
  });

  afterEach(() => {
    act(() => jest.runOnlyPendingTimers());
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('renders settled stamp-and-name rows known at mount', () => {
    render(<CountryDiscoveryRows rows={[row('PT'), row('JP')]} isComplete={false} reduceMotion />);

    expect(screen.getByText('Country PT')).toBeTruthy();
    expect(screen.getByText('Country JP')).toBeTruthy();
    expect(screen.getByTestId('country-row-stamp-PT')).toBeTruthy();
    expect(screen.getByTestId('country-row-stamp-JP')).toBeTruthy();
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
  });

  it('dequeues a burst in FIFO order with the minimum gap', () => {
    const { rerender } = render(
      <CountryDiscoveryRows rows={[]} isComplete={false} reduceMotion={false} />
    );
    const rows = ['PT', 'JP', 'MX', 'IT', 'FR', 'DE'].map((code) => row(code));

    rerender(<CountryDiscoveryRows rows={rows} isComplete={false} reduceMotion={false} />);

    expect(screen.getByTestId('country-discovery-row-PT').props.accessibilityElementsHidden).toBe(
      false
    );
    expect(
      screen.getByTestId('country-discovery-row-JP', { includeHiddenElements: true }).props
        .accessibilityElementsHidden
    ).toBe(true);

    act(() => jest.advanceTimersByTime(SCAN_MIN_ARRIVAL_GAP));
    expect(screen.getByTestId('country-discovery-row-JP').props.accessibilityElementsHidden).toBe(
      false
    );
    expect(
      screen.getByTestId('country-discovery-row-MX', { includeHiddenElements: true }).props
        .accessibilityElementsHidden
    ).toBe(true);
  });

  it('preserves the minimum gap when a new row arrives during the cooldown', () => {
    const { rerender } = render(
      <CountryDiscoveryRows rows={[]} isComplete={false} reduceMotion={false} />
    );
    rerender(<CountryDiscoveryRows rows={[row('PT')]} isComplete={false} reduceMotion={false} />);
    rerender(
      <CountryDiscoveryRows rows={[row('PT'), row('JP')]} isComplete={false} reduceMotion={false} />
    );

    act(() => jest.advanceTimersByTime(SCAN_MIN_ARRIVAL_GAP - 1));
    expect(
      screen.getByTestId('country-discovery-row-JP', { includeHiddenElements: true }).props
        .accessibilityElementsHidden
    ).toBe(true);

    act(() => jest.advanceTimersByTime(1));
    expect(screen.getByTestId('country-discovery-row-JP').props.accessibilityElementsHidden).toBe(
      false
    );
  });

  it('pauses queued arrivals and announcements until the host regains focus', () => {
    const { rerender } = render(
      <CountryDiscoveryRows rows={[]} isComplete={false} isPaused reduceMotion={false} />
    );
    const rows = [row('PT'), row('JP')];

    rerender(<CountryDiscoveryRows rows={rows} isComplete={false} isPaused reduceMotion={false} />);
    act(() => jest.advanceTimersByTime(SCAN_MIN_ARRIVAL_GAP * 2));

    expect(
      screen.getByTestId('country-discovery-row-PT', { includeHiddenElements: true }).props
        .accessibilityElementsHidden
    ).toBe(true);
    expect(
      screen.getByTestId('country-discovery-viewport', { includeHiddenElements: true }).props
        .accessibilityElementsHidden
    ).toBe(true);
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();

    rerender(
      <CountryDiscoveryRows rows={rows} isComplete={false} isPaused={false} reduceMotion={false} />
    );

    expect(screen.getByTestId('country-discovery-row-PT').props.accessibilityElementsHidden).toBe(
      false
    );
    expect(screen.getByTestId('country-discovery-viewport').props.accessibilityElementsHidden).toBe(
      false
    );
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(SCAN_MIN_ARRIVAL_GAP));
    expect(screen.getByTestId('country-discovery-row-JP').props.accessibilityElementsHidden).toBe(
      false
    );
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(2);
  });

  it('settles the remaining queue immediately when completion arrives', () => {
    const { rerender } = render(
      <CountryDiscoveryRows rows={[]} isComplete={false} reduceMotion={false} />
    );
    const rows = ['PT', 'JP', 'MX', 'IT', 'FR', 'DE'].map((code) => row(code));
    rerender(<CountryDiscoveryRows rows={rows} isComplete={false} reduceMotion={false} />);
    rerender(<CountryDiscoveryRows rows={rows} isComplete reduceMotion={false} />);

    for (const item of rows) {
      expect(
        screen.getByTestId(`country-discovery-row-${item.code}`).props.accessibilityElementsHidden
      ).toBe(false);
    }
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(6);
  });

  it('does not replay mount-known rows and animates only a later key', () => {
    const initial = [row('PT'), row('JP'), row('MX')];
    const { rerender } = render(
      <CountryDiscoveryRows rows={initial} isComplete={false} reduceMotion={false} />
    );

    expect(withTiming).not.toHaveBeenCalled();
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();

    rerender(
      <CountryDiscoveryRows
        rows={[...initial, row('IT')]}
        isComplete={false}
        reduceMotion={false}
      />
    );

    expect(withTiming).toHaveBeenCalled();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      SCAN_COPY.trips.discovery('Country IT')
    );
  });

  it('keeps a fixed four-row viewport and positions the latest four in view', () => {
    const twelve = Array.from({ length: 12 }, (_, index) =>
      row(['PT', 'JP', 'MX', 'IT', 'FR', 'DE'][index % 6] + index)
    );
    render(<CountryDiscoveryRows rows={twelve} isComplete reduceMotion />);

    expect(
      StyleSheet.flatten(screen.getByTestId('country-discovery-viewport').props.style)
    ).toMatchObject({ height: COUNTRY_DISCOVERY_VIEWPORT_HEIGHT });
    expect(
      StyleSheet.flatten(screen.getByTestId('country-discovery-row-PT0').props.style).transform[0]
        .translateY
    ).toBeLessThan(0);
    for (const item of twelve.slice(-4)) {
      expect(
        StyleSheet.flatten(screen.getByTestId(`country-discovery-row-${item.code}`).props.style)
          .transform[0].translateY
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it('renders one preview without a placeholder and drops it silently on error', () => {
    render(<CountryDiscoveryRows rows={[row('PT', 1)]} isComplete={false} reduceMotion />);

    expect(screen.getAllByTestId(/country-row-slot-/)).toHaveLength(1);
    fireEvent(
      screen.getByTestId('country-discovery-thumbnail-PT-0', { includeHiddenElements: true }),
      'error',
      { nativeEvent: { error: 'load failed' } }
    );

    expect(screen.queryByTestId('country-discovery-thumbnail-PT-0')).toBeNull();
    expect(screen.queryByTestId('photo-thumbnail-placeholder')).toBeNull();
    expect(resolveLoadableUri).not.toHaveBeenCalled();
  });

  it('uses final transform-free row states with Reduce Motion', () => {
    const { rerender } = render(<CountryDiscoveryRows rows={[]} isComplete={false} reduceMotion />);
    rerender(<CountryDiscoveryRows rows={[row('PT')]} isComplete={false} reduceMotion />);

    expect(StyleSheet.flatten(screen.getByTestId('country-row-PT').props.style)).toMatchObject({
      opacity: 1,
      transform: [{ translateY: 0 }],
    });
    expect(withSpring).not.toHaveBeenCalled();
    expect(withTiming).not.toHaveBeenCalled();
  });

  it('announces every later arrival exactly once and exposes polite live text', () => {
    const { rerender } = render(<CountryDiscoveryRows rows={[]} isComplete={false} reduceMotion />);
    rerender(<CountryDiscoveryRows rows={[row('PT')]} isComplete={false} reduceMotion />);
    rerender(<CountryDiscoveryRows rows={[row('PT')]} isComplete={false} reduceMotion />);

    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      SCAN_COPY.trips.discovery('Country PT')
    );
    expect(screen.getByTestId('country-discovery-row-PT').props).toMatchObject({
      accessibilityLabel: SCAN_COPY.trips.discovery('Country PT'),
      accessibilityLiveRegion: 'polite',
    });
  });

  it('adds a second preview to an existing row without replaying its arrival', () => {
    const { rerender } = render(
      <CountryDiscoveryRows rows={[row('PT', 1)]} isComplete={false} reduceMotion={false} />
    );
    jest.mocked(withTiming).mockClear();
    jest.mocked(AccessibilityInfo.announceForAccessibility).mockClear();

    rerender(
      <CountryDiscoveryRows rows={[row('PT', 2)]} isComplete={false} reduceMotion={false} />
    );

    expect(screen.getAllByTestId(/country-row-slot-/)).toHaveLength(2);
    expect(withTiming).not.toHaveBeenCalled();
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
  });

  it('cancels pending dequeue timers when unmounted', () => {
    const { rerender, unmount } = render(
      <CountryDiscoveryRows rows={[]} isComplete={false} reduceMotion={false} />
    );
    rerender(
      <CountryDiscoveryRows
        rows={[row('PT'), row('JP'), row('MX')]}
        isComplete={false}
        reduceMotion={false}
      />
    );
    const announcementsBeforeUnmount = jest.mocked(AccessibilityInfo.announceForAccessibility).mock
      .calls.length;

    unmount();
    act(() => jest.advanceTimersByTime(SCAN_MIN_ARRIVAL_GAP * 3));

    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(
      announcementsBeforeUnmount
    );
  });
});
