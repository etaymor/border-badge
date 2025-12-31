import {
  SPRING_FRICTION,
  SPRING_TENSION_IN,
  SPRING_TENSION_OUT,
  SPRING_CONFIG_DEFAULT,
  SPRING_CONFIG_GENTLE,
  SPRING_CONFIG_BOUNCY,
  TRANSITION_SPEC_DEFAULT,
  STAGGER_DELAY_DEFAULT,
  STAGGER_MAX_DURATION,
  SCALE_PREVIOUS_SCREEN,
  SCALE_PRESS,
  OPACITY_BACKGROUND,
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
  });

  describe('Stagger Constants', () => {
    it('exports default stagger delay', () => {
      expect(STAGGER_DELAY_DEFAULT).toBe(50);
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
  });

  describe('Opacity Constants', () => {
    it('exports background opacity for transitions', () => {
      expect(OPACITY_BACKGROUND).toBe(0.95);
      expect(OPACITY_BACKGROUND).toBeLessThan(1);
      expect(OPACITY_BACKGROUND).toBeGreaterThan(0.5);
    });
  });
});
