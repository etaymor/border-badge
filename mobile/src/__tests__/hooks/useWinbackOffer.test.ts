/**
 * useWinbackOffer + usePaywallPresentation's offeringId path.
 *
 * The winback is a non-current RevenueCat offering presented explicitly; it is
 * only offered to free users, once per trigger, and never when the dashboard
 * offering has been removed (the kill switch).
 */

import { act, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Purchases from 'react-native-purchases';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';

import { usePaywallPresentation } from '@hooks/usePaywallPresentation';
import { useWinbackOffer } from '@hooks/useWinbackOffer';
import { Analytics } from '@services/analytics';
import { useSubscriptionStore } from '@stores/subscriptionStore';

jest.mock('@services/analytics', () => ({
  Analytics: {
    viewPaywall: jest.fn(),
    purchaseCancelled: jest.fn(),
    purchaseCompleted: jest.fn(),
    purchaseFailed: jest.fn(),
    winbackShown: jest.fn(),
    subscriptionStatusChanged: jest.fn(),
  },
}));

jest.mock('@services/revenueCat', () => ({
  ...jest.requireActual('@services/revenueCat'),
  initializeRevenueCat: jest.fn().mockResolvedValue(undefined),
  waitForLogIn: jest.fn().mockResolvedValue(true),
}));

const winbackOffering = { identifier: 'winback', availablePackages: [] };
const currentOffering = { identifier: 'default', availablePackages: [] };

const mockGetOfferings = Purchases.getOfferings as jest.Mock;
const mockPresentPaywall = RevenueCatUI.presentPaywall as jest.Mock;
const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;

let ledger: Record<string, string>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  ledger = {};
  mockGetItem.mockImplementation(async (key: string) => ledger[key] ?? null);
  mockSetItem.mockImplementation(async (key: string, value: string) => {
    ledger[key] = value;
  });
  mockGetOfferings.mockResolvedValue({
    current: currentOffering,
    all: { default: currentOffering, winback: winbackOffering },
  });
  mockPresentPaywall.mockResolvedValue(PAYWALL_RESULT.CANCELLED);
  useSubscriptionStore.setState({ status: 'free' });
});

afterEach(() => {
  jest.useRealTimers();
});

async function runWinback(trigger: 'paywall_close' | 'quick_action') {
  const { result } = renderHook(() => useWinbackOffer('onboarding'));
  let outcome: Awaited<ReturnType<typeof result.current.presentWinback>> = null;
  await act(async () => {
    const promise = result.current.presentWinback(trigger);
    await jest.runAllTimersAsync();
    outcome = await promise;
  });
  return outcome;
}

describe('usePaywallPresentation offeringId', () => {
  it('presents the requested offering', async () => {
    const { result } = renderHook(() => usePaywallPresentation('modal'));
    await act(async () => {
      await result.current.presentPaywall({ offeringId: 'winback' });
    });
    expect(mockPresentPaywall).toHaveBeenCalledWith({
      offering: winbackOffering,
      displayCloseButton: true,
    });
    expect(Analytics.viewPaywall).toHaveBeenCalledWith(
      expect.objectContaining({ offer: 'winback' })
    );
  });

  it('keeps the default call for the standard paywall', async () => {
    const { result } = renderHook(() => usePaywallPresentation('modal'));
    await act(async () => {
      await result.current.presentPaywall();
    });
    expect(mockPresentPaywall).toHaveBeenCalledWith({ displayCloseButton: true });
  });

  it('returns an error for an unknown offering without presenting', async () => {
    const { result } = renderHook(() => usePaywallPresentation('modal'));
    let outcome;
    await act(async () => {
      outcome = await result.current.presentPaywall({ offeringId: 'missing' });
    });
    expect(outcome).toEqual(expect.objectContaining({ error: true, success: false }));
    expect(mockPresentPaywall).not.toHaveBeenCalled();
  });
});

describe('useWinbackOffer', () => {
  it('presents the winback offering to a free user', async () => {
    const outcome = await runWinback('paywall_close');
    expect(outcome).toEqual(expect.objectContaining({ cancelled: true }));
    expect(mockPresentPaywall).toHaveBeenCalledWith(
      expect.objectContaining({ offering: winbackOffering })
    );
    expect(Analytics.winbackShown).toHaveBeenCalledWith({
      trigger: 'paywall_close',
      location: 'onboarding',
    });
  });

  it('fires once per trigger', async () => {
    await runWinback('paywall_close');
    mockPresentPaywall.mockClear();

    expect(await runWinback('paywall_close')).toBeNull();
    expect(mockPresentPaywall).not.toHaveBeenCalled();

    // A different trigger still has its own chance.
    await runWinback('quick_action');
    expect(mockPresentPaywall).toHaveBeenCalledTimes(1);
  });

  it.each(['premium', 'trial'] as const)('never shows to a %s user', async (status) => {
    useSubscriptionStore.setState({ status });
    expect(await runWinback('paywall_close')).toBeNull();
    expect(mockPresentPaywall).not.toHaveBeenCalled();
  });

  it('does nothing and keeps the trigger when the offering is removed', async () => {
    mockGetOfferings.mockResolvedValue({ current: currentOffering, all: {} });
    expect(await runWinback('paywall_close')).toBeNull();
    expect(mockPresentPaywall).not.toHaveBeenCalled();
    expect(ledger['winback_used:paywall_close']).toBeUndefined();
  });
});
