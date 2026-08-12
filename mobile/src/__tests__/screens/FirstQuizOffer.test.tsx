/**
 * U12: "make your first quiz" post-paywall offer.
 *
 * The settled onboarding order (docs/ONBOARDING_PAYWALL_FIX.md) is untouched:
 * account creation still precedes the paywall, and needsPostSignupFlow keeps
 * the user inside OnboardingNavigator. The offer APPENDS after the paywall:
 *
 *   Paywall -> FirstQuizOffer -> (accept) QuizCreation on top of Main
 *                             -> (skip)   Main home, exactly as today
 *
 * Under test:
 * - PaywallScreen hands off to FirstQuizOffer instead of finishing the flow
 *   itself (needsPostSignupFlow stays true across the handoff).
 * - FirstQuizOfferScreen finishes onboarding on BOTH paths; accept
 *   additionally arms the one-shot pendingFirstQuizLaunch flag.
 * - useFirstQuizLaunch consumes the flag from inside Main (navigate once,
 *   clear); existing users -- whose flag is never set -- never navigate.
 */

import { act, fireEvent, render, screen, waitFor } from '../utils/testUtils';
import { renderHook } from '@testing-library/react-native';

import { useAuthStore } from '@stores/authStore';

import type { OnboardingStackScreenProps } from '@navigation/types';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

jest.mock('@services/analytics', () => ({
  Analytics: {
    firstQuizOfferShown: jest.fn(),
    firstQuizOfferAccepted: jest.fn(),
    firstQuizOfferSkipped: jest.fn(),
    paywallDismissed: jest.fn(),
  },
}));

jest.mock('@hooks/useCountries', () => ({
  invalidateCountriesCache: jest.fn(),
}));

const mockPresentPaywall = jest.fn();
jest.mock('@hooks/usePaywallPresentation', () => ({
  usePaywallPresentation: () => ({ presentPaywall: mockPresentPaywall }),
}));

import { useFirstQuizLaunch } from '@hooks/useFirstQuizLaunch';
import { FirstQuizOfferScreen } from '@screens/onboarding/FirstQuizOfferScreen';
import { PaywallScreen } from '@screens/onboarding/PaywallScreen';
import { Analytics } from '@services/analytics';

function renderOffer() {
  const props = {
    navigation: { navigate: jest.fn(), goBack: jest.fn() },
    route: { key: 'test', name: 'FirstQuizOffer' },
  } as unknown as OnboardingStackScreenProps<'FirstQuizOffer'>;
  return render(<FirstQuizOfferScreen {...props} />);
}

describe('FirstQuizOfferScreen (post-paywall new-user offer)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      session: null,
      hasCompletedOnboarding: false,
      isLoading: false,
      isMigrating: false,
      needsPostSignupFlow: true,
      pendingFirstQuizLaunch: false,
    });
  });

  it('tracks the offer impression on mount', () => {
    renderOffer();
    expect(Analytics.firstQuizOfferShown).toHaveBeenCalledTimes(1);
  });

  it('accept arms the first-quiz launch and finishes onboarding', async () => {
    renderOffer();

    fireEvent.press(screen.getByTestId('first-quiz-offer-accept'));

    await waitFor(() => {
      expect(useAuthStore.getState().needsPostSignupFlow).toBe(false);
    });
    expect(useAuthStore.getState().pendingFirstQuizLaunch).toBe(true);
    expect(useAuthStore.getState().hasCompletedOnboarding).toBe(true);
    expect(Analytics.firstQuizOfferAccepted).toHaveBeenCalledTimes(1);
  });

  it('skip finishes onboarding to home without arming the launch', async () => {
    renderOffer();

    fireEvent.press(screen.getByTestId('first-quiz-offer-skip'));

    await waitFor(() => {
      expect(useAuthStore.getState().needsPostSignupFlow).toBe(false);
    });
    expect(useAuthStore.getState().pendingFirstQuizLaunch).toBe(false);
    expect(useAuthStore.getState().hasCompletedOnboarding).toBe(true);
    expect(Analytics.firstQuizOfferSkipped).toHaveBeenCalledTimes(1);
  });
});

describe('PaywallScreen hands off to the offer (order preserved)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPresentPaywall.mockResolvedValue({ cancelled: false, error: undefined });
    useAuthStore.setState({
      session: null,
      hasCompletedOnboarding: false,
      isLoading: false,
      isMigrating: false,
      needsPostSignupFlow: true,
      pendingFirstQuizLaunch: false,
    });
  });

  it('replaces to FirstQuizOffer after the paywall resolves, leaving the flow open', async () => {
    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
    } as unknown as OnboardingStackScreenProps<'Paywall'>['navigation'];
    const route = {
      key: 'test',
      name: 'Paywall',
    } as OnboardingStackScreenProps<'Paywall'>['route'];

    render(<PaywallScreen navigation={navigation} route={route} />);

    // The paywall is consumed on present and cannot re-present; it hands off
    // with replace so a back-swipe from the offer cannot land on a spent,
    // blank paywall.
    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith('FirstQuizOffer');
    });
    expect(navigation.navigate).not.toHaveBeenCalledWith('FirstQuizOffer');
    // The offer screen owns the finish: the paywall itself must not close
    // the post-signup flow (that is what keeps the settled order intact).
    expect(useAuthStore.getState().needsPostSignupFlow).toBe(true);
    expect(useAuthStore.getState().pendingFirstQuizLaunch).toBe(false);
  });
});

describe('useFirstQuizLaunch (consumed from inside Main)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      session: null,
      hasCompletedOnboarding: true,
      isLoading: false,
      isMigrating: false,
      needsPostSignupFlow: false,
      pendingFirstQuizLaunch: false,
    });
  });

  it('navigates to QuizCreation exactly once and clears the flag', () => {
    act(() => {
      useAuthStore.getState().setPendingFirstQuizLaunch(true);
    });
    const { rerender } = renderHook(() => useFirstQuizLaunch());

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('QuizCreation');
    expect(useAuthStore.getState().pendingFirstQuizLaunch).toBe(false);

    rerender(undefined);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it('does nothing for existing users (flag never armed)', () => {
    renderHook(() => useFirstQuizLaunch());
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(useAuthStore.getState().pendingFirstQuizLaunch).toBe(false);
  });

  it('signOut disarms a pending launch', () => {
    act(() => {
      useAuthStore.getState().setPendingFirstQuizLaunch(true);
      useAuthStore.getState().signOut();
    });
    expect(useAuthStore.getState().pendingFirstQuizLaunch).toBe(false);
  });
});
