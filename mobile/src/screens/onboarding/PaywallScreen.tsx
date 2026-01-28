/**
 * PaywallScreen - Onboarding paywall using RevenueCat's remote paywall UI
 *
 * Uses RevenueCat's dashboard-configured paywall for full customization.
 * This allows changing the paywall design without app updates.
 */

import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@constants/colors';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { Analytics } from '@services/analytics';
import { syncSubscriptionToAppGroup } from '@services/appGroupSync';
import { getSubscriptionPlan } from '@services/revenueCat';
import { useSubscriptionStore } from '@stores/subscriptionStore';

type Props = OnboardingStackScreenProps<'Paywall'>;

export function PaywallScreen({ navigation }: Props) {
  const [isLoading, setIsLoading] = useState(true);
  const hasPresented = useRef(false);
  const { fetchCustomerInfo } = useSubscriptionStore();

  const proceedToAccountCreation = useCallback(() => {
    navigation.navigate('AccountCreation');
  }, [navigation]);

  const presentPaywall = useCallback(async () => {
    // Prevent double presentation
    if (hasPresented.current) return;
    hasPresented.current = true;

    setIsLoading(false);

    // Track paywall view
    Analytics.viewPaywall({ location: 'onboarding' });

    try {
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
            Analytics.purchaseCompleted({ plan, location: 'onboarding' });
          }
          proceedToAccountCreation();
          break;
        }

        case PAYWALL_RESULT.CANCELLED:
          Analytics.purchaseCancelled({ location: 'onboarding' });
          proceedToAccountCreation();
          break;

        case PAYWALL_RESULT.NOT_PRESENTED:
        case PAYWALL_RESULT.ERROR:
        default:
          // User dismissed or error - proceed anyway (free tier)
          Analytics.paywallDismissed({ location: 'onboarding' });
          proceedToAccountCreation();
          break;
      }
    } catch (error) {
      console.error('[PaywallScreen] Error presenting paywall:', error);
      Analytics.purchaseFailed({
        plan: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        location: 'onboarding',
      });
      // On error, proceed with free tier
      proceedToAccountCreation();
    }
  }, [fetchCustomerInfo, proceedToAccountCreation]);

  useEffect(() => {
    // Small delay to ensure screen is mounted before presenting modal
    const timer = setTimeout(() => {
      presentPaywall();
    }, 100);

    return () => clearTimeout(timer);
  }, [presentPaywall]);

  // Show loading indicator while preparing to present paywall
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.loadingContainer}>
        {isLoading && <ActivityIndicator size="large" color={colors.sunsetGold} />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
