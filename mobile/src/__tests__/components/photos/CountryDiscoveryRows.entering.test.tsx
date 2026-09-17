import mockReact from 'react';
import { View as MockView } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { CountryDiscoveryRows } from '@components/photos/CountryDiscoveryRows';
import { SCAN_MIN_ARRIVAL_GAP } from '@components/photos/scanMotion';
import type { CountryPreviewRow } from '@services/photoImport/scanPreviewPicker';

const mockCountryRowRender = jest.fn();

jest.mock('@components/photos/CountryRow', () => ({
  CountryRow: mockReact.memo((props: { code: string; entering: boolean }) => {
    mockCountryRowRender(props);
    return <MockView testID={`mock-country-row-${props.code}`} />;
  }),
}));

const row = (code: string): CountryPreviewRow => ({
  code,
  name: `Country ${code}`,
  previews: [],
});

function latestEntering(code: string): boolean | undefined {
  return mockCountryRowRender.mock.calls
    .map(([props]) => props as { code: string; entering: boolean })
    .filter((props) => props.code === code)
    .at(-1)?.entering;
}

describe('CountryDiscoveryRows entering lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockCountryRowRender.mockClear();
  });

  afterEach(() => {
    act(() => jest.runOnlyPendingTimers());
    jest.useRealTimers();
  });

  it('keeps the current row entering throughout its arrival gap', () => {
    const { rerender } = render(
      <CountryDiscoveryRows rows={[]} isComplete={false} reduceMotion={false} />
    );

    rerender(<CountryDiscoveryRows rows={[row('PT')]} isComplete={false} reduceMotion={false} />);

    expect(latestEntering('PT')).toBe(true);
    act(() => jest.advanceTimersByTime(SCAN_MIN_ARRIVAL_GAP - 1));
    expect(latestEntering('PT')).toBe(true);
  });

  it('replaces the entering row at the next dequeue and clears it on completion', () => {
    const { rerender } = render(
      <CountryDiscoveryRows rows={[]} isComplete={false} reduceMotion={false} />
    );
    const rows = [row('PT'), row('JP')];

    rerender(<CountryDiscoveryRows rows={rows} isComplete={false} reduceMotion={false} />);
    expect(latestEntering('PT')).toBe(true);

    act(() => jest.advanceTimersByTime(SCAN_MIN_ARRIVAL_GAP));
    expect(latestEntering('PT')).toBe(false);
    expect(latestEntering('JP')).toBe(true);

    rerender(<CountryDiscoveryRows rows={rows} isComplete reduceMotion={false} />);
    expect(latestEntering('JP')).toBe(false);
  });
});
