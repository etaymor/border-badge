/**
 * OnboardingHeader — the single header shared by the whole onboarding stack.
 *
 * Bug being fixed: every onboarding screen used to render its own header
 * (back + ATLASI logo + Login), so the header slid along with the screen on
 * every push/pop. The stack now renders ONE header above its screens, and each
 * route only declares what it wants in it. These tests pin that per-route
 * contract and the "never paints a background" rule (ContinentIntro and
 * AntarcticaPrompt have their own background colors that must show through).
 */

import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import {
  getOnboardingHeaderConfig,
  ONBOARDING_HEADER_HEIGHT,
  OnboardingHeader,
  OnboardingHeaderSpacer,
} from '@components/onboarding/OnboardingHeader';

const mockAuthState: { session: object | null } = { session: null };
jest.mock('@stores/authStore', () => ({
  useAuthStore: (selector: (s: { session: object | null }) => unknown) => selector(mockAuthState),
}));

type TestRoute = { key: string; name: string; params?: object };

function route(name: string, params?: object): TestRoute {
  return { key: `${name}-key`, name, params };
}

function renderHeader(r: TestRoute, canGoBack = true) {
  const onBack = jest.fn();
  const onLogin = jest.fn();
  render(<OnboardingHeader route={r} canGoBack={canGoBack} onBack={onBack} onLogin={onLogin} />);
  return { onBack, onLogin };
}

const BACK = 'onboarding-header-back';
const LOGIN = 'onboarding-header-login';
const LOGO = 'onboarding-header-logo';

afterEach(() => {
  mockAuthState.session = null;
});

describe('getOnboardingHeaderConfig', () => {
  it.each([
    // [route, showBack, showLogin]
    ['Motivation', false, true],
    ['TrackingPreference', true, true],
    ['HomeCountry', true, true],
    ['DreamDestination', true, true],
    ['AntarcticaPrompt', true, true],
    ['ProgressSummary', true, false],
    ['NameEntry', false, false],
    ['AccountCreation', false, false],
    ['EmotionalHook', false, true],
    ['FunctionalHook', true, true],
  ])('%s -> back=%s login=%s', (name, showBack, showLogin) => {
    expect(getOnboardingHeaderConfig(route(name))).toEqual(
      expect.objectContaining({ showBack, showLogin })
    );
  });

  it('ContinentIntro shows back + login and tags login analytics with the region', () => {
    expect(
      getOnboardingHeaderConfig(route('ContinentIntro', { region: 'Asia', regionIndex: 2 }))
    ).toEqual({ showBack: true, showLogin: true, loginSource: 'ContinentIntro_Asia' });
  });

  it.each(['OnboardingSlider', 'ContinentCountryGrid', 'Paywall', 'FirstQuizOffer'])(
    '%s has no shared header (it owns its own chrome or none)',
    (name) => {
      expect(getOnboardingHeaderConfig(route(name))).toBeNull();
    }
  );
});

describe('OnboardingHeader', () => {
  it('Motivation: logo + Login, no back button', () => {
    renderHeader(route('Motivation'));
    expect(screen.getByTestId(LOGO)).toBeTruthy();
    expect(screen.getByTestId(LOGIN)).toBeTruthy();
    expect(screen.queryByTestId(BACK)).toBeNull();
  });

  it('ProgressSummary: back button, no Login', () => {
    renderHeader(route('ProgressSummary'));
    expect(screen.getByTestId(BACK)).toBeTruthy();
    expect(screen.queryByTestId(LOGIN)).toBeNull();
  });

  it('NameEntry: logo only', () => {
    renderHeader(route('NameEntry'));
    expect(screen.getByTestId(LOGO)).toBeTruthy();
    expect(screen.queryByTestId(BACK)).toBeNull();
    expect(screen.queryByTestId(LOGIN)).toBeNull();
  });

  it('hides the back button when there is nothing to go back to', () => {
    renderHeader(route('AntarcticaPrompt'), false);
    expect(screen.queryByTestId(BACK)).toBeNull();
  });

  it('hides Login once the user has a session', () => {
    mockAuthState.session = { user: { id: 'u1' } };
    renderHeader(route('FunctionalHook'));
    expect(screen.queryByTestId(LOGIN)).toBeNull();
    expect(screen.getByTestId(BACK)).toBeTruthy();
  });

  it('renders no buttons on routes without a shared header', () => {
    renderHeader(route('OnboardingSlider'));
    expect(screen.queryByTestId(BACK)).toBeNull();
    expect(screen.queryByTestId(LOGIN)).toBeNull();
  });

  it('mounts the logo only on routes that want the header (Slider -> Motivation)', () => {
    // Bug: the header was kept mounted at opacity 0 behind a shared value on
    // the intro slider, and never faded back in on Motivation. Visibility must
    // follow the route by mounting/unmounting, not by a hand-driven opacity.
    const props = { canGoBack: false, onBack: jest.fn(), onLogin: jest.fn() };
    const { rerender } = render(<OnboardingHeader route={route('OnboardingSlider')} {...props} />);
    expect(screen.queryByTestId(LOGO)).toBeNull();

    rerender(<OnboardingHeader route={route('Motivation')} {...props} />);
    expect(screen.getByTestId(LOGO)).toBeTruthy();
    expect(screen.getByTestId(LOGIN)).toBeTruthy();

    rerender(<OnboardingHeader route={route('ContinentCountryGrid')} {...props} />);
    expect(screen.queryByTestId(LOGO)).toBeNull();
  });

  it('wires back and login (with the route analytics source)', () => {
    const { onBack, onLogin } = renderHeader(
      route('ContinentIntro', { region: 'Europe', regionIndex: 3 })
    );
    fireEvent.press(screen.getByTestId(BACK));
    expect(onBack).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId(LOGIN));
    expect(onLogin).toHaveBeenCalledWith('ContinentIntro_Europe');
  });

  it('never paints a background over the screen beneath it', () => {
    renderHeader(route('ContinentIntro', { region: 'Africa', regionIndex: 0 }));
    const style = StyleSheet.flatten(screen.getByTestId('onboarding-header').props.style) ?? {};
    expect(style.backgroundColor ?? 'transparent').toBe('transparent');
    expect(style.position).toBe('absolute');
  });
});

describe('OnboardingHeaderSpacer', () => {
  it('reserves exactly the header height so screen content starts below it', () => {
    render(<OnboardingHeaderSpacer />);
    const style = StyleSheet.flatten(screen.getByTestId('onboarding-header-spacer').props.style);
    expect(style.height).toBe(ONBOARDING_HEADER_HEIGHT);
  });
});
