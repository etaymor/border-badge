/**
 * Analytics service for Border Badge
 *
 * Wraps PostHog SDK for product analytics.
 * Only sends events in production - development and staging log to console.
 */
import PostHog from 'posthog-react-native';

import { isProduction } from '@config/env';

let posthog: PostHog | null = null;
let isInitialized = false;

/**
 * Initialize PostHog analytics.
 * Call once at app startup.
 */
export async function initAnalytics(): Promise<void> {
  if (isInitialized) {
    return;
  }

  const apiKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
  const host = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

  if (!isProduction) {
    console.log('[Analytics] Non-production mode - events will be logged to console');
    isInitialized = true;
    return;
  }

  if (!apiKey) {
    console.warn('[Analytics] PostHog API key not configured - analytics disabled');
    isInitialized = true;
    return;
  }

  try {
    // PostHog React Native uses constructor with apiKey and options
    posthog = new PostHog(apiKey, {
      host,
    });
    isInitialized = true;
    console.log('[Analytics] PostHog initialized');
  } catch (error) {
    console.error('[Analytics] Failed to initialize PostHog:', error);
    isInitialized = true; // Mark as initialized to prevent retry loops
  }
}

/**
 * Identify a user after authentication.
 * Call when user successfully logs in or creates account.
 */
export function identifyUser(userId: string): void {
  if (!isProduction) {
    console.log('[Analytics] Identify:', userId);
    return;
  }

  posthog?.identify(userId);
}

/**
 * Reset user identity on sign out.
 */
export function resetUser(): void {
  if (!isProduction) {
    console.log('[Analytics] Reset user');
    return;
  }

  posthog?.reset();
}

/**
 * Track a custom event.
 */
export function track(
  event: string,
  properties?: Record<string, string | number | boolean | null>
): void {
  if (!isProduction) {
    console.log('[Analytics] Track:', event, properties ?? {});
    return;
  }

  posthog?.capture(event, properties);
}

// ============================================================================
// Typed Event Helpers
// ============================================================================

// Onboarding Events
export const Analytics = {
  // Onboarding funnel
  viewOnboardingWelcome: () => track('view_onboarding_welcome'),
  viewOnboardingSlider: () => track('view_onboarding_slider'),
  viewOnboardingMotivation: () => track('view_onboarding_motivation'),
  viewOnboardingHomeCountry: () => track('view_onboarding_home_country'),
  viewOnboardingTracking: () => track('view_onboarding_tracking'),
  viewOnboardingDream: () => track('view_onboarding_dream'),
  viewOnboardingContinent: (continent: string) => track('view_onboarding_continent', { continent }),
  viewOnboardingCountries: (continent: string) => track('view_onboarding_countries', { continent }),
  viewOnboardingAntarctica: () => track('view_onboarding_antarctica'),
  viewOnboardingProgress: (countriesCount: number) =>
    track('view_onboarding_progress', { countries_count: countriesCount }),
  viewOnboardingName: () => track('view_onboarding_name'),
  viewOnboardingAccount: () => track('view_onboarding_account'),

  completeOnboarding: (props: {
    countriesCount: number;
    homeCountry: string | null;
    trackingPreference: string;
  }) =>
    track('complete_onboarding', {
      countries_count: props.countriesCount,
      home_country: props.homeCountry,
      tracking_preference: props.trackingPreference,
    }),

  skipToLogin: (fromScreen: string) => track('skip_to_login', { from_screen: fromScreen }),

  // Core engagement
  appOpened: (sessionId: string) => track('app_opened', { session_id: sessionId }),
  viewPassport: (countriesCount: number) =>
    track('view_passport', { countries_count: countriesCount }),

  createTrip: (countryCode: string) => track('create_trip', { country_code: countryCode }),

  createEntry: (props: { entryType: string; hasPlace: boolean; hasMedia: boolean }) =>
    track('create_entry', {
      entry_type: props.entryType,
      has_place: props.hasPlace,
      has_media: props.hasMedia,
    }),

  addCountryVisited: (countryCode: string) =>
    track('add_country_visited', { country_code: countryCode }),

  addCountryWishlist: (countryCode: string) =>
    track('add_country_wishlist', { country_code: countryCode }),

  // Sharing
  sharePassport: () => track('share_passport'),
  shareTrip: (tripId: string) => track('share_trip', { trip_id: tripId }),
  shareList: (listId: string) => track('share_list', { list_id: listId }),
  shareMilestone: (props: {
    countryCode: string;
    countryRegion: string;
    countrySubregion: string | null;
    totalCount: number;
    milestoneTypes: string[];
  }) =>
    track('share_milestone', {
      country_code: props.countryCode,
      country_region: props.countryRegion,
      country_subregion: props.countrySubregion ?? null,
      total_count: props.totalCount,
      milestone_types: props.milestoneTypes.join(',') || null,
      milestone_count: props.milestoneTypes.length,
    }),
};
