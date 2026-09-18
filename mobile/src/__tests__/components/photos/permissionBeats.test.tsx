import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { withRepeat } from 'react-native-reanimated';

import OnDeviceBeat from '@components/photos/permissionBeats/OnDeviceBeat';
import PassportBeat from '@components/photos/permissionBeats/PassportBeat';
import PermissionBeatVisual from '@components/photos/permissionBeats/PermissionBeatVisual';
import TripsFoundBeat from '@components/photos/permissionBeats/TripsFoundBeat';
import type { PermissionBeatAssets } from '@components/photos/permissionBeats/permissionBeatAssets';

const partialAssets: PermissionBeatAssets = {
  beat1: [{ uri: 'asset://travel-one' }],
  beat3: {
    JP: [{ uri: 'asset://japan-one' }],
  },
};

describe('permission beat visuals', () => {
  it('renders twelve tinted placeholders in the trips grid', () => {
    render(<TripsFoundBeat isActive={false} reduceMotion={false} />);

    expect(screen.getAllByTestId(/^permission-beat-placeholder-/)).toHaveLength(12);
    expect(screen.getAllByTestId(/^permission-beat1-tile-/)).toHaveLength(12);
  });

  it('renders one tinted placeholder and the three SCAN_COPY pills', () => {
    render(<OnDeviceBeat isActive={false} reduceMotion={false} />);

    expect(screen.getAllByTestId(/^permission-beat-placeholder-/)).toHaveLength(1);
    expect(screen.getByText('Lisbon')).toBeTruthy();
    expect(screen.getByText('Portugal')).toBeTruthy();
    expect(screen.getByText('Location data only')).toBeTruthy();
  });

  it('renders six tinted placeholders in three shared country rows', () => {
    render(<PassportBeat isActive={false} reduceMotion={false} />);

    expect(screen.getAllByTestId(/^permission-beat-placeholder-/)).toHaveLength(6);
    expect(screen.getAllByTestId(/^country-row-/)).toHaveLength(12);
  });

  it('renders each reduce-motion beat at its final static frame', () => {
    const grid = render(<TripsFoundBeat isActive reduceMotion />);
    const checks = screen.getAllByTestId(/^permission-beat1-check-/);
    expect(checks).toHaveLength(8);
    checks.forEach((check) => {
      expect(StyleSheet.flatten(check.props.style)).toMatchObject({
        opacity: 1,
        transform: [{ scale: 1 }],
      });
    });
    grid.unmount();

    const photo = render(<OnDeviceBeat isActive reduceMotion />);
    const pills = screen.getAllByTestId(/^permission-beat2-pill-/);
    expect(pills).toHaveLength(3);
    pills.forEach((pill) => {
      expect(StyleSheet.flatten(pill.props.style)).toMatchObject({
        opacity: 1,
        transform: [{ translateY: 0 }, { scale: 1 }],
      });
    });
    photo.unmount();

    render(<PassportBeat isActive reduceMotion />);
    expect(screen.getAllByTestId(/^country-row-slot-/)).toHaveLength(6);
  });

  it('does not start loops for inactive beats or any reduce-motion beat', () => {
    render(<TripsFoundBeat isActive={false} reduceMotion={false} />);
    render(<OnDeviceBeat isActive={false} reduceMotion={false} />);
    render(<PassportBeat isActive={false} reduceMotion={false} />);
    render(<TripsFoundBeat isActive reduceMotion />);

    expect(withRepeat).not.toHaveBeenCalled();
  });

  it.each([
    [1, 8],
    [2, 3],
    [3, 6],
  ] as const)('loops only the visible content for active step %s', (step, loopCount) => {
    render(<PermissionBeatVisual step={step} reduceMotion={false} homeCountry="US" />);

    expect(withRepeat).toHaveBeenCalledTimes(loopCount);
  });

  it('filters a normalized home country and fills from the fourth demo country', () => {
    render(<PassportBeat isActive={false} reduceMotion homeCountry=" pt " />);

    expect(screen.queryByTestId('country-row-PT')).toBeNull();
    expect(screen.getByTestId('country-row-JP')).toBeTruthy();
    expect(screen.getByTestId('country-row-MX')).toBeTruthy();
    expect(screen.getByTestId('country-row-IT')).toBeTruthy();
  });

  it('uses the first three demo countries when home is outside the demo', () => {
    render(<PassportBeat isActive={false} reduceMotion homeCountry="US" />);

    expect(screen.getByTestId('country-row-PT')).toBeTruthy();
    expect(screen.getByTestId('country-row-JP')).toBeTruthy();
    expect(screen.getByTestId('country-row-MX')).toBeTruthy();
    expect(screen.queryByTestId('country-row-IT')).toBeNull();
  });

  it('uses supplied assets while retaining placeholders for missing entries', () => {
    const grid = render(<TripsFoundBeat isActive={false} reduceMotion assets={partialAssets} />);
    expect(screen.getByTestId('permission-beat1-image-0').props.source).toContainEqual(
      partialAssets.beat1?.[0]
    );
    expect(screen.getAllByTestId(/^permission-beat-placeholder-/)).toHaveLength(11);
    grid.unmount();

    render(<PassportBeat isActive={false} reduceMotion assets={partialAssets} homeCountry="PT" />);
    expect(screen.getByTestId('permission-beat3-image-JP-0').props.source).toContainEqual(
      partialAssets.beat3?.JP?.[0]
    );
    expect(screen.getAllByTestId(/^permission-beat-placeholder-/)).toHaveLength(5);
  });

  it.each([1, 2, 3] as const)('renders exactly the active beat for step %s', (step) => {
    render(
      <PermissionBeatVisual
        step={step}
        reduceMotion={false}
        homeCountry="US"
        assets={partialAssets}
      />
    );

    expect(screen.getAllByTestId(/^permission-beat-[123]$/)).toHaveLength(1);
    expect(screen.getByTestId(`permission-beat-${step}`)).toBeTruthy();
  });

  it('uses a bounded visual frame for compact permission doors', () => {
    render(<PermissionBeatVisual step={1} reduceMotion compact />);

    expect(
      StyleSheet.flatten(screen.getByTestId('permission-beat-visual').props.style)
    ).toMatchObject({
      height: 190,
      minHeight: 190,
    });
    expect(
      StyleSheet.flatten(screen.getByTestId('permission-beat-visual-content').props.style).transform
    ).toEqual([{ scale: 0.7 }]);
  });
});
