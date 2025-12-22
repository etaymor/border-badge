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
// URL Sanitization
// ============================================================================

/**
 * Sanitize a URL for analytics by removing query params and fragments.
 * Prevents PII or sensitive data from being tracked.
 *
 * @param url - The URL to sanitize
 * @param maxLength - Maximum length of the sanitized URL (default 100)
 * @returns Sanitized URL with only host and path
 */
function sanitizeUrlForAnalytics(url: string, maxLength = 100): string {
  try {
    const parsed = new URL(url);
    // Only keep host and pathname, strip query and fragment
    const sanitized = `${parsed.host}${parsed.pathname}`;
    return sanitized.substring(0, maxLength);
  } catch {
    // If URL parsing fails, just truncate and remove obvious query strings
    const withoutQuery = url.split('?')[0].split('#')[0];
    return withoutQuery.substring(0, maxLength);
  }
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

  // Social Share Ingest
  shareStarted: (props: { source: string; url: string }) =>
    track('share_started', { source: props.source, url: sanitizeUrlForAnalytics(props.url) }),

  shareIngested: (props: { provider: string; hasPlace: boolean; confidence: number }) =>
    track('share_ingested', {
      provider: props.provider,
      has_place: props.hasPlace,
      confidence: props.confidence,
    }),

  shareIngestFailed: (error: string) => track('share_ingest_failed', { error }),

  shareSaved: (props: { entryId: string; tripId: string }) =>
    track('share_saved', { entry_id: props.entryId, trip_id: props.tripId }),

  shareCompleted: (props: { provider: string; entryType: string; tripId: string }) =>
    track('share_completed', {
      provider: props.provider,
      entry_type: props.entryType,
      trip_id: props.tripId,
    }),

  shareFailed: (props: { provider: string; error: string; stage: 'ingest' | 'save' }) =>
    track('share_failed', {
      provider: props.provider,
      error: props.error,
      stage: props.stage,
    }),

  shareQueued: (props: { url: string; reason: 'offline' | 'error' }) =>
    track('share_queued', { url: sanitizeUrlForAnalytics(props.url), reason: props.reason }),

  shareRetried: (props: { shareId: string; attempt: number; success: boolean }) =>
    track('share_retried', {
      share_id: props.shareId,
      attempt: props.attempt,
      success: props.success,
    }),

  // Place detection events
  placeDetected: (props: { confidence: number; provider: string }) =>
    track('place_detected', { confidence: props.confidence, provider: props.provider }),

  placeConfirmed: (props: { wasDetected: boolean; wasEdited: boolean }) =>
    track('place_confirmed', { was_detected: props.wasDetected, was_edited: props.wasEdited }),

  placeManualEntry: () => track('place_manual_entry'),

  // Trip selection events
  tripSelected: (props: { tripId: string; isNew: boolean }) =>
    track('trip_selected', { trip_id: props.tripId, is_new: props.isNew }),

  tripCreatedInline: (props: { tripId: string; countryCode: string }) =>
    track('trip_created_inline', { trip_id: props.tripId, country_code: props.countryCode }),

  // Clipboard events
  clipboardPromptShown: (props: { url: string }) =>
    track('clipboard_prompt_shown', { url: sanitizeUrlForAnalytics(props.url) }),

  clipboardPromptAccepted: (props: { url: string }) =>
    track('clipboard_prompt_accepted', { url: sanitizeUrlForAnalytics(props.url) }),

  clipboardPromptDismissed: (props: { url: string }) =>
    track('clipboard_prompt_dismissed', { url: sanitizeUrlForAnalytics(props.url) }),
};
