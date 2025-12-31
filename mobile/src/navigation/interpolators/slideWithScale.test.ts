import {
  slideWithScaleInterpolator,
  SlideWithScalePreset,
  SlideWithScaleNoGesturePreset,
} from './slideWithScale';
import { TRANSITION_SPEC_DEFAULT } from '../transitionConfig';

// Mock react-native-reanimated's interpolate function
jest.mock('react-native-reanimated', () => ({
  interpolate: (progress: number, inputRange: number[], outputRange: number[]) => {
    // Simple linear interpolation for testing
    const [i0, i1, i2] = inputRange;
    const [o0, o1, o2] = outputRange;

    if (progress <= i1) {
      const ratio = (progress - i0) / (i1 - i0);
      return o0 + ratio * (o1 - o0);
    } else {
      const ratio = (progress - i1) / (i2 - i1);
      return o1 + ratio * (o2 - o1);
    }
  },
}));

describe('slideWithScaleInterpolator', () => {
  const mockScreen = { width: 400, height: 800 };
  const mockLayouts = { screen: mockScreen };

  describe('at progress 0 (entering screen)', () => {
    it('positions screen off-screen to the right', () => {
      const result = slideWithScaleInterpolator({
        progress: 0,
        layouts: mockLayouts,
      });

      expect(result.contentStyle.transform).toContainEqual({
        translateX: mockScreen.width,
      });
    });

    it('keeps scale at 1', () => {
      const result = slideWithScaleInterpolator({
        progress: 0,
        layouts: mockLayouts,
      });

      expect(result.contentStyle.transform).toContainEqual({ scale: 1 });
    });

    it('keeps opacity at 1', () => {
      const result = slideWithScaleInterpolator({
        progress: 0,
        layouts: mockLayouts,
      });

      expect(result.contentStyle.opacity).toBe(1);
    });
  });

  describe('at progress 1 (visible screen)', () => {
    it('positions screen at center (translateX = 0)', () => {
      const result = slideWithScaleInterpolator({
        progress: 1,
        layouts: mockLayouts,
      });

      expect(result.contentStyle.transform).toContainEqual({ translateX: 0 });
    });

    it('keeps scale at 1', () => {
      const result = slideWithScaleInterpolator({
        progress: 1,
        layouts: mockLayouts,
      });

      expect(result.contentStyle.transform).toContainEqual({ scale: 1 });
    });

    it('keeps opacity at 1', () => {
      const result = slideWithScaleInterpolator({
        progress: 1,
        layouts: mockLayouts,
      });

      expect(result.contentStyle.opacity).toBe(1);
    });
  });

  describe('at progress 2 (exiting screen / previous screen)', () => {
    it('positions screen partially to the left', () => {
      const result = slideWithScaleInterpolator({
        progress: 2,
        layouts: mockLayouts,
      });

      const translateXTransform = result.contentStyle.transform.find(
        (t: { translateX?: number }) => 'translateX' in t
      );
      expect(translateXTransform?.translateX).toBeLessThan(0);
      expect(translateXTransform?.translateX).toBe(-mockScreen.width * 0.3);
    });

    it('scales down to 0.95', () => {
      const result = slideWithScaleInterpolator({
        progress: 2,
        layouts: mockLayouts,
      });

      expect(result.contentStyle.transform).toContainEqual({ scale: 0.95 });
    });

    it('fades opacity to 0.95', () => {
      const result = slideWithScaleInterpolator({
        progress: 2,
        layouts: mockLayouts,
      });

      expect(result.contentStyle.opacity).toBe(0.95);
    });
  });

  describe('return structure', () => {
    it('returns contentStyle with transform and opacity', () => {
      const result = slideWithScaleInterpolator({
        progress: 0.5,
        layouts: mockLayouts,
      });

      expect(result).toHaveProperty('contentStyle');
      expect(result.contentStyle).toHaveProperty('transform');
      expect(result.contentStyle).toHaveProperty('opacity');
      expect(Array.isArray(result.contentStyle.transform)).toBe(true);
    });

    it('includes both translateX and scale transforms', () => {
      const result = slideWithScaleInterpolator({
        progress: 0.5,
        layouts: mockLayouts,
      });

      const hasTranslateX = result.contentStyle.transform.some(
        (t: { translateX?: number }) => 'translateX' in t
      );
      const hasScale = result.contentStyle.transform.some((t: { scale?: number }) => 'scale' in t);

      expect(hasTranslateX).toBe(true);
      expect(hasScale).toBe(true);
    });
  });
});

describe('SlideWithScalePreset', () => {
  it('includes screenStyleInterpolator', () => {
    expect(SlideWithScalePreset).toHaveProperty('screenStyleInterpolator');
    expect(typeof SlideWithScalePreset.screenStyleInterpolator).toBe('function');
  });

  it('includes transitionSpec matching default config', () => {
    expect(SlideWithScalePreset).toHaveProperty('transitionSpec');
    expect(SlideWithScalePreset.transitionSpec).toEqual(TRANSITION_SPEC_DEFAULT);
  });

  it('enables gestures', () => {
    expect(SlideWithScalePreset.gestureEnabled).toBe(true);
  });

  it('sets horizontal gesture direction', () => {
    expect(SlideWithScalePreset.gestureDirection).toBe('horizontal');
  });
});

describe('SlideWithScaleNoGesturePreset', () => {
  it('includes screenStyleInterpolator', () => {
    expect(SlideWithScaleNoGesturePreset).toHaveProperty('screenStyleInterpolator');
  });

  it('disables gestures', () => {
    expect(SlideWithScaleNoGesturePreset.gestureEnabled).toBe(false);
  });

  it('uses same transition spec as default preset', () => {
    expect(SlideWithScaleNoGesturePreset.transitionSpec).toEqual(
      SlideWithScalePreset.transitionSpec
    );
  });
});
