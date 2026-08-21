import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { invalidateCountriesCache } from '@hooks/useCountries';
import { storeOnboardingComplete } from '@services/api';
import { useAuthStore } from '@stores/authStore';

/**
 * Close the post-signup flow: persist the onboarding-complete flag, refresh
 * the passport data caches, and flip the auth flags so RootNavigator switches
 * to Main.
 *
 * Extracted from PaywallScreen: the post-paywall FirstQuizOffer screen is
 * the LAST post-signup step, so it -- not the paywall -- owns the finish.
 * The settled order (account creation before paywall, guarded by
 * needsPostSignupFlow; see docs/ONBOARDING_PAYWALL_FIX.md) is unchanged.
 */
export function useFinishOnboarding() {
  const queryClient = useQueryClient();
  const setHasCompletedOnboarding = useAuthStore((s) => s.setHasCompletedOnboarding);
  const setNeedsPostSignupFlow = useAuthStore((s) => s.setNeedsPostSignupFlow);

  return useCallback(async () => {
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
}
