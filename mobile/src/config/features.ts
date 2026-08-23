import { env, isDevelopment } from './env';

// Feature flags for gradual rollout and A/B testing
// These can be toggled via environment variables or remote config in the future

export const features = {
  // Map features
  enableInteractiveMap: true,
  enableMapClustering: true,

  // Trip features
  enableTripPhotos: false, // Phase 3+
  enableTripSharing: false, // Phase 4+

  // Social features
  enableFriends: false, // Phase 5+
  enableLeaderboards: false, // Phase 5+

  // Premium features
  enablePremiumBadges: false, // Phase 6+
  enableOfflineMode: false, // Phase 7+

  // Guess Where photo pre-tagging. Three flags rather than one because these
  // fail in different ways and want to be killed independently:
  // - tagging is background CPU work (kill it if devices get hot or janky)
  // - the prefilter changes WHICH photos reach the paid gate (kill it if the
  //   on-device drops turn out to reject photos the gate would have passed)
  // - the verdict cache changes whether we call the gate at all (kill it if a
  //   stale verdict ever seeds a game with a photo that should not be in one)
  enablePhotoTagging: true,
  enableTagPrefilter: true,
  enableVerdictCache: true,

  // Photo quality signal layer (docs/plans/2026-08-21-001). Two flags:
  // - intent signals are background metadata reads (kill if the whole-library
  //   pass is slow or PHAssetResource enumeration misbehaves at scale)
  // - quality ranking changes photo ORDER on quiz/vision/curation surfaces
  //   (kill if the composite score surfaces worse photos than chronology)
  enableIntentSignals: true,
  enableQualityRanking: true,

  // Continued-processing lease for library jobs (docs/plans/2026-08-23-1325).
  // The driver is JS, so flipping this ships over the air without a native
  // build: the module stays in the binary and simply is never called. Kill
  // trigger: `lease_expired{tier:'continued'}` above 30% of
  // `lease_begin{tier:'continued'}` in the first 48 h after a build promotes
  // (min 20 begins from non-checklist devices, read with the elapsedMs
  // distribution — system-UI cancels count as expiries), or any tester report
  // of the system progress UI misbehaving.
  enableJobContinuationLease: true,

  // Debug features (only in development)
  showDebugInfo: isDevelopment && env.enableDevTools,
  enableNetworkInspector: isDevelopment,
} as const;

// Type for feature flag keys
export type FeatureFlag = keyof typeof features;

// Helper to check if a feature is enabled
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return features[flag];
}
