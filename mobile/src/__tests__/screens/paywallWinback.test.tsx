/**
 * Paywall close -> winback trigger, on both paywall screens.
 *
 * Closing the standard paywall without buying presents the one-time winback
 * (useWinbackOffer owns eligibility and once-per-trigger); a purchase never
 * does. Navigation after the paywall is unchanged whatever the winback does.
 */

import { render, waitFor } from '../utils/testUtils';

import type { OnboardingStackScreenProps, RootStackScreenProps } from '@navigation/types';

const mockPresentPaywall = jest.fn();
const mockPresentWinback = jest.fn();

jest.mock('@hooks/usePaywallPresentation', () => ({
  usePaywallPresentation: () => ({ presentPaywall: mockPresentPaywall }),
}));
jest.mock('@hooks/useWinbackOffer', () => ({
  useWinbackOffer: () => ({ presentWinback: mockPresentWinback }),
}));
jest.mock('@services/analytics', () => ({
  Analytics: { paywallDismissed: jest.fn() },
}));

import { PaywallScreen } from '@screens/onboarding/PaywallScreen';
import { PaywallModalScreen } from '@screens/paywall/PaywallModalScreen';
import { Analytics } from '@services/analytics';

const cancelled = { success: false, cancelled: true, error: false };
const purchased = { success: true, cancelled: false, error: false };

function renderOnboarding() {
  const navigation = {
    navigate: jest.fn(),
    replace: jest.fn(),
  } as unknown as OnboardingStackScreenProps<'Paywall'>['navigation'];
  const route = { key: 'test', name: 'Paywall' } as OnboardingStackScreenProps<'Paywall'>['route'];
  render(<PaywallScreen navigation={navigation} route={route} />);
  return navigation;
}

function renderModal() {
  const navigation = {
    goBack: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
  } as unknown as RootStackScreenProps<'PaywallModal'>['navigation'];
  const route = {
    key: 'test',
    name: 'PaywallModal',
    params: { feature: 'entries' },
  } as RootStackScreenProps<'PaywallModal'>['route'];
  render(<PaywallModalScreen navigation={navigation} route={route} />);
  return navigation;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPresentWinback.mockResolvedValue(null);
});

describe('onboarding PaywallScreen', () => {
  it('offers the winback once when the paywall is closed, then moves on', async () => {
    mockPresentPaywall.mockResolvedValue(cancelled);
    const navigation = renderOnboarding();

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('FirstQuizOffer'));
    expect(mockPresentWinback).toHaveBeenCalledTimes(1);
    expect(mockPresentWinback).toHaveBeenCalledWith('paywall_close');
  });

  it('does not offer the winback after a purchase', async () => {
    mockPresentPaywall.mockResolvedValue(purchased);
    const navigation = renderOnboarding();

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('FirstQuizOffer'));
    expect(mockPresentWinback).not.toHaveBeenCalled();
  });
});

describe('PaywallModalScreen', () => {
  it('offers the winback when the paywall is closed and logs the dismissal', async () => {
    mockPresentPaywall.mockResolvedValue(cancelled);
    const navigation = renderModal();

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(mockPresentWinback).toHaveBeenCalledWith('paywall_close');
    expect(Analytics.paywallDismissed).toHaveBeenCalled();
  });

  it('does not log a dismissal when the winback is bought', async () => {
    mockPresentPaywall.mockResolvedValue(cancelled);
    mockPresentWinback.mockResolvedValue(purchased);
    const navigation = renderModal();

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(Analytics.paywallDismissed).not.toHaveBeenCalled();
  });

  it('does not offer the winback after a purchase', async () => {
    mockPresentPaywall.mockResolvedValue(purchased);
    const navigation = renderModal();

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(mockPresentWinback).not.toHaveBeenCalled();
  });
});
