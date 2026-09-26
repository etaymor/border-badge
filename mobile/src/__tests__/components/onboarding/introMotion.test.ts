import {
  INTRO_BEAT_TIMING,
  INTRO_CLOCK_STILL,
  INTRO_IDLE_REPEATS,
  PASSPORT_MOTION,
  STAMP_LAND_MS,
  arcAt,
  counterValueAt,
  popAt,
  segmentAt,
  stampLandScaleAt,
} from '@components/onboarding/introBeats/introMotion';

describe('intro motion worklets', () => {
  it('rest on their final frame when the clock is still (Reduce Motion / resumed)', () => {
    expect(segmentAt(INTRO_CLOCK_STILL, 500, 200)).toBe(1);
    expect(popAt(INTRO_CLOCK_STILL, 500, 200)).toBe(1);
    expect(stampLandScaleAt(INTRO_CLOCK_STILL, 900)).toBe(1);
    expect(counterValueAt(INTRO_CLOCK_STILL, PASSPORT_MOTION.countries)).toBe(24);
  });

  it('sit on the before pose at clock 0 (inactive neighbours)', () => {
    expect(segmentAt(0, 100, 200)).toBe(0);
    expect(popAt(0, 100, 200)).toBe(0);
    expect(stampLandScaleAt(0, 900)).toBe(0);
    expect(counterValueAt(0, PASSPORT_MOTION.countries)).toBe(0);
  });

  it('segmentAt clamps to 0..1', () => {
    expect(segmentAt(50, 100, 200)).toBe(0);
    expect(segmentAt(200, 100, 200)).toBeCloseTo(0.5);
    expect(segmentAt(900, 100, 200)).toBe(1);
  });

  it('popAt overshoots then settles on exactly 1', () => {
    const samples = Array.from({ length: 50 }, (_, i) => popAt(100 + i * 4, 100, 200));
    expect(Math.max(...samples)).toBeGreaterThan(1);
    expect(popAt(300, 100, 200)).toBe(1);
  });

  it('a landing stamp slams from above 1, squashes below 1, and ends exactly at 1', () => {
    const land = 1000;
    expect(stampLandScaleAt(land, land)).toBeCloseTo(1.9);
    const samples = Array.from({ length: STAMP_LAND_MS }, (_, i) =>
      stampLandScaleAt(land + i, land)
    );
    expect(Math.min(...samples)).toBeLessThan(1);
    expect(stampLandScaleAt(land + STAMP_LAND_MS, land)).toBe(1);
    expect(stampLandScaleAt(land - 1, land)).toBe(0);
  });

  it('arcAt starts at the origin and ends at the target', () => {
    expect(arcAt(0, 80, -120)).toEqual({ x: 0, y: -0 });
    expect(arcAt(1, 80, -120)).toEqual({ x: 80, y: -120 });
  });

  it('the passport counter ends exactly on 24 countries and 11% of the world', () => {
    const end = PASSPORT_MOTION.counterStart + PASSPORT_MOTION.counterDuration;
    expect(counterValueAt(end, PASSPORT_MOTION.countries)).toBe(24);
    expect(counterValueAt(end, PASSPORT_MOTION.worldPercent)).toBe(11);
    expect(Math.round((24 / 227) * 100)).toBe(PASSPORT_MOTION.worldPercent);
  });

  it('every beat is at its final frame when its entrance ends', () => {
    const end = INTRO_BEAT_TIMING.passport.entranceMs;
    expect(counterValueAt(end, PASSPORT_MOTION.countries)).toBe(24);
    for (const { entranceMs } of Object.values(INTRO_BEAT_TIMING)) {
      expect(entranceMs).toBeGreaterThan(0);
      // Short enough that a user who taps Continue straight away still sees the payoff soon.
      expect(entranceMs).toBeLessThanOrEqual(4000);
    }
  });

  it('idles a finite, even number of times so it ends at rest', () => {
    expect(INTRO_IDLE_REPEATS).toBeGreaterThan(0);
    expect(INTRO_IDLE_REPEATS % 2).toBe(0);
  });
});
