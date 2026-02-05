import { useCallback, useEffect, useState } from 'react';

import {
  api,
  clearTokens,
  getOnboardingComplete,
  setSignOutCallback,
  storeTokens,
} from '@services/api';
import { identifyUser, resetUser } from '@services/analytics';
import {
  identifyUser as identifyRevenueCatUser,
  logOutUser as logOutRevenueCatUser,
} from '@services/revenueCat';
import { supabase } from '@services/supabase';
import { useAuthStore } from '@stores/authStore';
import { useSubscriptionStore } from '@stores/subscriptionStore';

/**
 * Manages Supabase auth session initialization and state change listening.
 * Restores existing sessions on mount, handles sign-in/sign-out events,
 * and syncs auth state with analytics, RevenueCat, and subscription stores.
 *
 * Returns `isAppReady` which becomes true after session restoration completes.
 */
export function useAuthSession(): { isAppReady: boolean } {
  const { signOut, setSession, setIsLoading, setHasCompletedOnboarding } = useAuthStore();
  const [isAppReady, setIsAppReady] = useState(false);

  const fetchUsageLimits = useCallback(async () => {
    try {
      const response = await api.get<{
        share_extension_count: number;
        share_extension_period_start: string | null;
        photo_import_count: number;
      }>('/subscriptions/usage');
      useSubscriptionStore
        .getState()
        .setUsageLimits(
          response.data.share_extension_count,
          response.data.photo_import_count,
          response.data.share_extension_period_start
        );
    } catch (error) {
      // Silent failure - usage limits will remain at defaults
      // Backend is source of truth; this is just for UX optimization
      console.warn('Failed to fetch usage limits:', error);
    }
  }, []);

  useEffect(() => {
    // Wire up API sign-out callback
    setSignOutCallback(signOut);

    let subscription: { unsubscribe: () => void } | null = null;
    let isMounted = true;

    const initAuth = async () => {
      try {
        // First restore existing session
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session) {
          setSession(session);
          await storeTokens(session.access_token, session.refresh_token ?? '');
          // Identify user in analytics
          identifyUser(session.user.id);
          // Identify user in RevenueCat (links purchases to account)
          identifyRevenueCatUser(session.user.id).catch((error) => {
            console.error('Failed to identify RevenueCat user:', error);
          });
          // Restore onboarding state for returning users
          try {
            const onboardingComplete = await getOnboardingComplete();
            if (onboardingComplete) {
              setHasCompletedOnboarding(true);
            }
          } catch (onboardingError) {
            // SecureStore may fail on some devices - default to showing onboarding
            console.warn('Failed to restore onboarding state:', onboardingError);
          }
          // Fetch usage limits from backend (for premium gating)
          void fetchUsageLimits();
        }
      } catch (error) {
        console.error('Failed to restore session:', error);
      } finally {
        setIsLoading(false);
        // Mark app as ready for the animated splash to transition
        setIsAppReady(true);
      }

      // Then set up listener for future changes (after session restore completes)
      const {
        data: { subscription: sub },
      } = supabase.auth.onAuthStateChange(async (event, session) => {
        // Skip INITIAL_SESSION as we already handled it above
        if (event === 'INITIAL_SESSION') return;
        // Guard against updates after unmount
        if (!isMounted) return;

        setSession(session);
        if (session) {
          await storeTokens(session.access_token, session.refresh_token ?? '');
          // Identify user in analytics
          identifyUser(session.user.id);
          // Identify user in RevenueCat (links purchases to account)
          identifyRevenueCatUser(session.user.id).catch((error) => {
            console.error('Failed to identify RevenueCat user:', error);
          });
          // Restore onboarding state for returning users (same as initAuth)
          try {
            const onboardingComplete = await getOnboardingComplete();
            if (onboardingComplete) {
              setHasCompletedOnboarding(true);
            }
          } catch (onboardingError) {
            // SecureStore may fail on some devices - default to showing onboarding
            console.warn('Failed to restore onboarding state:', onboardingError);
          }
          // Fetch usage limits from backend (for premium gating)
          void fetchUsageLimits();
        } else {
          // User signed out - clear tokens first, then reset onboarding state
          await clearTokens();
          setHasCompletedOnboarding(false);
          // Reset analytics user
          resetUser();
          // Reset subscription store to clear cached premium status and usage limits
          useSubscriptionStore.getState().reset();
          // Log out RevenueCat user (resets to anonymous)
          logOutRevenueCatUser().catch((error) => {
            console.error('Failed to log out RevenueCat user:', error);
          });
        }
      });
      subscription = sub;
    };

    initAuth();

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, [signOut, setSession, setIsLoading, setHasCompletedOnboarding, fetchUsageLimits]);

  return { isAppReady };
}
