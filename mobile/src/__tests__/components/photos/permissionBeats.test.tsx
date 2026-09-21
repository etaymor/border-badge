import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { withRepeat } from 'react-native-reanimated';

import OnDeviceBeat from '@components/photos/permissionBeats/OnDeviceBeat';
import PassportBeat from '@components/photos/permissionBeats/PassportBeat';
import PermissionBeatVisual from '@components/photos/permissionBeats/PermissionBeatVisual';
import {
  PERMISSION_BEAT_FADE_OUT,
  PERMISSION_CHECK_STAGGER,
  PERMISSION_POP_DURATION,
  permissionBeatResetDelay,
  permissionBeatVisibleMs,
} from '@components/photos/permissionBeats/permissionMotion';
import TripsFoundBeat from '@components/photos/permissionBeats/TripsFoundBeat';
import {
  DEFAULT_PERMISSION_BEAT_ASSETS,
  type PermissionBeatAssets,
} from '@components/photos/permissionBeats/permissionBeatAssets';

const partialAssets: PermissionBeatAssets = {
  beat1: [{ uri: 'asset://travel-one' }],
  beat3: {
    JP: [{ uri: 'asset://japan-one' }],
  },
};

describe('permission beat visuals', () => {
  it('resets each pop at the same instant the frame finishes fading', () => {
    const count = 8;
    const visibleMs = permissionBeatVisibleMs(count, PERMISSION_CHECK_STAGGER);
    const fadeEnd = visibleMs + PERMISSION_BEAT_FADE_OUT;

    for (let order = 0; order < count; order += 1) {
      const snapAt =
        order * PERMISSION_CHECK_STAGGER +
        PERMISSION_POP_DURATION +
        permissionBeatResetDelay(order, count, PERMISSION_CHECK_STAGGER);
      expect(snapAt).toBe(fadeEnd);
    }
  });

  it('renders twenty tiles filling the trips grid', () => {
    render(<TripsFoundBeat isActive={false} reduceMotion={false} assets={{}} />);

    expect(screen.getAllByTestId(/^permission-beat-placeholder-/)).toHaveLength(20);
    expect(screen.getAllByTestId(/^permission-beat1-tile-/)).toHaveLength(20);
    expect(StyleSheet.flatten(screen.getByTestId('permission-beat-1').props.style).gap).toBe(4);
  });

  it('renders one tinted placeholder and the three SCAN_COPY pills', () => {
    render(<OnDeviceBeat isActive={false} reduceMotion={false} assets={{}} />);

    expect(screen.getAllByTestId(/^permission-beat-placeholder-/)).toHaveLength(1);
    expect(screen.getByText('Bøur')).toBeTruthy();
    expect(screen.getByText('Faroe Islands')).toBeTruthy();
    expect(screen.getByText('Location data only')).toBeTruthy();
  });

  it('renders six tinted placeholders in three shared country rows', () => {
    render(<PassportBeat isActive={false} reduceMotion={false} assets={{}} />);

    expect(screen.getAllByTestId(/^permission-beat-placeholder-/)).toHaveLength(6);
    expect(screen.getAllByTestId(/^country-row-/)).toHaveLength(12);
  });

  it('wires the delivered stills into the default asset map', () => {
    expect(DEFAULT_PERMISSION_BEAT_ASSETS.beat1).toHaveLength(12);
    expect(DEFAULT_PERMISSION_BEAT_ASSETS.beat2).toBeDefined();
    expect(Object.keys(DEFAULT_PERMISSION_BEAT_ASSETS.beat3 ?? {})).toEqual([
      'HR',
      'JP',
      'MX',
      'IT',
    ]);
    expect(DEFAULT_PERMISSION_BEAT_ASSETS.beat3?.HR).toHaveLength(2);

    render(<TripsFoundBeat isActive={false} reduceMotion={false} />);
    expect(screen.getAllByTestId(/^permission-beat1-image-/)).toHaveLength(12);
    expect(screen.getAllByTestId(/^permission-beat-placeholder-/)).toHaveLength(8);
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
    [1, 9],
    [2, 4],
    [3, 7],
  ] as const)('loops the beat and its fade for active step %s', (step, loopCount) => {
    render(<PermissionBeatVisual step={step} reduceMotion={false} homeCountry="US" />);

    expect(withRepeat).toHaveBeenCalledTimes(loopCount);
  });

  it('filters a normalized home country and fills from the fourth demo country', () => {
    render(<PassportBeat isActive={false} reduceMotion homeCountry=" hr " />);

    expect(screen.queryByTestId('country-row-HR')).toBeNull();
    expect(screen.getByTestId('country-row-JP')).toBeTruthy();
    expect(screen.getByTestId('country-row-MX')).toBeTruthy();
    expect(screen.getByTestId('country-row-IT')).toBeTruthy();
  });

  it('uses the first three demo countries when home is outside the demo', () => {
    render(<PassportBeat isActive={false} reduceMotion homeCountry="US" />);

    expect(screen.getByTestId('country-row-HR')).toBeTruthy();
    expect(screen.getByTestId('country-row-JP')).toBeTruthy();
    expect(screen.getByTestId('country-row-MX')).toBeTruthy();
    expect(screen.queryByTestId('country-row-IT')).toBeNull();
  });

  it('uses supplied assets while retaining placeholders for missing entries', () => {
    const grid = render(<TripsFoundBeat isActive={false} reduceMotion assets={partialAssets} />);
    expect(screen.getByTestId('permission-beat1-image-0').props.source).toContainEqual(
      partialAssets.beat1?.[0]
    );
    expect(screen.getAllByTestId(/^permission-beat-placeholder-/)).toHaveLength(19);
    grid.unmount();

    render(<PassportBeat isActive={false} reduceMotion assets={partialAssets} homeCountry="HR" />);
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

  it('frames every beat in the stage card', () => {
    render(<PermissionBeatVisual step={1} reduceMotion />);

    const frame = StyleSheet.flatten(screen.getByTestId('stage-card').props.style);
    expect(frame.aspectRatio).toBeCloseTo(4 / 5);
    expect(frame.borderRadius).toBe(24);
    expect(frame.overflow).toBe('hidden');
    expect(screen.queryByTestId('permission-beat-visual-content')).toBeNull();
  });
});
