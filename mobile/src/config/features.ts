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
