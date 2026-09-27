/**
 * Onboarding transitions must not scale or vertically move screens that sit
 * under the shared, fixed OnboardingHeader.
 *
 * Bug: with the header fixed above the stack, presets that scale the whole
 * screen (ContinentZoom 0.85 -> 1, ZoomReveal, DramaticReveal, Collect,
 * SlideWithScale, and the 0.95 "pushed back" scale on the default slide) or
 * translate it on Y make the content visibly shift underneath the header on
 * every push/pop.
 *
 * Follow-up: replacing those with fades showed the white root background
 * through half-transparent screens, and the gentle (mass 3) springs felt slow.
 * Every header screen now uses ONE iOS-style push: opaque screens, horizontal
 * slide with parallax, a dim on the screen underneath, one snappy spring.
 */

import React from 'react';
import { act, create } from 'react-test-renderer';

import { getOnboardingHeaderConfig } from '@components/onboarding/OnboardingHeader';
import { TRANSITION_SPEC_DEFAULT } from '@navigation/transitionConfig';

type Interpolator = (props: {
  progress: number;
  layouts: { screen: { width: number; height: number } };
}) => {
  contentStyle?: { transform?: Record<string, number>[]; opacity?: number };
};

type Spec = { open: object; close: object };
type Options = { screenStyleInterpolator?: Interpolator; transitionSpec?: Spec };

jest.mock('react-native-screen-transitions/blank-stack', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports and may only use require
  const mockReact = require('react');
  return {
    createBlankStackNavigator: () => ({
      Navigator: (props: Record<string, unknown>) =>
        mockReact.createElement('BlankStackNavigator', props, props.children),
      Screen: (props: Record<string, unknown>) =>
        mockReact.createElement('BlankStackScreen', {
          name: props.name,
          options: props.options,
        }),
    }),
  };
});

jest.mock('@stores/authStore', () => ({
  useAuthStore: (selector: (s: { needsPostSignupFlow: boolean }) => unknown) =>
    selector({ needsPostSignupFlow: false }),
}));

import { OnboardingNavigator } from '@navigation/OnboardingNavigator';

const PROGRESS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const LAYOUTS = { screen: { width: 440, height: 956 } };

function headerScreens() {
  let root: ReturnType<typeof create>;
  act(() => {
    root = create(React.createElement(OnboardingNavigator));
  });
  // @ts-expect-error assigned in act()
  const tree = root;
  const defaults = tree.root.findByType('BlankStackNavigator' as never).props
    .screenOptions as Options;
  return tree.root
    .findAllByType('BlankStackScreen' as never)
    .map((n) => n.props as { name: string; options?: Options })
    .filter((s) => getOnboardingHeaderConfig({ name: s.name }) !== null)
    .map((s) => ({
      name: s.name,
      interpolator: (s.options?.screenStyleInterpolator ??
        defaults.screenStyleInterpolator) as Interpolator,
      spec: (s.options?.transitionSpec ?? defaults.transitionSpec) as Spec,
    }));
}

describe('onboarding motion under the fixed header', () => {
  const screens = headerScreens();

  it('covers the header screens', () => {
    expect(screens.map((s) => s.name)).toEqual(
      expect.arrayContaining(['Motivation', 'HomeCountry', 'ContinentIntro', 'AccountCreation'])
    );
  });

  it.each(screens.map((s) => [s.name, s.interpolator] as const))(
    '%s never scales or moves vertically while entering or exiting',
    (_name, interpolator) => {
      expect(typeof interpolator).toBe('function');
      for (const progress of PROGRESS) {
        const transform =
          interpolator({ progress, layouts: LAYOUTS }).contentStyle?.transform ?? [];
        for (const t of transform) {
          if ('scale' in t) expect([progress, t.scale]).toEqual([progress, 1]);
          if ('scaleX' in t || 'scaleY' in t) throw new Error(`axis scale at ${progress}`);
          if ('translateY' in t) expect([progress, t.translateY]).toEqual([progress, 0]);
        }
      }
    }
  );

  it.each(screens.map((s) => [s.name, s.interpolator] as const))(
    '%s stays fully opaque (no white root background showing through)',
    (_name, interpolator) => {
      for (const progress of PROGRESS) {
        const opacity = interpolator({ progress, layouts: LAYOUTS }).contentStyle?.opacity ?? 1;
        expect([progress, opacity]).toEqual([progress, 1]);
      }
    }
  );

  it('every header screen uses the same push and the same snappy spring', () => {
    const interpolators = new Set(screens.map((s) => s.interpolator));
    const specs = new Set(screens.map((s) => s.spec));
    expect(interpolators.size).toBe(1);
    expect(specs.size).toBe(1);
    const [spec] = specs;
    expect(spec).toEqual(TRANSITION_SPEC_DEFAULT);
  });

  it('the push slides in from the right over a parallaxed, dimmed screen', () => {
    const push = screens[0].interpolator;
    const x = (progress: number) =>
      (push({ progress, layouts: LAYOUTS }).contentStyle?.transform ?? []).find(
        (t) => 'translateX' in t
      )?.translateX;
    expect(x(0)).toBe(LAYOUTS.screen.width);
    expect(x(1)).toBe(0);
    expect(x(2)).toBeLessThan(0);
    expect(x(2)).toBeGreaterThan(-LAYOUTS.screen.width / 2);
  });

  it('paints no dim overlay (it lands on the empty stack background as grey)', () => {
    // detachPreviousScreen detaches the screen directly beneath the top one,
    // so during a push/pop there is no live screen underneath to dim; the
    // overlay only tinted the bare background grey.
    const push = screens[0].interpolator as unknown as (p: Parameters<Interpolator>[0]) => {
      overlayStyle?: { opacity?: number };
    };
    for (const progress of PROGRESS) {
      const opacity = push({ progress, layouts: LAYOUTS }).overlayStyle?.opacity ?? 0;
      expect([progress, opacity]).toEqual([progress, 0]);
    }
  });
});
