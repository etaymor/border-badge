/**
 * jobGates - Composable preconditions checked before a suspended job resumes.
 *
 * Ported from the seven inline gates in the former `photoScanResume`. Each is
 * now a named, independently testable unit so descriptors can compose the set
 * that actually applies to them. Which gates a job DOESN'T get is as meaningful
 * as which it does — see the subscription gate's note.
 *
 * A gate returns:
 *   pass   - continue to the next gate
 *   defer  - conditions are not yet knowable (a store has not rehydrated).
 *            Leave the breadcrumb alone and try again on the next foreground.
 *   fail   - resume is impossible. The breadcrumb is cleared and the failure
 *            surfaced to the user.
 *
 * The `defer` / `fail` distinction matters: treating an unhydrated store as a
 * failure would clear a perfectly good breadcrumb on every cold start.
 */

import { useAuthStore } from '@stores/authStore';
import { useOnboardingStore } from '@stores/onboardingStore';
import { FREE_LIMITS, useSubscriptionStore } from '@stores/subscriptionStore';

import type { GateOutcome, JobGate } from './jobTypes';

const PASS: GateOutcome = { status: 'pass' };

/**
 * Photo library access must still be granted. Universal: every library job
 * reads the library.
 */
export const mediaLibraryPermissionGate: JobGate = {
  id: 'media-library-permission',
  async check() {
    // Lazy require: this module is re-exported from the jobs barrel, so a
    // static import would pull expo-media-library's native bridge into the
    // startup graph of everything that touches the runtime. Same pattern as
    // useScanLifecycle's expo-keep-awake require.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const MediaLibrary = require('expo-media-library') as typeof import('expo-media-library');
    const perms = await MediaLibrary.getPermissionsAsync();
    if (perms.status === 'granted') return PASS;
    return {
      status: 'fail',
      failure: {
        reason: 'no-permission',
        title: 'Photo Access Needed',
        message: 'Re-enable photo library access in Settings to resume the scan.',
      },
    };
  },
};

/**
 * Home country must be set. TRIP-SCAN ONLY.
 *
 * The quiz build reads home country as a DEPRIORITIZATION signal only (it
 * catches to null and merely ranks home-country photos lower), so a missing one
 * must never fail a quiz resume.
 */
export const homeCountryGate: JobGate = {
  id: 'home-country',
  check() {
    const state = useOnboardingStore.getState();
    if (state.homeCountry) return PASS;
    // `hasHydrated()` is true once AsyncStorage rehydration completes. Treat a
    // missing `persist` as NOT hydrated so the gate defers — that surfaces a
    // real bug (someone dropped the middleware) instead of silently passing.
    const hydrated = useOnboardingStore.persist?.hasHydrated() ?? false;
    if (!hydrated) return { status: 'defer', reason: 'onboarding-not-hydrated' };
    return {
      status: 'fail',
      failure: {
        reason: 'home-country',
        title: 'Set Home Country',
        message: 'Please set your home country in settings to resume the scan.',
      },
    };
  },
};

/**
 * Subscription must still allow photo import. TRIP-SCAN ONLY.
 *
 * DELIBERATELY NOT APPLIED TO `quiz-build`. `FREE_LIMITS` has no quiz entry —
 * the Guess Where loop is ungated on purpose, because metering a viral loop
 * defeats its purpose. This is an explicit omission rather than a default-off
 * so that adding a quiz gate later has to be a conscious act.
 */
export const subscriptionGate: JobGate = {
  id: 'subscription',
  check() {
    // Defer if the store hasn't rehydrated — a stale 'free' default could
    // otherwise trip the gate before the RevenueCat sync lands.
    const hydrated = useSubscriptionStore.persist?.hasHydrated() ?? false;
    if (!hydrated) return { status: 'defer', reason: 'subscription-not-hydrated' };
    const state = useSubscriptionStore.getState();
    const isPremium = state.status === 'premium' || state.status === 'trial';
    const canImport = isPremium || state.photoImportUsage < FREE_LIMITS.photoImport;
    if (canImport) return PASS;
    return {
      status: 'fail',
      failure: {
        reason: 'subscription-expired',
        title: 'Subscription Required',
        message: 'A subscription is required to continue scanning photos.',
      },
    };
  },
};

/**
 * An authenticated session must exist. QUIZ-BUILD ONLY: the build POSTs to
 * `/quiz` and `/quiz/{id}/upload-urls`, so resuming without a session would
 * walk straight into a 401 chain.
 */
export const authSessionGate: JobGate = {
  id: 'auth-session',
  check() {
    const state = useAuthStore.getState();
    // `isLoading` starts true and flips once Supabase's initial getSession()
    // resolves. Defer until then: a resume firing during that window would
    // read a null session that is about to be populated.
    if (state.isLoading) return { status: 'defer', reason: 'auth-not-resolved' };
    if (state.session) return PASS;
    return {
      status: 'fail',
      failure: {
        reason: 'signed-out',
        title: 'Sign In Required',
        message: 'Sign in to finish building your challenge.',
      },
    };
  },
};
