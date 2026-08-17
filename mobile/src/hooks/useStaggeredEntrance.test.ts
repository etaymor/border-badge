import { renderHook, act } from '@testing-library/react-native';
import { Animated } from 'react-native';

import {
  useStaggeredEntrance,
  calculateStaggerDelay,
  StaggeredEntrancePresets,
} from './useStaggeredEntrance';
import { STAGGER_DELAY_DEFAULT, STAGGER_MAX_DURATION } from '../navigation/transitionConfig';

// Mock Animated.spring to track calls
const mockSpringStart = jest.fn((callback?: (result: { finished: boolean }) => void) => {
  // Immediately call the callback to simulate completion
  if (callback) {
    callback({ finished: true });
  }
});

jest.spyOn(Animated, 'spring').mockImplementation(
  () =>
    ({
      start: mockSpringStart,
    }) as unknown as Animated.CompositeAnimation
);

describe('calculateStaggerDelay', () => {
  it('calculates correct delay for first item (index 0)', () => {
    const delay = calculateStaggerDelay(0, 50, 1500);
    expect(delay).toBe(0);
  });

  it('calculates correct delay for middle items', () => {
    const delay = calculateStaggerDelay(5, 50, 1500);
    expect(delay).toBe(250); // 5 * 50
  });

  it('caps delay at maxDuration', () => {
    // With 50ms stagger, item 40 would normally be 2000ms (40 * 50)
    // But should be capped at 1500ms
    const delay = calculateStaggerDelay(40, 50, 1500);
    expect(delay).toBe(1500);
  });

  it('uses default stagger delay correctly', () => {
    const delay = calculateStaggerDelay(10, STAGGER_DELAY_DEFAULT, STAGGER_MAX_DURATION);
    expect(delay).toBe(10 * STAGGER_DELAY_DEFAULT);
  });

  it('returns maxDuration when calculated delay exceeds it', () => {
    const delay = calculateStaggerDelay(100, 100, 500);
    expect(delay).toBe(500);
  });
});

