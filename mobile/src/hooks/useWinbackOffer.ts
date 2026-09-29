/**
 * useWinbackOffer - presents the $24.99/yr winback paywall to free users.
 *
 * Two triggers call this: closing the standard paywall without buying, and
 * the "Deleting? Get 50% off" home-screen quick action. Each fires at most once
 * per install (see services/winback.ts). Purchase handling is shared with the
 * standard paywall through usePaywallPresentation.
 */

import { useCallback } from 'react';
import Purchases from 'react-native-purchases';

import {
  usePaywallPresentation,
  type PaywallLocation,
  type PaywallPresentationResult,
} from '@hooks/usePaywallPresentation';
import { Analytics } from '@services/analytics';
import { initializeRevenueCat, WINBACK_OFFERING_ID } from '@services/revenueCat';
import { hasUsedWinback, markWinbackUsed, type WinbackTrigger } from '@services/winback';
import { useSubscriptionStore } from '@stores/subscriptionStore';

// Gap between the standard paywall's dismiss animation and the winback's
// present animation; back-to-back native modals can drop the second one.
export const WINBACK_AFTER_PAYWALL_DELAY_MS = 400;

async function isFreeUser(): Promise<boolean> {
  const store = useSubscriptionStore.getState();
  if (store.status === 'loading') {
    await store.fetchCustomerInfo();
  }
  return useSubscriptionStore.getState().status === 'free';
}

async function hasWinbackOffering(): Promise<boolean> {
  try {
    await initializeRevenueCat();
    const offerings = await Purchases.getOfferings();
    return Boolean(offerings.all[WINBACK_OFFERING_ID]);
  } catch (error) {
    console.warn('[useWinbackOffer] Could not load offerings:', error);
    return false;
  }
}

/** Whether the trigger is unused and the user can still be offered the winback. */
export async function isWinbackEligible(trigger: WinbackTrigger): Promise<boolean> {
  if (await hasUsedWinback(trigger)) return false;
  return isFreeUser();
}

export function useWinbackOffer(location: PaywallLocation) {
  const { presentPaywall } = usePaywallPresentation(location);

  /** Returns null when the winback was not shown. */
  const presentWinback = useCallback(
    async (trigger: WinbackTrigger): Promise<PaywallPresentationResult | null> => {
      if (!(await isWinbackEligible(trigger))) return null;
      // A missing offering is the dashboard kill switch; don't spend the trigger.
      if (!(await hasWinbackOffering())) return null;

      // Mark before presenting so a crash mid-paywall can't earn a second offer.
      await markWinbackUsed(trigger);
      Analytics.winbackShown({ trigger, location });

      if (trigger === 'paywall_close') {
        await new Promise((resolve) => setTimeout(resolve, WINBACK_AFTER_PAYWALL_DELAY_MS));
      }

      return presentPaywall({ offeringId: WINBACK_OFFERING_ID });
    },
    [presentPaywall, location]
  );

  return { presentWinback };
}
