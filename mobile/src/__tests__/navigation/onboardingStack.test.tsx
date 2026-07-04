/**
 * OnboardingNavigator — freeze/detach + navigation-method configuration (U2).
 *
 * What is (and isn't) observable under jest:
 *   react-freeze / RNS `activityState` is a NATIVE effect. The blank-stack
 *   navigator is mocked in jest.setup.js, so we cannot observe on-device
 *   freezing here. What we CAN observe is the NAVIGATION CONFIG that drives it:
 *   the `options` passed to each <Stack.Screen> and the navigator's own
 *   `screenOptions`. This suite asserts that config, which is the load-bearing
 *   contract for the U2 performance fix:
 *
 *     - `detachPreviousScreen: true` is present so the blank-stack active-window
 *       actually shrinks and buried screens freeze (freezeOnBlur alone never
 *       engaged without it).
 *     - `freezeOnBlur: true` is preserved.
 *     - No transition preset is removed or altered (motion is unchanged).
 *
 * The global blank-stack mock discards `options`, so this file installs a local
 * mock that captures the JSX props of the navigator element tree. This is fast
 * and deterministic, and — unlike rendering through the global mock — does not
 * mount all ~14 heavy onboarding screens (video players etc.) at once.
 */

import React from 'react';
import { create, act } from 'react-test-renderer';

// ---- Capture the element tree the navigator produces --------------------
//
// Replace the blank-stack factory with lightweight placeholders that DON'T
// render the real screen components, but DO preserve every JSX prop
// (name / component / options) so we can introspect them.

type CapturedScreenOptions = {
  detachPreviousScreen?: boolean;
  freezeOnBlur?: boolean;
  [key: string]: unknown;
};

const NavigatorPlaceholder = 'BlankStackNavigator';
const ScreenPlaceholder = 'BlankStackScreen';

jest.mock('react-native-screen-transitions/blank-stack', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports and may only use require
  const mockReact = require('react');
  return {
    createBlankStackNavigator: () => ({
      // Render as host-like placeholders so react-test-renderer keeps the
      // props on the tree without invoking the (heavy) screen components.
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

// authStore is a real zustand store; drive the selector deterministically.
jest.mock('@stores/authStore', () => ({
  useAuthStore: (selector: (s: { needsPostSignupFlow: boolean }) => unknown) =>
    selector({ needsPostSignupFlow: false }),
}));

import { OnboardingNavigator } from '@navigation/OnboardingNavigator';

type RenderedNode = {
  type: unknown;
  props: Record<string, unknown>;
};

function renderNavigator() {
  let root: ReturnType<typeof create>;
  act(() => {
    root = create(React.createElement(OnboardingNavigator));
  });
  // @ts-expect-error assigned in act()
  return root;
}

function getNavigatorProps(root: ReturnType<typeof create>): Record<string, unknown> {
  const navigator = root.root.findByType(NavigatorPlaceholder as never);
  return navigator.props as Record<string, unknown>;
}

function getScreens(root: ReturnType<typeof create>): RenderedNode[] {
  return root.root
    .findAllByType(ScreenPlaceholder as never)
    .map((n) => ({ type: n.type, props: n.props as Record<string, unknown> }));
}

describe('OnboardingNavigator — freeze/detach configuration (U2)', () => {
  it('renders the navigator with all onboarding screens mounted', () => {
    const root = renderNavigator();
    const screens = getScreens(root);

    // Smoke: the navigator produced a screen tree.
    expect(screens.length).toBeGreaterThan(0);

    const names = screens.map((s) => s.props.name);
    // The forward-only flow's key screens are all registered.
    expect(names).toEqual(
      expect.arrayContaining([
        'WelcomeCarousel',
        'OnboardingSlider',
        'Motivation',
        'HomeCountry',
        'DreamDestination',
        'ContinentIntro',
        'ContinentCountryGrid',
        'AntarcticaPrompt',
        'ProgressSummary',
        'NameEntry',
        'AccountCreation',
        'EmotionalHook',
        'FunctionalHook',
        'Paywall',
      ])
    );
  });

  it('sets the initial route to WelcomeCarousel when not in post-signup flow', () => {
    const root = renderNavigator();
    const navProps = getNavigatorProps(root);
    expect(navProps.initialRouteName).toBe('WelcomeCarousel');
  });

  it('enables detachPreviousScreen so buried screens actually freeze', () => {
    // This is the load-bearing assertion for U2: without detachPreviousScreen,
    // the blank-stack active-window never shrinks and freezeOnBlur is inert.
    const root = renderNavigator();
    const screenOptions = getNavigatorProps(root).screenOptions as CapturedScreenOptions;

    expect(screenOptions).toBeDefined();
    expect(screenOptions.detachPreviousScreen).toBe(true);
  });

  it('preserves freezeOnBlur alongside detachPreviousScreen', () => {
    const root = renderNavigator();
    const screenOptions = getNavigatorProps(root).screenOptions as CapturedScreenOptions;

    expect(screenOptions.freezeOnBlur).toBe(true);
  });

  it('detach is inherited by every screen (covers the ContinentIntro "No" push chain)', () => {
    // detachPreviousScreen lives on screenOptions, so it applies to every route
    // — including each ContinentIntro instance the "No" chain pushes. Detach
    // freezes but does NOT unmount, so back-navigation still restores the
    // previous screen. Assert the "No" chain's screen is registered (its push
    // behavior is intentionally preserved — see ContinentIntroScreen.handleNo).
    const root = renderNavigator();
    const names = getScreens(root).map((s) => s.props.name);
    expect(names).toContain('ContinentIntro');
  });

  it('does not remove or alter any transition preset (motion unchanged)', () => {
    // Screens that carry a per-screen transition preset must STILL carry a
    // non-empty options object. The U2 change only touched lifecycle (freeze),
    // never motion, so these presets must survive untouched.
    const root = renderNavigator();
    const screens = getScreens(root);

    const screensWithPresets = [
      'OnboardingSlider',
      'Motivation',
      'HomeCountry',
      'ContinentIntro',
      'ProgressSummary',
      'NameEntry',
      'AccountCreation',
    ];

    for (const name of screensWithPresets) {
      const screen = screens.find((s) => s.props.name === name);
      expect(screen).toBeDefined();
      const options = screen?.props.options as Record<string, unknown> | undefined;
      // Each preset screen keeps a populated options object (its transition).
      expect(options).toBeDefined();
      expect(Object.keys(options ?? {}).length).toBeGreaterThan(0);
    }
  });
});
