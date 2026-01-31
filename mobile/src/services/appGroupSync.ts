/**
 * App Group Sync Service - Syncs subscription status to App Group for Share Extension
 *
 * Uses SharedGroupPreferences native module to write subscription data to the
 * App Group shared container that the iOS Share Extension can read.
 */

import { NativeModules, Platform } from 'react-native';
import { CustomerInfo } from 'react-native-purchases';
import { isPremium, getExpirationDate, ENTITLEMENT_ID } from './revenueCat';

const { SharedGroupPreferences } = NativeModules;

// Keys for subscription data in App Group
export const APP_GROUP_KEYS = {
  subscriptionStatus: 'subscription_status',
  subscriptionExpires: 'subscription_expires',
  usageShareExtension: 'usage_share_extension',
  usageShareExtensionPeriodStart: 'usage_share_extension_period_start',
  usagePhotoImport: 'usage_photo_import',
} as const;

/**
 * Sync subscription status to App Group for Share Extension access
 */
export async function syncSubscriptionToAppGroup(customerInfo: CustomerInfo): Promise<void> {
  if (Platform.OS !== 'ios') return;

  if (!SharedGroupPreferences) {
    console.warn('[AppGroupSync] SharedGroupPreferences native module not available');
    return;
  }

  try {
    const premium = isPremium(customerInfo);
    const expiration = getExpirationDate(customerInfo);
    const entitlement = customerInfo.entitlements.active[ENTITLEMENT_ID];

    // Determine status: premium, trial, or free
    let status: 'premium' | 'trial' | 'free' = 'free';
    if (premium) {
      status = entitlement?.periodType === 'TRIAL' ? 'trial' : 'premium';
    }

    await Promise.all([
      SharedGroupPreferences.setItem(APP_GROUP_KEYS.subscriptionStatus, status),
      SharedGroupPreferences.setItem(
        APP_GROUP_KEYS.subscriptionExpires,
        expiration?.toISOString() ?? ''
      ),
    ]);

    console.log('[AppGroupSync] Synced subscription status:', status);
  } catch (error) {
    console.error('[AppGroupSync] Failed to sync subscription:', error);
  }
}

/**
 * Sync usage counts to App Group for Share Extension access
 */
export async function syncUsageToAppGroup(
  shareCount: number,
  photoCount: number,
  sharePeriodStart?: string | null
): Promise<void> {
  if (Platform.OS !== 'ios') return;

  if (!SharedGroupPreferences) {
    console.warn('[AppGroupSync] SharedGroupPreferences native module not available');
    return;
  }

  try {
    await Promise.all([
      SharedGroupPreferences.setItem(APP_GROUP_KEYS.usageShareExtension, String(shareCount)),
      SharedGroupPreferences.setItem(
        APP_GROUP_KEYS.usageShareExtensionPeriodStart,
        sharePeriodStart ?? ''
      ),
      SharedGroupPreferences.setItem(APP_GROUP_KEYS.usagePhotoImport, String(photoCount)),
    ]);

    console.log('[AppGroupSync] Synced usage counts - share:', shareCount, 'photo:', photoCount);
  } catch (error) {
    console.error('[AppGroupSync] Failed to sync usage:', error);
  }
}

/**
 * Read subscription status from App Group (for debugging/testing)
 */
export async function getSubscriptionFromAppGroup(): Promise<{
  status: string | null;
  expires: string | null;
}> {
  if (Platform.OS !== 'ios') {
    return { status: null, expires: null };
  }

  if (!SharedGroupPreferences) {
    return { status: null, expires: null };
  }

  try {
    const status = await SharedGroupPreferences.getItem(APP_GROUP_KEYS.subscriptionStatus);
    const expires = await SharedGroupPreferences.getItem(APP_GROUP_KEYS.subscriptionExpires);

    return { status, expires };
  } catch (error) {
    console.error('[AppGroupSync] Failed to read subscription:', error);
    return { status: null, expires: null };
  }
}
