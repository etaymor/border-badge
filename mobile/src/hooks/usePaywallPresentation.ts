/**
 * usePaywallPresentation - Shared hook for presenting RevenueCat paywall
 *
 * Centralizes the paywall presentation logic used across:
 * - PaywallScreen (onboarding)
 * - PaywallModalScreen (feature gating)
 * - SubscriptionSection (settings)
 *
 * Handles analytics tracking, haptic feedback, subscription sync, and result processing.
 */

import { useCallback } from 'react';
import * as Haptics from 'expo-haptics';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';
import Purchases, { PurchasesOfferings } from 'react-native-purchases';

import { AdEvents } from '@services/adEvents';
import { Analytics } from '@services/analytics';
import { syncSubscriptionToAppGroup } from '@services/appGroupSync';
import {
  ENTITLEMENT_ID,
  getSubscriptionPlan,
  initializeRevenueCat,
  isTrialing,
  waitForLogIn,
} from '@services/revenueCat';
import { useSubscriptionStore } from '@stores/subscriptionStore';
import type { GatedFeature } from '@navigation/types';

export type PaywallLocation = 'onboarding' | 'modal' | 'settings';

export interface PaywallPresentationResult {
  /** Whether a purchase or restore was successful */
  success: boolean;
  /** The raw result from RevenueCat */
  result: (typeof PAYWALL_RESULT)[keyof typeof PAYWALL_RESULT];
  /** Whether the user cancelled the paywall */
  cancelled: boolean;
  /** Whether there was an error presenting the paywall */
  error: boolean;
}

export interface PaywallPresentationOptions {
  /** The gated feature that triggered the paywall (for analytics) */
  feature?: GatedFeature;
}

/** Look up price/currency for a product from cached offerings. */
function getProductPrice(
  offerings: PurchasesOfferings,
  productIdentifier: string
): { price: number; currency: string } | null {
  const packages = offerings.current?.availablePackages ?? [];
  const pkg = packages.find((p) => p.product.identifier === productIdentifier);
  if (!pkg) return null;
  return { price: pkg.product.price, currency: pkg.product.currencyCode };
}

/**
 * Hook for presenting the RevenueCat paywall with consistent behavior.
 *
 * @param location - Where the paywall is being presented from (for analytics)
 * @returns Object with presentPaywall function
 */
export function usePaywallPresentation(location: PaywallLocation) {
  const fetchCustomerInfo = useSubscriptionStore((s) => s.fetchCustomerInfo);

  const presentPaywall = useCallback(
    async (options?: PaywallPresentationOptions): Promise<PaywallPresentationResult> => {
      // Track paywall view
      Analytics.viewPaywall({ location, feature: options?.feature });

      try {
        // Ensure RevenueCat SDK is fully initialized and user is identified.
        // waitForLogIn() ensures purchases are linked to the Supabase user ID,
        // not the anonymous $RCAnonymousID.
        await initializeRevenueCat();
        await waitForLogIn();

        // Fetch offerings - this should populate from RevenueCat dashboard
        const offerings = await Purchases.getOfferings();
        console.log('[usePaywallPresentation] Offerings fetched:', offerings.current?.identifier);

        if (!offerings.current) {
          console.error('[usePaywallPresentation] No current offering available');
          return { success: false, result: PAYWALL_RESULT.ERROR, cancelled: false, error: true };
        }

        const result = await RevenueCatUI.presentPaywall({
          displayCloseButton: true,
        });

        switch (result) {
          case PAYWALL_RESULT.PURCHASED:
          case PAYWALL_RESULT.RESTORED: {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

            // Refresh subscription state and sync to App Group
            const customerInfo = await fetchCustomerInfo();
            if (customerInfo) {
              await syncSubscriptionToAppGroup(customerInfo);
              const plan = getSubscriptionPlan(customerInfo);
              Analytics.purchaseCompleted({ plan, location });

              // Track ad conversions (fire-and-forget)
              if (isTrialing(customerInfo)) {
                AdEvents.trialStarted(plan ?? 'unknown').catch(() => {});
              } else {
                // Re-fetch offerings after purchase to ensure price lookup is current
                const freshOfferings = await Purchases.getOfferings();
                const entitlement = customerInfo.entitlements.active[ENTITLEMENT_ID];
                const priceInfo = entitlement
                  ? getProductPrice(freshOfferings, entitlement.productIdentifier)
                  : null;

                if (!priceInfo) {
                  console.warn(
                    '[usePaywallPresentation] Could not find price for',
                    entitlement?.productIdentifier
                  );
                }

                AdEvents.subscriptionPurchased(
                  plan ?? 'unknown',
                  priceInfo?.price ?? 0,
                  priceInfo?.currency ?? 'USD'
                ).catch(() => {});
              }
            }

            return { success: true, result, cancelled: false, error: false };
          }

          case PAYWALL_RESULT.CANCELLED:
            Analytics.purchaseCancelled({ location });
            return { success: false, result, cancelled: true, error: false };

          case PAYWALL_RESULT.NOT_PRESENTED:
          case PAYWALL_RESULT.ERROR:
          default:
            return { success: false, result, cancelled: false, error: true };
        }
      } catch (error) {
        console.error(`[usePaywallPresentation] Error presenting paywall (${location}):`, error);
        Analytics.purchaseFailed({
          plan: null,
          error: error instanceof Error ? error.message : 'Unknown error',
          location,
        });
        return {
          success: false,
          result: PAYWALL_RESULT.ERROR,
          cancelled: false,
          error: true,
        };
      }
    },
    [fetchCustomerInfo, location]
  );

  return { presentPaywall };
}
