import {
  sharedCountryInterpolator,
  SharedCountryPreset,
} from '@navigation/interpolators/sharedCountry';
import { SCALE_PREVIOUS_SCREEN, OPACITY_BACKGROUND } from '@navigation/transitionConfig';

describe('sharedCountryInterpolator', () => {
  const mockScreen = { width: 400, height: 800 };
  const createContext = (progress: number) => ({
    progress,
    layouts: { screen: mockScreen },
  });

  describe('content transitions', () => {
    it('positions incoming screen off-screen right at progress 0', () => {
      const result = sharedCountryInterpolator(createContext(0));
      const transform = result.contentStyle?.transform as Array<{ translateX?: number }>;
      const translateX = transform?.find((t) => 'translateX' in t)?.translateX;

      expect(translateX).toBe(mockScreen.width);
    });

    it('positions screen at center at progress 1', () => {
      const result = sharedCountryInterpolator(createContext(1));
      const transform = result.contentStyle?.transform as Array<{ translateX?: number }>;
      const translateX = transform?.find((t) => 'translateX' in t)?.translateX;

      expect(translateX).toBe(0);
    });

    it('positions previous screen to the left at progress 2', () => {
      const result = sharedCountryInterpolator(createContext(2));
      const transform = result.contentStyle?.transform as Array<{ translateX?: number }>;
      const translateX = transform?.find((t) => 'translateX' in t)?.translateX;

      expect(translateX).toBe(-mockScreen.width * 0.3);
    });
  });

  describe('scale transitions', () => {
    it('maintains full scale at progress 0 and 1', () => {
      const result0 = sharedCountryInterpolator(createContext(0));
      const result1 = sharedCountryInterpolator(createContext(1));

      const getScale = (result: ReturnType<typeof sharedCountryInterpolator>) => {
        const transform = result.contentStyle?.transform as Array<{ scale?: number }>;
        return transform?.find((t) => 'scale' in t)?.scale;
      };

      expect(getScale(result0)).toBe(1);
      expect(getScale(result1)).toBe(1);
    });

    it('scales down previous screen at progress 2', () => {
      const result = sharedCountryInterpolator(createContext(2));
      const transform = result.contentStyle?.transform as Array<{ scale?: number }>;
      const scale = transform?.find((t) => 'scale' in t)?.scale;

      expect(scale).toBe(SCALE_PREVIOUS_SCREEN);
    });
  });

  describe('opacity transitions', () => {
    it('maintains full opacity at progress 0 and 1', () => {
      const result0 = sharedCountryInterpolator(createContext(0));
      const result1 = sharedCountryInterpolator(createContext(1));

      expect(result0.contentStyle?.opacity).toBe(1);
      expect(result1.contentStyle?.opacity).toBe(1);
    });

    it('fades previous screen at progress 2', () => {
      const result = sharedCountryInterpolator(createContext(2));
      expect(result.contentStyle?.opacity).toBe(OPACITY_BACKGROUND);
    });
  });

  describe('overlay transitions', () => {
    it('has no overlay at progress 0', () => {
      const result = sharedCountryInterpolator(createContext(0));
      expect(result.overlayStyle?.opacity).toBe(0);
    });

    it('shows subtle overlay at progress 1', () => {
      const result = sharedCountryInterpolator(createContext(1));
      expect(result.overlayStyle?.opacity).toBe(0.15);
    });

    it('hides overlay at progress 2', () => {
      const result = sharedCountryInterpolator(createContext(2));
      expect(result.overlayStyle?.opacity).toBe(0);
    });

    it('overlay is black', () => {
      const result = sharedCountryInterpolator(createContext(1));
      expect(result.overlayStyle?.backgroundColor).toBe('black');
    });
  });

  describe('interpolation at midpoints', () => {
    it('interpolates smoothly at progress 0.5', () => {
      const result = sharedCountryInterpolator(createContext(0.5));
      const transform = result.contentStyle?.transform as Array<{
        translateX?: number;
        scale?: number;
      }>;
      const translateX = transform?.find((t) => 'translateX' in t)?.translateX;

      // At 0.5, should be halfway between screen.width and 0
      expect(translateX).toBe(mockScreen.width * 0.5);
    });

    it('interpolates smoothly at progress 1.5', () => {
      const result = sharedCountryInterpolator(createContext(1.5));
      const transform = result.contentStyle?.transform as Array<{ scale?: number }>;
      const scale = transform?.find((t) => 'scale' in t)?.scale;

      // At 1.5, should be halfway between 1 and SCALE_PREVIOUS_SCREEN
      const expectedScale = 1 + (SCALE_PREVIOUS_SCREEN - 1) * 0.5;
      expect(scale).toBeCloseTo(expectedScale, 4);
    });
  });
});

describe('SharedCountryPreset', () => {
  it('uses sharedCountryInterpolator as screen style interpolator', () => {
    expect(SharedCountryPreset.screenStyleInterpolator).toBe(sharedCountryInterpolator);
  });

  it('enables gestures', () => {
    expect(SharedCountryPreset.gestureEnabled).toBe(true);
  });

  it('uses horizontal gesture direction', () => {
    expect(SharedCountryPreset.gestureDirection).toBe('horizontal');
  });

  it('has transition spec configured', () => {
    expect(SharedCountryPreset.transitionSpec).toBeDefined();
    expect(SharedCountryPreset.transitionSpec?.open).toBeDefined();
    expect(SharedCountryPreset.transitionSpec?.close).toBeDefined();
  });
});
