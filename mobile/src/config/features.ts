import { isDevelopment } from './env';

// Feature flags for gradual rollout and A/B testing
// These can be toggled via environment variables or remote config in the future

// Helper to check environment variable boolean
const isEnvEnabled = (envVar: string | undefined): boolean => envVar === 'true';

export const features = {
  // Map features
  enableInteractiveMap: true,
  enableMapClustering: true,

  // Trip features
  enableTripPhotos: false, // Phase 3+
  enableTripSharing: false, // Phase 4+

  // Social features - controlled by EXPO_PUBLIC_ENABLE_SOCIAL environment variable
  // When false: Friends tab hidden, no social UI, no social API calls
  // Set EXPO_PUBLIC_ENABLE_SOCIAL=true to enable
  enableSocial: isEnvEnabled(process.env.EXPO_PUBLIC_ENABLE_SOCIAL),

  // Legacy flags (kept for compatibility, will be removed)
  enableFriends: isEnvEnabled(process.env.EXPO_PUBLIC_ENABLE_SOCIAL), // Alias for enableSocial
  enableLeaderboards: false, // Phase 5+

  // Premium features
  enablePremiumBadges: false, // Phase 6+
  enableOfflineMode: false, // Phase 7+

  // Debug features (only in development)
  showDebugInfo: isDevelopment && process.env.EXPO_PUBLIC_ENABLE_DEV_TOOLS === 'true',
  enableNetworkInspector: isDevelopment,
} as const;

// Type for feature flag keys
export type FeatureFlag = keyof typeof features;

// Helper to check if a feature is enabled
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return features[flag];
}
