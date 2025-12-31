import {
  SPRING_FRICTION,
  SPRING_TENSION_IN,
  SPRING_TENSION_OUT,
  SPRING_CONFIG_DEFAULT,
  SPRING_CONFIG_SNAPPY,
  SPRING_CONFIG_GENTLE,
  SPRING_CONFIG_BOUNCY,
  TRANSITION_SPEC_DEFAULT,
  TRANSITION_SPEC_SNAPPY,
  TRANSITION_SPEC_MODAL,
  DURATION_MICRO,
  DURATION_STANDARD,
  DURATION_ELABORATE,
  DURATION_CELEBRATION,
  STAGGER_DELAY_DEFAULT,
  STAGGER_DELAY_FAST,
  STAGGER_MAX_DURATION,
  SCALE_PREVIOUS_SCREEN,
  SCALE_PRESS,
  SCALE_LONG_PRESS,
  SCALE_BACKGROUND_SUBTLE,
  OPACITY_BACKGROUND,
  OPACITY_OVERLAY,
  GESTURE_VELOCITY_THRESHOLD,
  GESTURE_RESPONSE_DISTANCE,
  BORDER_RADIUS_CARD,
  BORDER_RADIUS_FULLSCREEN,
} from './transitionConfig';

describe('transitionConfig', () => {
  describe('Spring Constants (aligned with LiquidGlassTabBar)', () => {
    it('exports spring friction value', () => {
      expect(SPRING_FRICTION).toBe(8);
    });

    it('exports spring tension for press-in', () => {
      expect(SPRING_TENSION_IN).toBe(400);
    });

    it('exports spring tension for press-out', () => {
      expect(SPRING_TENSION_OUT).toBe(300);
    });
  });

  describe('Spring Configs', () => {
    it('exports default spring config with required properties', () => {
      expect(SPRING_CONFIG_DEFAULT).toEqual({
        stiffness: 1000,
        damping: 500,
        mass: 3,
      });
    });

    it('exports snappy spring config with higher stiffness', () => {
      expect(SPRING_CONFIG_SNAPPY.stiffness).toBeGreaterThan(SPRING_CONFIG_DEFAULT.stiffness);
      expect(SPRING_CONFIG_SNAPPY).toHaveProperty('damping');
      expect(SPRING_CONFIG_SNAPPY).toHaveProperty('mass');
    });

    it('exports gentle spring config with lower stiffness', () => {
      expect(SPRING_CONFIG_GENTLE.stiffness).toBeLessThan(SPRING_CONFIG_DEFAULT.stiffness);
    });

    it('exports bouncy spring config with lower damping for overshoot', () => {
      expect(SPRING_CONFIG_BOUNCY.damping).toBeLessThan(SPRING_CONFIG_DEFAULT.damping);
    });
  });

  describe('Transition Specs', () => {
    it('exports default transition spec with open and close configs', () => {
      expect(TRANSITION_SPEC_DEFAULT).toHaveProperty('open');
      expect(TRANSITION_SPEC_DEFAULT).toHaveProperty('close');
      expect(TRANSITION_SPEC_DEFAULT.open).toEqual(SPRING_CONFIG_DEFAULT);
      expect(TRANSITION_SPEC_DEFAULT.close).toEqual(SPRING_CONFIG_DEFAULT);
    });

    it('exports snappy transition spec', () => {
      expect(TRANSITION_SPEC_SNAPPY.open).toEqual(SPRING_CONFIG_SNAPPY);
    });

    it('exports modal transition spec with gentle timing', () => {
      expect(TRANSITION_SPEC_MODAL.open).toEqual(SPRING_CONFIG_GENTLE);
    });
  });

  describe('Timing Constants', () => {
    it('exports duration values in ascending order', () => {
      expect(DURATION_MICRO).toBeLessThan(DURATION_STANDARD);
      expect(DURATION_STANDARD).toBeLessThan(DURATION_ELABORATE);
      expect(DURATION_ELABORATE).toBeLessThan(DURATION_CELEBRATION);
    });

    it('exports micro duration as 150ms for quick interactions', () => {
      expect(DURATION_MICRO).toBe(150);
    });

    it('exports standard duration as 300ms', () => {
      expect(DURATION_STANDARD).toBe(300);
    });
  });

  describe('Stagger Constants', () => {
    it('exports default stagger delay', () => {
      expect(STAGGER_DELAY_DEFAULT).toBe(50);
    });

    it('exports fast stagger delay as smaller than default', () => {
      expect(STAGGER_DELAY_FAST).toBeLessThan(STAGGER_DELAY_DEFAULT);
    });

    it('exports max stagger duration', () => {
      expect(STAGGER_MAX_DURATION).toBe(1500);
    });
  });

  describe('Scale Constants', () => {
    it('exports previous screen scale for depth effect', () => {
      expect(SCALE_PREVIOUS_SCREEN).toBe(0.95);
      expect(SCALE_PREVIOUS_SCREEN).toBeLessThan(1);
      expect(SCALE_PREVIOUS_SCREEN).toBeGreaterThan(0.9);
    });

    it('exports press scale for touch feedback', () => {
      expect(SCALE_PRESS).toBe(0.96);
    });

    it('exports long press scale as more reduced than regular press', () => {
      expect(SCALE_LONG_PRESS).toBeLessThan(SCALE_PRESS);
    });

    it('exports subtle background scale', () => {
      expect(SCALE_BACKGROUND_SUBTLE).toBe(0.98);
    });
  });

  describe('Opacity Constants', () => {
    it('exports background opacity for transitions', () => {
      expect(OPACITY_BACKGROUND).toBe(0.95);
      expect(OPACITY_BACKGROUND).toBeLessThan(1);
      expect(OPACITY_BACKGROUND).toBeGreaterThan(0.5);
    });

    it('exports overlay opacity for modals', () => {
      expect(OPACITY_OVERLAY).toBe(0.5);
    });
  });

  describe('Gesture Constants', () => {
    it('exports velocity threshold for swipe dismissal', () => {
      expect(GESTURE_VELOCITY_THRESHOLD).toBe(500);
    });

    it('exports response distance for gesture activation', () => {
      expect(GESTURE_RESPONSE_DISTANCE).toBe(50);
    });
  });

  describe('Border Radius Constants', () => {
    it('exports card border radius', () => {
      expect(BORDER_RADIUS_CARD).toBe(16);
    });

    it('exports fullscreen border radius as 0', () => {
      expect(BORDER_RADIUS_FULLSCREEN).toBe(0);
    });
  });
});
