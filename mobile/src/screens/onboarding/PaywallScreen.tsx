/**
 * PaywallScreen - Onboarding paywall using RevenueCat's remote paywall UI
 *
 * Uses RevenueCat's dashboard-configured paywall for full customization.
 * This allows changing the paywall design without app updates.
 *
 * The user is already authenticated at this point (account created before
 * the paywall), so purchases attach to the Supabase UUID.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';

import { colors } from '@constants/colors';
import { invalidateCountriesCache } from '@hooks/useCountries';
import { usePaywallPresentation } from '@hooks/usePaywallPresentation';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { storeOnboardingComplete } from '@services/api';
import { Analytics } from '@services/analytics';
import { useAuthStore } from '@stores/authStore';

type Props = OnboardingStackScreenProps<'Paywall'>;

export function PaywallScreen(_props: Props) {
  const [isLoading, setIsLoading] = useState(true);
  const hasPresented = useRef(false);
  const queryClient = useQueryClient();
  const { presentPaywall } = usePaywallPresentation('onboarding');
  const setHasCompletedOnboarding = useAuthStore((s) => s.setHasCompletedOnboarding);
  const setNeedsPostSignupFlow = useAuthStore((s) => s.setNeedsPostSignupFlow);

  const finishOnboarding = useCallback(async () => {
    try {
      await storeOnboardingComplete();
    } catch (e) {
      console.warn('Failed to persist onboarding complete flag:', e);
    }
    // Force passport screen to mount with fresh data: useCountries (SQLite-backed)
    // can otherwise still be loading on the first frame, leaving the stamps row empty
    // even though stats are populated from the migration-seeded user-countries cache.
    invalidateCountriesCache();
    await queryClient.invalidateQueries({ queryKey: ['user-countries'] });
    setHasCompletedOnboarding(true);
    setNeedsPostSignupFlow(false);
  }, [queryClient, setHasCompletedOnboarding, setNeedsPostSignupFlow]);

  const handlePresentPaywall = useCallback(async () => {
    // Prevent double presentation
    if (hasPresented.current) return;
    hasPresented.current = true;

    setIsLoading(false);

    const { cancelled, error } = await presentPaywall();

    // Track dismissal for non-purchase, non-cancel cases
    if (!cancelled && error) {
      Analytics.paywallDismissed({ location: 'onboarding' });
    }

    // Finish onboarding — RootNavigator will switch to Main
    await finishOnboarding();
  }, [presentPaywall, finishOnboarding]);

  useEffect(() => {
    // Small delay to ensure screen is mounted before presenting modal
    const timer = setTimeout(() => {
      handlePresentPaywall();
    }, 100);

    return () => clearTimeout(timer);
  }, [handlePresentPaywall]);

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