describe('useStaggeredEntrance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('initialization', () => {
    it('creates animation values for each item', () => {
      const { result } = renderHook(() => useStaggeredEntrance({ itemCount: 5, autoStart: false }));

      // Should be able to get animation values for all 5 items
      for (let i = 0; i < 5; i++) {
        const animValue = result.current.getAnimationValue(i);
        expect(animValue).toBeDefined();
        expect((animValue as unknown as { _value: number })._value).toBe(0);
      }
    });

    it('returns getAnimatedStyle function', () => {
      const { result } = renderHook(() => useStaggeredEntrance({ itemCount: 3, autoStart: false }));

      expect(typeof result.current.getAnimatedStyle).toBe('function');
    });

    it('returns startAnimation and resetAnimation functions', () => {
      const { result } = renderHook(() => useStaggeredEntrance({ itemCount: 3, autoStart: false }));

      expect(typeof result.current.startAnimation).toBe('function');
      expect(typeof result.current.resetAnimation).toBe('function');
    });
  });

  describe('autoStart behavior', () => {
    it('starts animation automatically when autoStart is true (default)', () => {
      renderHook(() => useStaggeredEntrance({ itemCount: 3 }));

      // First item should start immediately
      expect(Animated.spring).toHaveBeenCalled();
    });

    it('does not start animation when autoStart is false', () => {
      renderHook(() => useStaggeredEntrance({ itemCount: 3, autoStart: false }));

      expect(Animated.spring).not.toHaveBeenCalled();
    });

    it('does not start animation when itemCount is 0', () => {
      renderHook(() => useStaggeredEntrance({ itemCount: 0 }));

      expect(Animated.spring).not.toHaveBeenCalled();
    });
  });

  describe('stagger timing', () => {
    it('staggers animations with configured delay', () => {
      const { result } = renderHook(() =>
        useStaggeredEntrance({ itemCount: 3, staggerDelay: 100, autoStart: false })
      );

      act(() => {
        result.current.startAnimation();
      });

      // First item starts immediately
      expect(Animated.spring).toHaveBeenCalledTimes(1);

      // Second item after 100ms
      act(() => {
        jest.advanceTimersByTime(100);
      });
      expect(Animated.spring).toHaveBeenCalledTimes(2);

      // Third item after another 100ms (200ms total)
      act(() => {
        jest.advanceTimersByTime(100);
      });
      expect(Animated.spring).toHaveBeenCalledTimes(3);
    });

    it('respects maxDuration cap', () => {
      const { result } = renderHook(() =>
        useStaggeredEntrance({
          itemCount: 20,
          staggerDelay: 100,
          maxDuration: 500, // Cap at 500ms
          autoStart: false,
        })
      );

      act(() => {
        result.current.startAnimation();
      });

      // After 500ms, all items should have started
      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(Animated.spring).toHaveBeenCalledTimes(20);
    });
  });

  describe('getAnimatedStyle', () => {
    it('returns opacity and transform styles', () => {
      const { result } = renderHook(() => useStaggeredEntrance({ itemCount: 3, autoStart: false }));

      const style = result.current.getAnimatedStyle(0);

      expect(style).toHaveProperty('opacity');
      expect(style).toHaveProperty('transform');
      expect(Array.isArray(style.transform)).toBe(true);
    });

    it('returns fallback style for invalid index', () => {
      const { result } = renderHook(() => useStaggeredEntrance({ itemCount: 3, autoStart: false }));

      // Out of bounds index
      const style = result.current.getAnimatedStyle(10);

      expect(style.opacity).toBe(1);
      expect(style.transform).toEqual([{ translateY: 0 }]);
    });

    it('returns fallback style for negative index', () => {
      const { result } = renderHook(() => useStaggeredEntrance({ itemCount: 3, autoStart: false }));

      const style = result.current.getAnimatedStyle(-1);

      expect(style.opacity).toBe(1);
      expect(style.transform).toEqual([{ translateY: 0 }]);
    });
  });

  describe('getAnimationValue', () => {
    it('returns animation value for valid index', () => {
      const { result } = renderHook(() => useStaggeredEntrance({ itemCount: 3, autoStart: false }));

      const value = result.current.getAnimationValue(1);
      expect(value).toBeInstanceOf(Animated.Value);
    });

    it('returns new Animated.Value(1) for invalid index', () => {
      const { result } = renderHook(() => useStaggeredEntrance({ itemCount: 3, autoStart: false }));

      const value = result.current.getAnimationValue(10);
      expect(value).toBeInstanceOf(Animated.Value);
      expect((value as unknown as { _value: number })._value).toBe(1);
    });
  });

  describe('resetAnimation', () => {
    it('resets all animation values to 0', () => {
      const { result } = renderHook(() => useStaggeredEntrance({ itemCount: 3, autoStart: false }));

      // Start and complete animation
      act(() => {
        result.current.startAnimation();
        jest.runAllTimers();
      });

      // Reset
      act(() => {
        result.current.resetAnimation();
      });

      // All values should be back to 0
      for (let i = 0; i < 3; i++) {
        const value = result.current.getAnimationValue(i);
        expect((value as unknown as { _value: number })._value).toBe(0);
      }
    });

    it('clears pending timeouts', () => {
      const { result } = renderHook(() =>
        useStaggeredEntrance({ itemCount: 5, staggerDelay: 100, autoStart: false })
      );

      // Start animation
      act(() => {
        result.current.startAnimation();
      });

      // First item starts immediately
      expect(Animated.spring).toHaveBeenCalledTimes(1);

      // Reset before other timeouts fire
      act(() => {
        result.current.resetAnimation();
      });

      // Clear call count
      mockSpringStart.mockClear();
      (Animated.spring as jest.Mock).mockClear();

      // Advance timers - no more springs should fire
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      expect(Animated.spring).not.toHaveBeenCalled();
    });
  });

  describe('spring configuration', () => {
    it('uses custom spring friction and tension', () => {
      const { result } = renderHook(() =>
        useStaggeredEntrance({
          itemCount: 1,
          springFriction: 10,
          springTension: 80,
          autoStart: false,
        })
      );

      act(() => {
        result.current.startAnimation();
      });

      expect(Animated.spring).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          friction: 10,
          tension: 80,
          useNativeDriver: true,
        })
      );
    });
  });

  describe('cleanup on unmount', () => {
    it('clears timeouts when component unmounts', () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      const { result, unmount } = renderHook(() =>
        useStaggeredEntrance({ itemCount: 5, staggerDelay: 100, autoStart: false })
      );

      // Start animation
      act(() => {
        result.current.startAnimation();
      });

      // Unmount while timeouts are pending
      unmount();

      // clearTimeout should have been called
      expect(clearTimeoutSpy).toHaveBeenCalled();

      clearTimeoutSpy.mockRestore();
    });
  });

  describe('dynamic item count', () => {
    it('handles increasing item count', () => {
      const { result, rerender } = renderHook(
        ({ itemCount }) => useStaggeredEntrance({ itemCount, autoStart: false }),
        { initialProps: { itemCount: 3 } }
      );

      expect(result.current.getAnimationValue(2)).toBeDefined();
      expect(result.current.getAnimationValue(4).constructor.name).toBe('AnimatedValue'); // Fallback

      // Increase count
      rerender({ itemCount: 5 });

      // Should now have values for indices 0-4
      for (let i = 0; i < 5; i++) {
        const value = result.current.getAnimationValue(i);
        expect(value).toBeDefined();
      }
    });
  });
});

describe('StaggeredEntrancePresets', () => {
  it('exports default preset with correct values', () => {
    expect(StaggeredEntrancePresets.default).toEqual({
      staggerDelay: STAGGER_DELAY_DEFAULT,
      slideDistance: 20,
      springFriction: 6,
      springTension: 40,
    });
  });

  it('exports fast preset with shorter delay', () => {
    expect(StaggeredEntrancePresets.fast.staggerDelay).toBe(30);
    expect(StaggeredEntrancePresets.fast.slideDistance).toBe(15);
  });

  it('exports dramatic preset with longer delay', () => {
    expect(StaggeredEntrancePresets.dramatic.staggerDelay).toBe(80);
    expect(StaggeredEntrancePresets.dramatic.slideDistance).toBe(30);
  });

  it('exports subtle preset', () => {
    expect(StaggeredEntrancePresets.subtle.staggerDelay).toBe(40);
    expect(StaggeredEntrancePresets.subtle.slideDistance).toBe(10);
  });
});
