import { useCallback, useEffect, useState } from 'react';

import {
  api,
  clearTokens,
  getOnboardingComplete,
  setSignOutCallback,
  storeTokens,
} from '@services/api';
import { AdEvents } from '@services/adEvents';
import { identifyUser, resetUser, Analytics } from '@services/analytics';
import {
  identifyUser as identifyRevenueCatUser,
  logOutUser as logOutRevenueCatUser,
  prepareLogIn,
  settleLogIn,
} from '@services/revenueCat';
import { supabase } from '@services/supabase';
import { useAuthStore } from '@stores/authStore';
import { useSubscriptionStore } from '@stores/subscriptionStore';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Identify user in RevenueCat, sync subscription to backend, and update store.
 * Fire-and-forget: errors are logged but never thrown.
 *
 * @param signal - AbortSignal to cancel store updates if the session is
 *   invalidated (e.g. user signs out) before the async work completes.
 */
function syncRevenueCat(
  userId: string,
  attributes?: { email?: string; displayName?: string },
  signal?: AbortSignal
): void {
  // Reset to 'loading' immediately so the UI doesn't flash stale persisted
  // state (e.g. 'premium') while the SDK call completes.
  useSubscriptionStore.getState().setStatus('loading');
  // Prepare a promise that the paywall can await to ensure logIn()
  // completes before any purchase is made.
  prepareLogIn();
  identifyRevenueCatUser(userId, attributes)
    .then(async (customerInfo) => {
      settleLogIn(true);
      if (signal?.aborted) return;
      // Track successful identification for debugging subscription merge issues
      const activeEntitlements = Object.keys(customerInfo.entitlements.active);
      Analytics.revenueCatIdentified({
        hasEntitlements: activeEntitlements.length > 0,
        entitlements: activeEntitlements,
      });
      useSubscriptionStore.getState().setCustomerInfo(customerInfo);
      // Sync subscription to backend DB in case webhooks were missed.
      // Always call verify (not just for premium) so downgrades are synced too.
      try {
        await api.post('/subscriptions/verify', undefined, { signal });
      } catch (verifyError) {
        console.warn('Failed to verify subscription with backend:', verifyError);
      }
    })
    .catch((error) => {
      settleLogIn(false);
      if (signal?.aborted) return;
      console.error('Failed to identify RevenueCat user:', error);
      Analytics.revenueCatError({ action: 'identify', error: getErrorMessage(error) });
      const store = useSubscriptionStore.getState();
      store.setSdkAvailable(false);
      // Clear any stale persisted premium status — without SDK validation
      // we cannot trust the cached state, so fail safe to free.
      // Must also clear plan/expirationDate to prevent stale trial/premium
      // metadata from persisting in AsyncStorage across sessions.
      store.setStatus('free');
      useSubscriptionStore.setState({ plan: null, expirationDate: null });
    });
}

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

  // Wire up API sign-out callback once on mount
  useEffect(() => {
    setSignOutCallback(signOut);
  }, [signOut]);

  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;
    let isMounted = true;
    // Tracks the in-flight syncRevenueCat call so it can be cancelled
    // when the session changes (sign-out) or the component unmounts.
    let syncAbortController: AbortController | null = null;

    const initAuth = async () => {
      try {
        // First restore existing session
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session) {
          setSession(session);
          await storeTokens(session.access_token, session.refresh_token ?? '');
          // Identify user in analytics and ad tracking
          identifyUser(session.user.id);
          AdEvents.setUserId(session.user.id);
          // Identify user in RevenueCat and sync subscription to backend
          syncAbortController = new AbortController();
          const rcAttrs = {
            email: session.user.email,
            displayName: session.user.user_metadata?.display_name as string | undefined,
          };
          syncRevenueCat(session.user.id, rcAttrs, syncAbortController.signal);
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

        // Cancel any in-flight RevenueCat sync from a previous session
        syncAbortController?.abort();
        syncAbortController = null;

        setSession(session);
        if (session) {
          await storeTokens(session.access_token, session.refresh_token ?? '');
          // Identify user in analytics and ad tracking
          identifyUser(session.user.id);
          AdEvents.setUserId(session.user.id);
          // Identify user in RevenueCat and sync subscription to backend
          syncAbortController = new AbortController();
          const rcAttrs2 = {
            email: session.user.email,
            displayName: session.user.user_metadata?.display_name as string | undefined,
          };
          syncRevenueCat(session.user.id, rcAttrs2, syncAbortController.signal);
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
          // Reset analytics user and ad tracking
          resetUser();
          AdEvents.clearUserId();
          // Reset subscription store to clear cached premium status and usage limits
          useSubscriptionStore.getState().reset();
          // Log out RevenueCat user (resets to anonymous)
          logOutRevenueCatUser().catch((error) => {
            console.error('Failed to log out RevenueCat user:', error);
            Analytics.revenueCatError({ action: 'logout', error: getErrorMessage(error) });
          });
        }
      });
      subscription = sub;
    };

    initAuth();

    return () => {
      isMounted = false;
      syncAbortController?.abort();
      subscription?.unsubscribe();
    };
  }, [setSession, setIsLoading, setHasCompletedOnboarding, fetchUsageLimits]);

  return { isAppReady };
}
