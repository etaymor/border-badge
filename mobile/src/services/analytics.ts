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
// Percentile Calculation Utilities
// ============================================================================

/**
 * Calculate a percentile value from a sorted array.
 */
function calculatePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, index)];
}

/**
 * Calculate p50, p95, and p99 percentiles from an array of response times.
 * Used for API performance tracking.
 */
export function calculateApiPercentiles(responseTimes: number[]): {
  p50: number;
  p95: number;
  p99: number;
} {
  const sorted = [...responseTimes].sort((a, b) => a - b);
  return {
    p50: calculatePercentile(sorted, 50),
    p95: calculatePercentile(sorted, 95),
    p99: calculatePercentile(sorted, 99),
  };
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

  // Clipboard permission events
  clipboardPermissionBannerShown: () => track('clipboard_permission_banner_shown'),

  clipboardPermissionSettingsOpened: () => track('clipboard_permission_settings_opened'),

  clipboardPasteButtonUsed: (props: { provider: string }) =>
    track('clipboard_paste_button_used', { provider: props.provider }),

  // Photo Import Events
  photoImportScanStarted: () => track('photo_import_scan_started'),

  photoImportScanCompleted: (props: {
    photoCount: number;
    tripCandidateCount: number;
    scanDurationMs: number;
    isIncremental: boolean;
    newPhotosCount?: number;
  }) =>
    track('photo_import_scan_completed', {
      photo_count: props.photoCount,
      trip_candidate_count: props.tripCandidateCount,
      scan_duration_ms: props.scanDurationMs,
      is_incremental: props.isIncremental,
      new_photos_count: props.newPhotosCount ?? null,
    }),

  photoImportCandidateSelected: (props: { countryCode: string; clusterCount: number }) =>
    track('photo_import_candidate_selected', {
      country_code: props.countryCode,
      cluster_count: props.clusterCount,
    }),

  photoImportPlaceConfirmed: (props: {
    category: string;
    suggestionRank: number;
    wasFromCache: boolean;
  }) =>
    track('photo_import_place_confirmed', {
      category: props.category,
      suggestion_rank: props.suggestionRank,
      was_from_cache: props.wasFromCache,
    }),

  photoImportPlaceRejected: (props: { suggestionCount: number; wasFromCache: boolean }) =>
    track('photo_import_place_rejected', {
      suggestion_count: props.suggestionCount,
      was_from_cache: props.wasFromCache,
    }),

  photoImportClusterHidden: () => track('photo_import_cluster_hidden'),

  photoImportScanCancelled: () => track('photo_import_scan_cancelled'),

  photoImportScanFailed: (props: { error: string }) =>
    track('photo_import_scan_failed', { error: props.error }),

  photoImportManualSearchOpened: () => track('photo_import_manual_search_opened'),

  photoImportSuggestionsCompleted: (props: {
    suggestionCount: number;
    failedChunks: number;
    cachedClusters: number;
    uncachedClusters: number;
    cacheHitRate: number;
    apiP50Ms?: number;
    apiP95Ms?: number;
    apiP99Ms?: number;
    totalApiDurationMs?: number;
  }) =>
    track('photo_import_suggestions_completed', {
      suggestion_count: props.suggestionCount,
      failed_chunks: props.failedChunks,
      cached_clusters: props.cachedClusters,
      uncached_clusters: props.uncachedClusters,
      cache_hit_rate: props.cacheHitRate,
      api_p50_ms: props.apiP50Ms ?? null,
      api_p95_ms: props.apiP95Ms ?? null,
      api_p99_ms: props.apiP99Ms ?? null,
      total_api_duration_ms: props.totalApiDurationMs ?? null,
    }),

  photoImportApiError: (props: { errorType: 'quota_exhausted' | 'rate_limited' | 'unknown' }) =>
    track('photo_import_api_error', { error_type: props.errorType }),

  photoImportWorkflowCompleted: (props: {
    totalClusters: number;
    confirmedCount: number;
    rejectedCount: number;
    hiddenCount: number;
    workflowDurationMs: number;
    successRate: number;
    acceptanceRate: number;
  }) =>
    track('photo_import_workflow_completed', {
      total_clusters: props.totalClusters,
      confirmed_count: props.confirmedCount,
      rejected_count: props.rejectedCount,
      hidden_count: props.hiddenCount,
      workflow_duration_ms: props.workflowDurationMs,
      success_rate: props.successRate,
      acceptance_rate: props.acceptanceRate,
    }),

  photoImportWorkflowExited: (props: {
    totalClusters: number;
    processedClusters: number;
    remainingClusters: number;
    workflowDurationMs: number;
  }) =>
    track('photo_import_workflow_exited', {
      total_clusters: props.totalClusters,
      processed_clusters: props.processedClusters,
      remaining_clusters: props.remainingClusters,
      workflow_duration_ms: props.workflowDurationMs,
    }),

  // Entry organization (Saved Places feature)
  moveEntry: (props: { entryCount: number; targetTripId: string; isUncategorizedTrip: boolean }) =>
    track('move_entry', {
      entry_count: props.entryCount,
      target_trip_id: props.targetTripId,
      is_bulk: props.entryCount > 1,
      is_uncategorized_trip: props.isUncategorizedTrip,
    }),

  // Subscription & Paywall Events
  viewPaywall: (props: { location: 'onboarding' | 'modal' | 'settings'; feature?: string }) =>
    track('view_paywall', { location: props.location, feature: props.feature ?? null }),

  paywallDismissed: (props: { location: 'onboarding' | 'modal' | 'settings'; feature?: string }) =>
    track('paywall_dismissed', { location: props.location, feature: props.feature ?? null }),

  purchaseCompleted: (props: {
    plan: string | null;
    location: 'onboarding' | 'modal' | 'settings';
  }) => track('purchase_completed', { plan: props.plan, location: props.location }),

  purchaseFailed: (props: {
    plan: string | null;
    error: string;
    location: 'onboarding' | 'modal' | 'settings';
  }) =>
    track('purchase_failed', { plan: props.plan, error: props.error, location: props.location }),

  purchaseCancelled: (props: { location: 'onboarding' | 'modal' | 'settings' }) =>
    track('purchase_cancelled', { location: props.location }),

  restoreInitiated: () => track('restore_initiated'),

  restoreCompleted: (props: { foundSubscription: boolean }) =>
    track('restore_completed', { found_subscription: props.foundSubscription }),

  restoreFailed: (props: { error: string }) => track('restore_failed', { error: props.error }),

  featureLimitHit: (props: {
    feature: 'entries' | 'shareExtension' | 'photoImport';
    remaining: number;
  }) => track('feature_limit_hit', { feature: props.feature, remaining: props.remaining }),

  subscriptionStatusChanged: (props: { from: string; to: string; plan?: string }) =>
    track('subscription_status_changed', {
      from_status: props.from,
      to_status: props.to,
      plan: props.plan ?? null,
    }),

  // Review Request Events
  reviewSatisfactionShown: (
    trigger: 'post_onboarding' | 'country_visited' | 'first_social_save' | 'first_photo_import'
  ) => track('review_satisfaction_shown', { trigger }),
  reviewSatisfactionPositive: () => track('review_satisfaction_positive'),
  reviewSatisfactionNegative: () => track('review_satisfaction_negative'),
  reviewSatisfactionDismissed: () => track('review_satisfaction_dismissed'),
  reviewNativeRequested: () => track('review_native_requested'),
  reviewNativeUnavailable: () => track('review_native_unavailable'),
  reviewNativeError: (error: string) => track('review_native_error', { error }),
  reviewSupportLinkTapped: () => track('review_support_link_tapped'),
};
