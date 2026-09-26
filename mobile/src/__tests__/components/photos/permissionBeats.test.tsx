import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { withRepeat } from 'react-native-reanimated';

import OnDeviceBeat from '@components/photos/permissionBeats/OnDeviceBeat';
import PassportBeat from '@components/photos/permissionBeats/PassportBeat';
import PermissionBeatVisual from '@components/photos/permissionBeats/PermissionBeatVisual';
import {
  PERMISSION_CHECK_STAGGER,
  PERMISSION_POP_DURATION,
  permissionBeatVisibleMs,
} from '@components/photos/permissionBeats/permissionMotion';
import {
  PERMISSION_CLOCK_STILL,
  permissionBeatCycleMs,
  permissionFadeAt,
  permissionPopAt,
} from '@components/photos/permissionBeats/usePermissionBeatFade';
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
  it('derives every pop and the fade from one clock, so the loop never double-flashes', () => {
    const timing = { count: 8, stagger: PERMISSION_CHECK_STAGGER };
    const cycle = permissionBeatCycleMs(timing);
    const fadeStart = permissionBeatVisibleMs(timing.count, timing.stagger);

    // Every overlay has fully popped before the fade starts...
    for (let order = 0; order < timing.count; order += 1) {
      expect(permissionPopAt(fadeStart, order, timing.stagger)).toBe(1);
    }
    // ...the fade reaches zero exactly as the clock wraps...
    expect(permissionFadeAt(cycle, timing)).toBe(0);
    // ...and on the wrap every overlay restarts hidden, so nothing flashes back.
    for (let order = 0; order < timing.count; order += 1) {
      expect(permissionPopAt(0, order, timing.stagger) * permissionFadeAt(0, timing)).toBe(0);
    }
    // Pops are staggered and overshoot a little on the way in.
    expect(permissionPopAt(PERMISSION_POP_DURATION * 0.7, 0, timing.stagger)).toBeGreaterThan(1);
    expect(permissionPopAt(PERMISSION_POP_DURATION * 0.7, 1, timing.stagger)).toBeLessThan(1);
  });

  it('rests every overlay at its final frame when the clock is still', () => {
    const timing = { count: 3, stagger: 220 };
    expect(permissionPopAt(PERMISSION_CLOCK_STILL, 2, timing.stagger)).toBe(1);
    expect(permissionFadeAt(PERMISSION_CLOCK_STILL, timing)).toBe(1);
  });

  it('renders a full-bleed 3 x 4 grid, one tile per delivered still', () => {
    render(<TripsFoundBeat isActive={false} reduceMotion={false} assets={{}} />);

    expect(screen.getAllByTestId(/^permission-beat1-tile-/)).toHaveLength(12);
    expect(StyleSheet.flatten(screen.getByTestId('permission-beat-1').props.style)).toMatchObject({
      position: 'absolute',
      top: 0,
      bottom: 0,
    });
  });

  it('renders one tinted placeholder and the three SCAN_COPY pills', () => {
    render(<OnDeviceBeat isActive={false} reduceMotion={false} assets={{}} />);

    expect(screen.getAllByTestId(/^permission-beat-placeholder-/)).toHaveLength(1);
    expect(screen.getByText('Bøur')).toBeTruthy();
    expect(screen.getByText('Faroe Islands')).toBeTruthy();
    expect(screen.getByText('Location data only')).toBeTruthy();
  });

  it('scatters the demo stamps with two tucked photos each and no names', () => {
    render(<PassportBeat isActive={false} reduceMotion={false} assets={{}} />);

    expect(screen.getAllByTestId(/^permission-beat-placeholder-/)).toHaveLength(8);
    expect(screen.getAllByTestId(/^stamp-scatter-stamp-/)).toHaveLength(4);
    expect(screen.queryAllByText(/.+/)).toHaveLength(0);
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
    // Every tile is a real photo: no tinted stand-ins.
    expect(screen.getAllByTestId(/^permission-beat1-image-/)).toHaveLength(12);
    expect(screen.queryAllByTestId(/^permission-beat-placeholder-/)).toHaveLength(0);
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
    expect(screen.getAllByTestId(/^stamp-scatter-photo-/)).toHaveLength(8);
  });

  it('does not start loops for inactive beats or any reduce-motion beat', () => {
    render(<TripsFoundBeat isActive={false} reduceMotion={false} />);
    render(<OnDeviceBeat isActive={false} reduceMotion={false} />);
    render(<PassportBeat isActive={false} reduceMotion={false} />);
    render(<TripsFoundBeat isActive reduceMotion />);

    expect(withRepeat).not.toHaveBeenCalled();
  });

  it.each([
    [1, 1],
    [2, 1],
    [3, 1],
  ] as const)('runs one shared clock for active step %s', (step, loopCount) => {
    render(<PermissionBeatVisual step={step} reduceMotion={false} homeCountry="US" />);

    expect(withRepeat).toHaveBeenCalledTimes(loopCount);
  });

  it('filters a normalized home country out of the demo stamps', () => {
    render(<PassportBeat isActive={false} reduceMotion homeCountry=" hr " />);

    expect(screen.queryByTestId('stamp-scatter-HR')).toBeNull();
    expect(screen.getByTestId('stamp-scatter-JP')).toBeTruthy();
    expect(screen.getByTestId('stamp-scatter-MX')).toBeTruthy();
    expect(screen.getByTestId('stamp-scatter-IT')).toBeTruthy();
  });

  it('uses every demo country when home is outside the demo', () => {
    render(<PassportBeat isActive={false} reduceMotion homeCountry="US" />);

    for (const code of ['HR', 'JP', 'MX', 'IT']) {
      expect(screen.getByTestId(`stamp-scatter-${code}`)).toBeTruthy();
    }
  });

  it('uses supplied assets while retaining placeholders for missing entries', () => {
    const grid = render(<TripsFoundBeat isActive={false} reduceMotion assets={partialAssets} />);
    expect(screen.getByTestId('permission-beat1-image-0').props.source).toContainEqual(
      partialAssets.beat1?.[0]
    );
    expect(screen.getAllByTestId(/^permission-beat-placeholder-/)).toHaveLength(11);
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

  it('keeps the photos on screen for the whole loop; only overlays fade', () => {
    render(<PermissionBeatVisual step={2} reduceMotion={false} />);
    const beat = screen.getByTestId('permission-beat-2');
    expect(StyleSheet.flatten(beat.props.style).opacity).toBeUndefined();
    expect(
      StyleSheet.flatten(screen.getByTestId('permission-beat2-image').props.style).opacity
    ).toBeUndefined();
  });
});
