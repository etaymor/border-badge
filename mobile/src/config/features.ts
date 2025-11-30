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
