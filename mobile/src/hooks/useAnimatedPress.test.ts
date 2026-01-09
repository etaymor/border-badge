import { renderHook, act } from '@testing-library/react-native';
import { Animated } from 'react-native';

import { useAnimatedPress, AnimatedPressPresets } from './useAnimatedPress';
import { SCALE_PRESS } from '../navigation/transitionConfig';

// Mock Animated.spring to track calls
const mockSpringStart = jest.fn();
jest.spyOn(Animated, 'spring').mockImplementation(
  () =>
    ({
      start: mockSpringStart,
    }) as unknown as Animated.CompositeAnimation
);

describe('useAnimatedPress', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('returns scaleValue initialized to 1', () => {
      const { result } = renderHook(() => useAnimatedPress());

      // Access the internal value via __getValue (test helper)
      const value = (result.current.scaleValue as unknown as { _value: number })._value;
      expect(value).toBe(1);
    });

    it('returns pressHandlers object with onPressIn and onPressOut', () => {
      const { result } = renderHook(() => useAnimatedPress());

      expect(result.current.pressHandlers).toHaveProperty('onPressIn');
      expect(result.current.pressHandlers).toHaveProperty('onPressOut');
      expect(typeof result.current.pressHandlers.onPressIn).toBe('function');
      expect(typeof result.current.pressHandlers.onPressOut).toBe('function');
    });

    it('returns animatePressIn and animatePressOut functions', () => {
      const { result } = renderHook(() => useAnimatedPress());

      expect(typeof result.current.animatePressIn).toBe('function');
      expect(typeof result.current.animatePressOut).toBe('function');
    });
  });

  describe('press animations', () => {
    it('calls Animated.spring with pressedScale on press in', () => {
      const { result } = renderHook(() => useAnimatedPress());

      act(() => {
        result.current.pressHandlers.onPressIn();
      });

      expect(Animated.spring).toHaveBeenCalledWith(
        result.current.scaleValue,
        expect.objectContaining({
          toValue: SCALE_PRESS,
          useNativeDriver: true,
        })
      );
      expect(mockSpringStart).toHaveBeenCalled();
    });

    it('calls Animated.spring with 1 on press out', () => {
      const { result } = renderHook(() => useAnimatedPress());

      act(() => {
        result.current.pressHandlers.onPressOut();
      });

      expect(Animated.spring).toHaveBeenCalledWith(
        result.current.scaleValue,
        expect.objectContaining({
          toValue: 1,
          useNativeDriver: true,
        })
      );
    });

    it('uses custom pressedScale when provided', () => {
      const customScale = 0.92;
      const { result } = renderHook(() => useAnimatedPress({ pressedScale: customScale }));

      act(() => {
        result.current.animatePressIn();
      });

      expect(Animated.spring).toHaveBeenCalledWith(
        result.current.scaleValue,
        expect.objectContaining({
          toValue: customScale,
        })
      );
    });
  });

  describe('disabled state', () => {
    it('does not animate when disabled', () => {
      const { result } = renderHook(() => useAnimatedPress({ disabled: true }));

      act(() => {
        result.current.pressHandlers.onPressIn();
      });

      expect(Animated.spring).not.toHaveBeenCalled();

      act(() => {
        result.current.pressHandlers.onPressOut();
      });

      expect(Animated.spring).not.toHaveBeenCalled();
    });
  });

  describe('manual animation triggers', () => {
    it('animatePressIn triggers same animation as onPressIn', () => {
      const { result } = renderHook(() => useAnimatedPress());

      act(() => {
        result.current.animatePressIn();
      });

      expect(Animated.spring).toHaveBeenCalledWith(
        result.current.scaleValue,
        expect.objectContaining({
          toValue: SCALE_PRESS,
        })
      );
    });

    it('animatePressOut triggers same animation as onPressOut', () => {
      const { result } = renderHook(() => useAnimatedPress());

      act(() => {
        result.current.animatePressOut();
      });

      expect(Animated.spring).toHaveBeenCalledWith(
        result.current.scaleValue,
        expect.objectContaining({
          toValue: 1,
        })
      );
    });
  });

  describe('cleanup', () => {
    it('stops animation and resets value on unmount', () => {
      const stopAnimationSpy = jest.fn();
      const setValueSpy = jest.fn();

      // We need to spy on the actual Animated.Value methods
      jest.spyOn(Animated.Value.prototype, 'stopAnimation').mockImplementation(stopAnimationSpy);
      jest.spyOn(Animated.Value.prototype, 'setValue').mockImplementation(setValueSpy);

      const { unmount } = renderHook(() => useAnimatedPress());

      unmount();

      expect(stopAnimationSpy).toHaveBeenCalled();
      expect(setValueSpy).toHaveBeenCalledWith(1);

      // Restore mocks
      jest.restoreAllMocks();
    });
  });
});

describe('AnimatedPressPresets', () => {
  it('exports default preset with SCALE_PRESS', () => {
    expect(AnimatedPressPresets.default.pressedScale).toBe(SCALE_PRESS);
  });

  it('exports subtle preset with 0.98 scale', () => {
    expect(AnimatedPressPresets.subtle.pressedScale).toBe(0.98);
  });

  it('exports strong preset with 0.94 scale', () => {
    expect(AnimatedPressPresets.strong.pressedScale).toBe(0.94);
  });

  it('exports tabBar preset with 0.9 scale', () => {
    expect(AnimatedPressPresets.tabBar.pressedScale).toBe(0.9);
  });
});
