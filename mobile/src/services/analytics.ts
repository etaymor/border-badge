/**
 * Analytics service for Border Badge
 *
 * Wraps PostHog SDK for product analytics.
 * Only sends events in production - development and staging log to console.
 */
import PostHog from 'posthog-react-native';

import { isProduction } from '@config/env';
import type { QuizEntryPoint, QuizShareSource } from '@navigation/types';
import { stableHashOrNull } from '@utils/stableHash';

export type PhotoPermissionDoor = 'quiz' | 'trips' | 'profile' | 'other';
export type PhotoPermissionOsStatus = 'granted' | 'limited' | 'denied' | 'undetermined';

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
  viewOnboardingEmotionalHook: () => track('view_onboarding_emotional_hook'),
  viewOnboardingFunctionalHook: () => track('view_onboarding_functional_hook'),
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
    /**
     * Google Place ID of the system's top-ranked suggestion. Null on pure manual entries.
     * Hashed here before it is emitted (R27) - never sent raw.
     */
    originalSuggestionPlaceId?: string | null;
    alternativesCount?: number;
    alternativesViewed?: number;
    /** True when the saved place differs from the system's top-ranked suggestion. */
    wasOverride?: boolean;
  }) =>
    track('photo_import_place_confirmed', {
      category: props.category,
      suggestion_rank: props.suggestionRank,
      was_from_cache: props.wasFromCache,
      original_suggestion_place_hash: stableHashOrNull(props.originalSuggestionPlaceId),
      alternatives_count: props.alternativesCount ?? null,
      alternatives_viewed: props.alternativesViewed ?? null,
      was_override: props.wasOverride ?? null,
    }),

  photoImportPlaceRejected: (props: {
    suggestionCount: number;
    wasFromCache: boolean;
    /**
     * Google Place ID currently shown when the user tapped the edit/override button.
     * Hashed here before it is emitted (R27) - never sent raw.
     */
    originalSuggestionPlaceId?: string | null;
    /** 1-based rank of the suggestion shown at reject time. */
    suggestedRank?: number;
    alternativesViewed?: number;
  }) =>
    track('photo_import_place_rejected', {
      suggestion_count: props.suggestionCount,
      was_from_cache: props.wasFromCache,
      original_suggestion_place_hash: stableHashOrNull(props.originalSuggestionPlaceId),
      suggested_rank: props.suggestedRank ?? null,
      alternatives_viewed: props.alternativesViewed ?? null,
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
    /**
     * U15/R18. Milliseconds from the start of `fetchSuggestions` to the moment
     * the first batch carrying a suggestion resolved. This is what the user
     * actually waits for. The per-batch percentiles above describe *batches*,
     * so on a multi-batch import they say nothing about first paint. Null when
     * no batch ever carried a suggestion.
     */
    timeToFirstSuggestionMs?: number | null;
    /**
     * U15/R18. True wall-clock for the whole matching stage, including the
     * cache read and vision preparation that `totalApiDurationMs` excludes.
     * Stays meaningful once U6 dispatches batches concurrently, where summing
     * per-batch durations would over-count overlapped time.
     */
    wallClockMs?: number;
    /**
     * U11/R18. The most batches this dispatch ever had on the wire at once.
     *
     * The pool SIZE is a constant, so it says nothing about whether the pool was
     * ever used: a preparation-bound run at concurrency 3 can peak at 1. Read it
     * with `meanInFlightBatches` — a peak of 3 with a mean of 0.4 is a pool that
     * briefly filled and then starved.
     */
    peakInFlightBatches?: number;
    /**
     * U11/R18. Time-weighted mean batches on the wire across the dispatch span —
     * occupancy over TIME, not a count of events. Compare against the configured
     * concurrency to see how much of the pool the run actually used.
     */
    meanInFlightBatches?: number;
    /** U11/R18. Milliseconds with at least one batch on the wire. */
    wireBusyMs?: number;
    /**
     * U11/R18. Milliseconds from the first batch leaving to the last one
     * settling. `wireSpanMs - wireBusyMs` is dead air inside dispatch — the
     * preparation-bound share that more concurrency cannot remove.
     */
    wireSpanMs?: number;
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
      time_to_first_suggestion_ms: props.timeToFirstSuggestionMs ?? null,
      wall_clock_ms: props.wallClockMs ?? null,
      peak_in_flight_batches: props.peakInFlightBatches ?? null,
      mean_in_flight_batches: props.meanInFlightBatches ?? null,
      wire_busy_ms: props.wireBusyMs ?? null,
      wire_span_ms: props.wireSpanMs ?? null,
    }),

  /**
   * `entitlement_exhausted` (U11) is the 402 `PHOTO_IMPORT_LIMIT_REACHED` stop.
   * It shared `unknown` with genuine client faults until U11 split it out, which
   * made an entitlement gate — a product outcome, with its own paywall follow-up
   * — indistinguishable from a bug in the error bucket.
   */
  photoImportApiError: (props: {
    errorType: 'quota_exhausted' | 'rate_limited' | 'entitlement_exhausted' | 'unknown';
  }) => track('photo_import_api_error', { error_type: props.errorType }),

  photoImportWorkflowCompleted: (props: {
    totalClusters: number;
    confirmedCount: number;
    rejectedCount: number;
    hiddenCount: number;
    workflowDurationMs: number;
    successRate: number;
    acceptanceRate: number;
    /** U11. Clusters whose row was ever scrolled into view. See `viewedClusterRate`. */
    viewedClusters?: number;
    /** U11. `viewedClusters / totalClusters` as a percentage. */
    viewedClusterRate?: number;
  }) =>
    track('photo_import_workflow_completed', {
      total_clusters: props.totalClusters,
      confirmed_count: props.confirmedCount,
      rejected_count: props.rejectedCount,
      hidden_count: props.hiddenCount,
      workflow_duration_ms: props.workflowDurationMs,
      success_rate: props.successRate,
      acceptance_rate: props.acceptanceRate,
      viewed_clusters: props.viewedClusters ?? null,
      viewed_cluster_rate: props.viewedClusterRate ?? null,
    }),

  photoImportWorkflowExited: (props: {
    totalClusters: number;
    processedClusters: number;
    remainingClusters: number;
    workflowDurationMs: number;
    /**
     * U11. Clusters whose row was ever scrolled into view before the user left.
     *
     * This is the number that decides the deferred on-demand-dispatch idea: if
     * most imports only ever surface a fraction of their clusters, matching every
     * cluster up front is buying results nobody looks at. A row counts once it
     * has been at least half visible, so mounting a cell offscreen does not.
     */
    viewedClusters?: number;
    /** U11. `viewedClusters / totalClusters` as a percentage. */
    viewedClusterRate?: number;
    /**
     * U11/R18. Clusters the dispatch controller had ACCEPTED at the moment the
     * user left. The denominator of the settled split — always >= `settledClusters`.
     */
    enqueuedClusters?: number;
    /**
     * U11/R18. Of `enqueuedClusters`, the ones that had reached a terminal state
     * (a response arrived, or a failure was attributed) when the user left.
     */
    settledClusters?: number;
    /**
     * U11/R18. `enqueuedClusters - settledClusters`: accepted, shown as a pending
     * row, and still unresolved at departure. Concurrent dispatch makes leaving
     * mid-flight normal, so this is the honest size of the abandoned tail.
     */
    unsettledClusters?: number;
    /**
     * U11/R18. Retry batch attempts summed over every dispatch generation in this
     * import (per-row retries and bulk retries alike).
     */
    retryAttempts?: number;
    /** U11/R18. Dispatch generations that needed at least one retry attempt. */
    retryGenerations?: number;
    /**
     * U11/R18. The largest retry-attempt count any single generation reached.
     * Separates "one bad generation" from "steady low-level retrying", which the
     * summed total cannot.
     */
    maxRetryAttemptsPerGeneration?: number;
  }) =>
    track('photo_import_workflow_exited', {
      total_clusters: props.totalClusters,
      processed_clusters: props.processedClusters,
      remaining_clusters: props.remainingClusters,
      workflow_duration_ms: props.workflowDurationMs,
      viewed_clusters: props.viewedClusters ?? null,
      viewed_cluster_rate: props.viewedClusterRate ?? null,
      enqueued_clusters: props.enqueuedClusters ?? null,
      settled_clusters: props.settledClusters ?? null,
      unsettled_clusters: props.unsettledClusters ?? null,
      retry_attempts: props.retryAttempts ?? null,
      retry_generations: props.retryGenerations ?? null,
      max_retry_attempts_per_generation: props.maxRetryAttemptsPerGeneration ?? null,
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

  revenueCatError: (props: { action: 'identify' | 'logout'; error: string }) =>
    track('revenuecat_error', {
      action: props.action,
      error: props.error,
    }),

  revenueCatIdentified: (props: { hasEntitlements: boolean; entitlements: string[] }) =>
    track('revenuecat_identified', {
      has_entitlements: props.hasEntitlements,
      entitlements: props.entitlements.join(',') || null,
    }),

  subscriptionStatusChanged: (props: { from: string; to: string; plan?: string }) =>
    track('subscription_status_changed', {
      from_status: props.from,
      to_status: props.to,
      plan: props.plan ?? null,
    }),

  // Travel Photo Quiz Events (funnel: created -> shared -> plays are
  // server-side -> install-CTA taps are server-side)
  quizCreated: (props: { quizId: string; photoCount: number }) =>
    track('quiz_created', { quiz_id: props.quizId, photo_count: props.photoCount }),

  quizShared: (props: { quizId: string }) => track('quiz_shared', { quiz_id: props.quizId }),

  quizRevoked: (props: { quizId: string }) => track('quiz_revoked', { quiz_id: props.quizId }),

  /**
   * The owner finished a play-through of their own quiz. Guests play on the
   * web (server-side funnel), so the in-app completion path is owner-only by
   * construction. Fires once per completed run: the seeding run in the happy
   * path, and again only when a pre-share swap forces the replacement photo
   * to be answered.
   */
  quizFirstRunCompleted: (props: { quizId: string; correct: number; total: number }) =>
    track('quiz_first_run_completed', {
      quiz_id: props.quizId,
      correct: props.correct,
      total: props.total,
    }),

  /**
   * The OS share sheet was opened for a challenge invitation. `source` is what
   * separates the first share on the results screen from every later re-share
   * off the leaderboard - `quiz_shared` only fires when a slug is minted, so
   * without this the two are indistinguishable in aggregate.
   */
  quizShareInitiated: (props: {
    quizId: string;
    source: QuizShareSource;
    isReshare: boolean;
    scoreCorrect: number | null;
    scoreTotal: number | null;
    photoCount: number | null;
  }) =>
    track('quiz_share_initiated', {
      quiz_id: props.quizId,
      source: props.source,
      is_reshare: props.isReshare,
      score_correct: props.scoreCorrect ?? null,
      score_total: props.scoreTotal ?? null,
      photo_count: props.photoCount ?? null,
    }),

  /**
   * The share sheet reported the share actually happened. iOS-only signal:
   * Android resolves sharedAction as soon as the sheet opens, so completion
   * is deliberately never fired there (matching reality beats inflating the
   * funnel).
   */
  quizShareCompleted: (props: {
    quizId: string;
    source: QuizShareSource;
    isReshare: boolean;
    photoCount: number | null;
  }) =>
    track('quiz_share_completed', {
      quiz_id: props.quizId,
      source: props.source,
      is_reshare: props.isReshare,
      photo_count: props.photoCount ?? null,
    }),

  /**
   * How the free on-device prediction compared with the paid eligibility gate,
   * aggregated per creation. This is the evidence that decides whether the
   * shadow-mode drop rules can be tightened over-the-air: `likely_rejected`
   * says the "likely" signal is unreliable, and `marginal_passed` is the
   * false-negative count a marginal drop rule would have cost users.
   */
  quizPrefilterAgreement: (props: {
    compared: number;
    likelySent: number;
    likelyPassed: number;
    unknownSent: number;
    unknownPassed: number;
    marginalSent: number;
    marginalPassed: number;
    likelyRejected: number;
    dropped: number;
    untagged: number;
    seededEligible: number;
  }) =>
    track('quiz_prefilter_agreement', {
      compared: props.compared,
      likely_sent: props.likelySent,
      likely_passed: props.likelyPassed,
      unknown_sent: props.unknownSent,
      unknown_passed: props.unknownPassed,
      marginal_sent: props.marginalSent,
      marginal_passed: props.marginalPassed,
      likely_rejected: props.likelyRejected,
      dropped: props.dropped,
      untagged: props.untagged,
      seeded_eligible: props.seededEligible,
    }),

  /**
   * Outcome of one background tagging pass. `no_local_image` is the number to
   * watch: if "Optimize iPhone Storage" evicts even 512px thumbnails at scale,
   * tag coverage stays low no matter how many passes run, and allowing network
   * access becomes worth considering.
   */
  photoTaggingPass: (props: {
    tagged: number;
    chunks: number;
    stoppedBy: string;
    coverageTotal: number;
    coverageCurrentVersion: number;
    noLocalImage: number;
    /** Rows written by the intent-metadata sweep that rode this pass; 0 when it did not run. */
    intentTagged?: number;
    /**
     * How that sweep ended, or absent when it was not due. Separates a sweep
     * that wrote nothing because it failed from one that had nothing to write.
     */
    intentStoppedBy?: string;
  }) =>
    track('photo_tagging_pass', {
      tagged: props.tagged,
      chunks: props.chunks,
      stopped_by: props.stoppedBy,
      coverage_total: props.coverageTotal,
      coverage_current_version: props.coverageCurrentVersion,
      no_local_image: props.noLocalImage,
      intent_tagged: props.intentTagged ?? 0,
      intent_stopped_by: props.intentStoppedBy ?? 'not-due',
    }),

  /**
   * Which source produced a trip's cover photo, and how the suggestion strip
   * performed when it was offered.
   *
   * `candidate_count` of 0 means the strip was not shown at all (no photo
   * cache, no tags, or a trip with no country) — the difference between "not
   * offered" and "offered and ignored" is the whole point of the event, and it
   * is what decides whether the TripDetail affordance is worth building.
   */
  tripCoverSuggestionUsed: (props: {
    source: 'suggested' | 'picker' | 'camera';
    candidateCount: number;
    chosenIndex: number | null;
  }) =>
    track('trip_cover_suggestion_used', {
      source: props.source,
      candidate_count: props.candidateCount,
      chosen_index: props.chosenIndex ?? null,
    }),

  /**
   * Per import: how many cluster photos were auto-hidden as screenshots or
   * near-duplicate repeats, and how many the user brought back.
   *
   * `restored_count` IS the false-positive rate. The seed rules are pure TS and
   * OTA-shippable, so a meaningfully non-zero restore count is the signal to
   * loosen them — the same lever `quiz_prefilter_agreement` provides for the
   * quiz prefilter, pointed the other way (that one asks whether to tighten).
   */
  photoGalleryDeemphasis: (props: {
    seededCount: number;
    restoredCount: number;
    clustersSeeded: number;
  }) =>
    track('photo_gallery_deemphasis', {
      seeded_count: props.seededCount,
      restored_count: props.restoredCount,
      clusters_seeded: props.clustersSeeded,
    }),

  // ---------------------------------------------------------------------
  // Guess Where funnel instrumentation
  //
  // Owner-side only. The guest half of the loop (page view -> play -> install
  // tap) is Google Analytics on the public page plus the per-quiz `quiz_funnel`
  // counters in Postgres, which already join back to the creator via
  // quiz.owner_id. `quiz_id` is emitted raw here on purpose: it is our own
  // resource id and the cross-surface join key.
  // ---------------------------------------------------------------------

  // -- Creation funnel: view -> started -> quiz_created (above), with failed
  //    and abandoned explaining every drop.

  viewQuizCreation: (props: {
    entryPoint: QuizEntryPoint;
    initialPhase: string;
    permissionStatus: string;
    limitedAccess: boolean;
    hasDraft: boolean;
    draftUploadedCount?: number | null;
    draftTotalCount?: number | null;
    libraryFresh?: boolean | null;
    freshnessReason?: string | null;
    cachedPhotoCount?: number | null;
  }) =>
    track('view_quiz_creation', {
      entry_point: props.entryPoint,
      initial_phase: props.initialPhase,
      permission_status: props.permissionStatus,
      limited_access: props.limitedAccess,
      has_draft: props.hasDraft,
      draft_uploaded_count: props.draftUploadedCount ?? null,
      draft_total_count: props.draftTotalCount ?? null,
      library_fresh: props.libraryFresh ?? null,
      freshness_reason: props.freshnessReason ?? null,
      cached_photo_count: props.cachedPhotoCount ?? null,
    }),

  /**
   * A build actually kicked off. `attempt_index` is 1-based WITHIN one mount,
   * so a user who retries after a decline shows up as a single visit with
   * several attempts rather than as several visitors.
   */
  quizCreationStarted: (props: {
    entryPoint: QuizEntryPoint;
    attemptIndex: number;
    isResume: boolean;
    scanExpected: boolean;
    limitedAccess: boolean;
    retryFrom?: string | null;
  }) =>
    track('quiz_creation_started', {
      entry_point: props.entryPoint,
      attempt_index: props.attemptIndex,
      is_resume: props.isResume,
      scan_expected: props.scanExpected,
      limited_access: props.limitedAccess,
      retry_from: props.retryFrom ?? null,
    }),

  /**
   * A suspended build picked up where it left off on the next foreground.
   *
   * The one number that says whether durability is actually saving runs: a
   * resume that reaches `quiz_created` is a challenge that, before the job
   * runtime, would have been thrown away when iOS reclaimed the app.
   */
  quizBuildResumed: (props: { stage: string; passes: number; foundCount: number }) =>
    track('quiz_build_resumed', {
      stage: props.stage,
      passes: props.passes,
      found_count: props.foundCount,
    }),

  // --- Continued-processing lease (docs/plans/2026-08-23-1325) -------------
  // Every event carries the tier so the reliability of each is measurable from
  // the first build. `job_continuation_capabilities` fires once per launch so
  // "is the feature live on this build" is answerable without starting a job.

  jobContinuationCapabilities: (props: {
    moduleAvailable: boolean;
    continuedProcessing: boolean;
    graceWindow: boolean;
    osMajor: number | null;
    flagEnabled: boolean;
  }) =>
    track('job_continuation_capabilities', {
      module_available: props.moduleAvailable,
      continued_processing: props.continuedProcessing,
      grace_window: props.graceWindow,
      os_major: props.osMajor,
      flag_enabled: props.flagEnabled,
    }),

  leaseBegin: (props: {
    tier: 'continued' | 'grace' | 'none';
    kind: string;
    resumed: boolean;
    lowPowerMode: boolean | null;
    backgroundRefreshStatus: string | null;
    skippedReason: string | null;
  }) =>
    track('lease_begin', {
      tier: props.tier,
      kind: props.kind,
      resumed: props.resumed,
      low_power_mode: props.lowPowerMode,
      background_refresh_status: props.backgroundRefreshStatus,
      skipped_reason: props.skippedReason,
    }),

  leaseHandlerFired: (props: { kind: string; latencyMs: number }) =>
    track('lease_handler_fired', { kind: props.kind, latency_ms: props.latencyMs }),

  leaseExpired: (props: {
    tier: 'continued' | 'grace';
    kind: string;
    appState: string;
    elapsedMs: number;
    percentage: number;
  }) =>
    track('lease_expired', {
      tier: props.tier,
      kind: props.kind,
      app_state: props.appState,
      elapsed_ms: props.elapsedMs,
      percentage: props.percentage,
    }),

  leaseEnded: (props: {
    tier: 'continued' | 'grace';
    kind: string;
    outcome: string;
    elapsedMs: number;
  }) =>
    track('lease_ended', {
      tier: props.tier,
      kind: props.kind,
      outcome: props.outcome,
      elapsed_ms: props.elapsedMs,
    }),

  /** The trip-scan mirror of `quizBuildResumed`: a suspended scan picked back up. */
  tripScanResumed: (props: { hadCheckpoint: boolean }) =>
    track('trip_scan_resumed', { had_checkpoint: props.hadCheckpoint }),

  /**
   * A resume gate tripped and the breadcrumb was cleared instead of resumed.
   * `gateId` is `staleness` or a descriptor gate id.
   */
  jobResumeGateHit: (props: { kind: string; gateId: string }) =>
    track('job_resume_gate_hit', { kind: props.kind, gate_id: props.gateId }),

  quizPhotoPermissionResult: (props: { status: string; entryPoint: QuizEntryPoint }) =>
    track('quiz_photo_permission_result', {
      status: props.status,
      entry_point: props.entryPoint,
    }),

  photoPermissionSoftAskShown: (props: { door: PhotoPermissionDoor }) =>
    track('photo_permission_soft_ask_shown', { door: props.door }),

  photoPermissionOsResult: (props: {
    door: PhotoPermissionDoor;
    status: PhotoPermissionOsStatus;
  }) =>
    track('photo_permission_os_result', {
      door: props.door,
      status: props.status,
    }),

  /**
   * The build reached a terminal NON-success state. Deliberately a different
   * event from `quiz_creation_abandoned`: a thin library is a gate-tuning
   * problem, a walk-out is a patience problem. `dominant_reason` is the number
   * to watch - it says whether the eligibility gate or the user's actual
   * library killed the run.
   */
  quizCreationFailed: (props: {
    entryPoint: QuizEntryPoint;
    reason: 'thin_library' | 'service_error' | 'interrupted';
    attemptIndex: number;
    durationMs: number;
    limitedAccess: boolean;
    eligibleCount?: number | null;
    hasGeoCandidates?: boolean | null;
    dominantReason?: string | null;
    stage?: string | null;
    uploadedCount?: number | null;
    totalCount?: number | null;
    examined?: number | null;
    foundCount?: number | null;
  }) =>
    track('quiz_creation_failed', {
      entry_point: props.entryPoint,
      reason: props.reason,
      attempt_index: props.attemptIndex,
      duration_ms: props.durationMs,
      limited_access: props.limitedAccess,
      eligible_count: props.eligibleCount ?? null,
      has_geo_candidates: props.hasGeoCandidates ?? null,
      dominant_reason: props.dominantReason ?? null,
      stage: props.stage ?? null,
      uploaded_count: props.uploadedCount ?? null,
      total_count: props.totalCount ?? null,
      examined: props.examined ?? null,
      found_count: props.foundCount ?? null,
    }),

  /**
   * The user left mid-build without any outcome arriving. `via_cancel_button`
   * false means the swipe-back / unmount path, which is the one that was
   * entirely silent before.
   */
  quizCreationAbandoned: (props: {
    entryPoint: QuizEntryPoint;
    phase: string;
    attemptIndex: number;
    durationMs: number;
    step?: string | null;
    foundCount: number;
    examined: number;
    uploadedCount: number;
    viaCancelButton: boolean;
  }) =>
    track('quiz_creation_abandoned', {
      entry_point: props.entryPoint,
      phase: props.phase,
      attempt_index: props.attemptIndex,
      duration_ms: props.durationMs,
      step: props.step ?? null,
      found_count: props.foundCount,
      examined: props.examined,
      uploaded_count: props.uploadedCount,
      via_cancel_button: props.viaCancelButton,
    }),

  // -- Play funnel

  viewQuizPlay: (props: {
    quizId: string;
    questionCount: number;
    resumedAtNumber: number;
    alreadyComplete: boolean;
  }) =>
    track('view_quiz_play', {
      quiz_id: props.quizId,
      question_count: props.questionCount,
      resumed_at_number: props.resumedAtNumber,
      is_resume: props.resumedAtNumber > 1,
      already_complete: props.alreadyComplete,
    }),

  /**
   * Left mid-play. The app has never had the per-question drop-off the web
   * gets from `quiz_answer`; this is its equivalent, and an owner who never
   * finishes can never share.
   */
  quizPlayAbandoned: (props: {
    quizId: string;
    answeredCount: number;
    total: number;
    activeNumber: number;
    durationMs: number;
    exit: 'back_button' | 'unmount';
  }) =>
    track('quiz_play_abandoned', {
      quiz_id: props.quizId,
      answered_count: props.answeredCount,
      total: props.total,
      active_number: props.activeNumber,
      duration_ms: props.durationMs,
      exit: props.exit,
      completion_rate: props.total > 0 ? Math.round((props.answeredCount / props.total) * 100) : 0,
    }),

  /** `stalled` is the 15s answer watchdog: a player who cannot progress. */
  quizPlayFailed: (props: {
    quizId: string;
    stage: 'load' | 'answer' | 'complete' | 'stalled';
    statusCode?: number | null;
    activeNumber?: number | null;
  }) =>
    track('quiz_play_failed', {
      quiz_id: props.quizId,
      stage: props.stage,
      status_code: props.statusCode ?? null,
      active_number: props.activeNumber ?? null,
    }),

  // -- Results, share and the owner-visible end of the viral loop

  viewQuizResults: (props: {
    quizId: string;
    arrivedFrom: 'play' | 'list';
    state: string;
    questionCount: number;
    scoreCorrect: number | null;
    scoreTotal: number | null;
    editable: boolean;
    needsAnswers: boolean;
  }) =>
    track('view_quiz_results', {
      quiz_id: props.quizId,
      arrived_from: props.arrivedFrom,
      state: props.state,
      question_count: props.questionCount,
      score_correct: props.scoreCorrect ?? null,
      score_total: props.scoreTotal ?? null,
      editable: props.editable,
      needs_answers: props.needsAnswers,
    }),

  /** Only `error_code` (the server's `detail.code`) - never the free-text message. */
  quizShareFailed: (props: {
    quizId: string;
    source: QuizShareSource;
    stage: 'mint' | 'sheet';
    errorCode: string | null;
  }) =>
    track('quiz_share_failed', {
      quiz_id: props.quizId,
      source: props.source,
      stage: props.stage,
      error_code: props.errorCode ?? null,
    }),

  viewQuizLeaderboard: (props: {
    quizId: string;
    entryCount: number;
    hiddenCount: number;
    scoreCorrect: number | null;
    scoreTotal: number | null;
  }) =>
    track('view_quiz_leaderboard', {
      quiz_id: props.quizId,
      entry_count: props.entryCount,
      hidden_count: props.hiddenCount,
      score_correct: props.scoreCorrect ?? null,
      score_total: props.scoreTotal ?? null,
      is_empty: props.entryCount === 0,
    }),

  /**
   * Someone new played a shared challenge. With the guest half of the funnel
   * living in Google Analytics, this is the ONLY owner-side proof in PostHog
   * that the loop closed. Never carries display names or session ids.
   */
  quizLeaderboardPlayersArrived: (props: {
    quizId: string;
    freshCount: number;
    entryCount: number;
  }) =>
    track('quiz_leaderboard_players_arrived', {
      quiz_id: props.quizId,
      fresh_count: props.freshCount,
      entry_count: props.entryCount,
    }),

  // -- Management and entry points

  viewMyQuizzes: (props: {
    entryPoint: QuizEntryPoint;
    quizCount: number;
    sharedCount: number;
    draftCount: number;
    loadFailed: boolean;
  }) =>
    track('view_my_quizzes', {
      entry_point: props.entryPoint,
      quiz_count: props.quizCount,
      shared_count: props.sharedCount,
      draft_count: props.draftCount,
      load_failed: props.loadFailed,
    }),

  viewGuessWhereIntro: (props: { entryPoint: QuizEntryPoint; reduceMotion: boolean }) =>
    track('view_guess_where_intro', {
      entry_point: props.entryPoint,
      reduce_motion: props.reduceMotion,
    }),

  /** Counterpart to quizRevoked, which was previously the only one of the pair. */
  quizDeleted: (props: { quizId: string; state: string }) =>
    track('quiz_deleted', { quiz_id: props.quizId, state: props.state }),

  /**
   * Which of the two swappable passport cards was shown. `watermark_unreadable`
   * matters because an unreadable import watermark reads as "has imported" -
   * without the flag this event's denominator would quietly lie.
   */
  passportEntryCardShown: (props: {
    card: 'guess_where' | 'photo_sync';
    hasQuizzes: boolean;
    quizCount: number;
    hasInitialImport: boolean;
    watermarkUnreadable: boolean;
  }) =>
    track('passport_entry_card_shown', {
      card: props.card,
      has_quizzes: props.hasQuizzes,
      quiz_count: props.quizCount,
      has_initial_import: props.hasInitialImport,
      watermark_unreadable: props.watermarkUnreadable,
    }),

  /**
   * A scan was requested from the photo-import idle screen, which is where the
   * "unlocks Guess Where challenges" promise is made. Deliberately distinct
   * from the service-level `photo_import_scan_started`, which fires too deep in
   * the pipeline to know what promised the scan.
   */
  photoSyncScanTapped: (props: { isRefresh: boolean; isFirstRun: boolean }) =>
    track('photo_sync_scan_tapped', {
      is_refresh: props.isRefresh,
      is_first_run: props.isFirstRun,
    }),

  // Post-paywall "make your first quiz" offer
  firstQuizOfferShown: () => track('first_quiz_offer_shown'),
  /**
   * Accept goes straight to the creation wizard, so an accept from a device
   * that has never scanned its camera roll lands on the permission wall.
   * `has_initial_import` is how many of those there are.
   */
  firstQuizOfferAccepted: (props: { hasInitialImport: boolean }) =>
    track('first_quiz_offer_accepted', { has_initial_import: props.hasInitialImport }),
  firstQuizOfferSkipped: () => track('first_quiz_offer_skipped'),

  // Review Request Events
  reviewSatisfactionShown: (
    trigger: 'post_onboarding' | 'country_visited' | 'first_social_save' | 'first_photo_import'
  ) => track('review_satisfaction_shown', { trigger }),
  reviewSatisfactionPositive: (
    trigger: 'post_onboarding' | 'country_visited' | 'first_social_save' | 'first_photo_import'
  ) => track('review_satisfaction_positive', { trigger }),
  reviewSatisfactionNegative: (
    trigger: 'post_onboarding' | 'country_visited' | 'first_social_save' | 'first_photo_import'
  ) => track('review_satisfaction_negative', { trigger }),
  reviewSatisfactionDismissed: (
    trigger: 'post_onboarding' | 'country_visited' | 'first_social_save' | 'first_photo_import'
  ) => track('review_satisfaction_dismissed', { trigger }),
  reviewNativeRequested: () => track('review_native_requested'),
  reviewNativeUnavailable: () => track('review_native_unavailable'),
  reviewNativeError: (error: string) => track('review_native_error', { error }),
  reviewSupportLinkTapped: () => track('review_support_link_tapped'),
};
