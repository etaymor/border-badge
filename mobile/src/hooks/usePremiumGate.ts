/**
 * usePremiumGate - Hook for checking premium feature access and showing paywall
 *
 * Provides utilities to:
 * - Check if user can access premium features
 * - Get remaining usage for limited features
 * - Show paywall modal when limits are exceeded
 *
 * Note: These checks are for UX optimization only.
 * Backend MUST enforce limits to prevent bypass.
 */

import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Analytics } from '@services/analytics';
import {
  useSubscriptionStore,
  useIsPremium,
  useCanUseShareExtension,
  useCanImportPhotos,
  useShareExtensionRemaining,
  FREE_LIMITS,
} from '@stores/subscriptionStore';
import type { RootStackParamList, GatedFeature } from '@navigation/types';

export type { GatedFeature };

export interface GateResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  used: number;
}

export function usePremiumGate() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const isPremium = useIsPremium();
  const canUseShare = useCanUseShareExtension();
  const canImportPhotos = useCanImportPhotos();
  const shareExtensionRemaining = useShareExtensionRemaining();
  const { photoImportUsage } = useSubscriptionStore();

  /**
   * Check if user can access a feature
   * For entries, pass the current entry count for the trip
   */
  const checkAccess = useCallback(
    (feature: GatedFeature, tripEntryCount?: number): GateResult => {
      if (isPremium) {
        return { allowed: true, remaining: Infinity, limit: Infinity, used: 0 };
      }

      switch (feature) {
        case 'shareExtension': {
          // shareExtensionRemaining already accounts for monthly period reset
          const effectiveRemaining =
            shareExtensionRemaining === Infinity ? Infinity : shareExtensionRemaining;
          const effectiveUsed =
            shareExtensionRemaining === Infinity
              ? 0
              : FREE_LIMITS.shareExtension - shareExtensionRemaining;
          return {
            allowed: canUseShare,
            remaining: effectiveRemaining,
            limit: FREE_LIMITS.shareExtension,
            used: effectiveUsed,
          };
        }
        case 'photoImport':
          return {
            allowed: canImportPhotos,
            remaining: Math.max(0, FREE_LIMITS.photoImport - photoImportUsage),
            limit: FREE_LIMITS.photoImport,
            used: photoImportUsage,
          };
        case 'entries': {
          const count = tripEntryCount ?? 0;
          return {
            allowed: count < FREE_LIMITS.entriesPerTrip,
            remaining: Math.max(0, FREE_LIMITS.entriesPerTrip - count),
            limit: FREE_LIMITS.entriesPerTrip,
            used: count,
          };
        }
        default:
          return { allowed: true, remaining: Infinity, limit: Infinity, used: 0 };
      }
    },
    [isPremium, canUseShare, canImportPhotos, shareExtensionRemaining, photoImportUsage]
  );

  /**
   * Show paywall if user doesn't have access to the feature
   * Returns true if access is allowed, false if paywall was shown
   */
  const showPaywallIfNeeded = useCallback(
    (feature: GatedFeature, tripEntryCount?: number): boolean => {
      const result = checkAccess(feature, tripEntryCount);
      if (!result.allowed) {
        // Track that user hit a feature limit
        Analytics.featureLimitHit({ feature, remaining: result.remaining });

        // Navigate to paywall modal with feature context
        // The PaywallModal will show a message based on the feature
        navigation.navigate('PaywallModal', { feature });
        return false;
      }
      return true;
    },
    [checkAccess, navigation]
  );

  return {
    isPremium,
    checkAccess,
    showPaywallIfNeeded,
  };
}
