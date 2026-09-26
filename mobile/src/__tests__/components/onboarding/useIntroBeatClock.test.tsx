import { renderHook } from '@testing-library/react-native';
import { cancelAnimation, withRepeat, withTiming } from 'react-native-reanimated';

import {
  INTRO_BEAT_TIMING,
  INTRO_CLOCK_STILL,
} from '@components/onboarding/introBeats/introMotion';
import {
  useIntroBeatClock,
  type IntroBeatClockOptions,
} from '@components/onboarding/introBeats/useIntroBeatClock';

const mockedWithTiming = withTiming as jest.Mock;
const mockedWithRepeat = withRepeat as jest.Mock;
const mockedCancel = cancelAnimation as jest.Mock;

/** A beat with an idle, so both values are exercised. */
const TIMING = { entranceMs: 2000, idleHalfMs: 1500 };

const base: IntroBeatClockOptions = {
  isActive: true,
  canPlay: true,
  reduceMotion: false,
  ...TIMING,
};

function entranceTimingCalls() {
  return mockedWithTiming.mock.calls.filter(([value]) => value === TIMING.entranceMs);
}

describe('useIntroBeatClock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('plays the entrance once the beat is active and can play', () => {
    renderHook(() => useIntroBeatClock(base));
    expect(entranceTimingCalls()).toHaveLength(1);
  });

  it('never idles forever: the repeat count is finite and positive', () => {
    renderHook(() => useIntroBeatClock(base));
    expect(mockedWithRepeat).toHaveBeenCalled();
    for (const [, count] of mockedWithRepeat.mock.calls) {
      expect(count).toBeGreaterThan(0);
      expect(Number.isFinite(count)).toBe(true);
    }
  });

  it('beats without an idle start no repeat at all', () => {
    renderHook(() => useIntroBeatClock({ ...base, ...INTRO_BEAT_TIMING.passport }));
    expect(mockedWithRepeat).not.toHaveBeenCalled();
  });

  it('does not animate an inactive beat and holds the before pose', () => {
    const { result } = renderHook(() => useIntroBeatClock({ ...base, isActive: false }));
    expect(mockedWithTiming).not.toHaveBeenCalled();
    expect(result.current.entrance.value).toBe(0);
  });

  it('does not animate until it can play (under the splash / unfocused)', () => {
    const { result } = renderHook(() => useIntroBeatClock({ ...base, canPlay: false }));
    expect(mockedWithTiming).not.toHaveBeenCalled();
    expect(result.current.entrance.value).toBe(0);
  });

  it('shows the final frame under Reduce Motion without animating', () => {
    const { result } = renderHook(() => useIntroBeatClock({ ...base, reduceMotion: true }));
    expect(mockedWithTiming).not.toHaveBeenCalled();
    expect(mockedWithRepeat).not.toHaveBeenCalled();
    expect(result.current.entrance.value).toBe(INTRO_CLOCK_STILL);
  });

  it('on blur cancels, snaps to the final frame, and does not replay on refocus', () => {
    const { result, rerender } = renderHook(
      (props: IntroBeatClockOptions) => useIntroBeatClock(props),
      {
        initialProps: base,
      }
    );
    const { entrance, idle } = result.current;
    mockedCancel.mockClear();

    rerender({ ...base, canPlay: false });
    expect(mockedCancel).toHaveBeenCalledWith(entrance);
    expect(mockedCancel).toHaveBeenCalledWith(idle);
    expect(entrance.value).toBe(INTRO_CLOCK_STILL);

    mockedWithTiming.mockClear();
    rerender({ ...base, canPlay: true });
    expect(entranceTimingCalls()).toHaveLength(0);
    expect(entrance.value).toBe(INTRO_CLOCK_STILL);
  });

  it('becoming inactive cancels and resets, and coming back replays', () => {
    const { result, rerender } = renderHook(
      (props: IntroBeatClockOptions) => useIntroBeatClock(props),
      {
        initialProps: base,
      }
    );
    const { entrance } = result.current;
    mockedCancel.mockClear();

    rerender({ ...base, isActive: false });
    expect(mockedCancel).toHaveBeenCalledWith(entrance);
    expect(entrance.value).toBe(0);

    mockedWithTiming.mockClear();
    rerender(base);
    expect(entranceTimingCalls()).toHaveLength(1);
  });

  it('cancels both values on unmount', () => {
    const { result, unmount } = renderHook(() => useIntroBeatClock(base));
    const { entrance, idle } = result.current;
    mockedCancel.mockClear();
    unmount();
    expect(mockedCancel).toHaveBeenCalledWith(entrance);
    expect(mockedCancel).toHaveBeenCalledWith(idle);
  });
});
