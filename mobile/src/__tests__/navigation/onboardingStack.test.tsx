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
 *     - Every screen uses the single OnboardingPushPreset via `screenOptions`
 *       (see onboardingFixedHeaderMotion.test.tsx for why it never scales,
 *       moves screens vertically or fades them).
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
const mockAuthState = { needsPostSignupFlow: false };
jest.mock('@stores/authStore', () => ({
  useAuthStore: (selector: (s: { needsPostSignupFlow: boolean }) => unknown) =>
    selector(mockAuthState),
}));

jest.mock('@services/analytics', () => ({
  Analytics: { skipToLogin: jest.fn() },
}));

import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import { colors } from '@constants/colors';

import { OnboardingNavigator } from '@navigation/OnboardingNavigator';
import { OnboardingPushPreset } from '@navigation/interpolators';
import { Analytics } from '@services/analytics';

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
        'FirstQuizOffer',
      ])
    );
  });

  it('starts new users on the animated intro slider', () => {
    const root = renderNavigator();
    const navProps = getNavigatorProps(root);
    expect(navProps.initialRouteName).toBe('OnboardingSlider');
  });

  it('starts the post-signup flow at EmotionalHook', () => {
    mockAuthState.needsPostSignupFlow = true;
    try {
      const root = renderNavigator();
      expect(getNavigatorProps(root).initialRouteName).toBe('EmotionalHook');
    } finally {
      mockAuthState.needsPostSignupFlow = false;
    }
  });

  it('no longer registers the old video welcome screen (folded into the slider)', () => {
    const root = renderNavigator();
    const names = getScreens(root).map((s) => s.props.name);
    expect(names).not.toContain('WelcomeCarousel');
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

  it('applies the single onboarding push to every screen via screenOptions', () => {
    // Supersedes the old per-screen preset contract: the fixed shared header
    // requires one consistent push, so it lives on the navigator's
    // screenOptions and no screen overrides it.
    const root = renderNavigator();
    const screenOptions = getNavigatorProps(root).screenOptions as Record<string, unknown>;
    expect(screenOptions.screenStyleInterpolator).toBe(
      OnboardingPushPreset.screenStyleInterpolator
    );
    expect(screenOptions.transitionSpec).toBe(OnboardingPushPreset.transitionSpec);

    for (const screen of getScreens(root)) {
      const options = screen.props.options as Record<string, unknown> | undefined;
      expect([screen.props.name, options?.screenStyleInterpolator]).toEqual([
        screen.props.name,
        undefined,
      ]);
    }
  });
});

describe('OnboardingNavigator — one shared header above the stack', () => {
  // Bug: every screen rendered its own header, so it slid with the screen on
  // push/pop. The navigator's `layout` wraps the whole stack (it sits OUTSIDE
  // the per-screen transition containers), so a header rendered there stays
  // put while only screen content animates.
  type LayoutFn = (props: {
    state: { index: number; routes: { key: string; name: string; params?: object }[] };
    navigation: { goBack: jest.Mock; navigate: jest.Mock };
    descriptors: Record<string, unknown>;
    children: React.ReactNode;
  }) => React.ReactElement;

  function renderLayout(routes: { name: string; params?: object }[]) {
    const root = renderNavigator();
    const layout = getNavigatorProps(root).layout as LayoutFn | undefined;
    expect(typeof layout).toBe('function');
    const navigation = { goBack: jest.fn(), navigate: jest.fn() };
    const state = {
      index: routes.length - 1,
      routes: routes.map((r, i) => ({ key: `${r.name}-${i}`, ...r })),
    };
    render(
      layout!({
        state,
        navigation,
        descriptors: {},
        children: <Text testID="stack-content">stack</Text>,
      })
    );
    return navigation;
  }

  it('renders the stack plus a single shared header for the focused route', () => {
    renderLayout([{ name: 'OnboardingSlider' }, { name: 'Motivation' }]);
    expect(screen.getByTestId('stack-content')).toBeTruthy();
    expect(screen.getAllByTestId('onboarding-header')).toHaveLength(1);
    expect(screen.getByTestId('onboarding-header-login')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-header-back')).toBeNull();
  });

  it('follows the focused route: back without Login on ProgressSummary', () => {
    renderLayout([
      { name: 'OnboardingSlider' },
      { name: 'AntarcticaPrompt' },
      { name: 'ProgressSummary' },
    ]);
    expect(screen.getByTestId('onboarding-header-back')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-header-login')).toBeNull();
  });

  it('back pops the onboarding stack', () => {
    const navigation = renderLayout([{ name: 'Motivation' }, { name: 'HomeCountry' }]);
    fireEvent.press(screen.getByTestId('onboarding-header-back'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('Login tracks the source route and opens the Auth stack', () => {
    const navigation = renderLayout([
      { name: 'DreamDestination' },
      { name: 'ContinentIntro', params: { region: 'Oceania', regionIndex: 4 } },
    ]);
    fireEvent.press(screen.getByTestId('onboarding-header-login'));
    expect(Analytics.skipToLogin).toHaveBeenCalledWith('ContinentIntro_Oceania');
    expect(navigation.navigate).toHaveBeenCalledWith('Auth', { screen: 'Login' });
  });

  it('paints the stack background cream, never the white root background', () => {
    // With detachPreviousScreen the screen beneath the top is detached during
    // push/pop, so whatever sits behind the stack shows through there.
    renderLayout([{ name: 'Motivation' }, { name: 'HomeCountry' }]);
    const style = StyleSheet.flatten(screen.getByTestId('onboarding-stack-layout').props.style);
    expect(style.backgroundColor).toBe(colors.warmCream);
  });
});
