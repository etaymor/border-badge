/**
 * RevenueCat Service - SDK initialization and subscription helpers
 *
 * Handles RevenueCat SDK configuration, user identification, and subscription
 * status checking. Uses "Full Access" entitlement for premium features.
 */

import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL, CustomerInfo } from 'react-native-purchases';
import { env, isDevelopment } from '@config/env';

// Entitlement ID configured in RevenueCat dashboard
export const ENTITLEMENT_ID = 'Full Access';

// Product identifiers
export const PRODUCT_IDS = {
  weekly: 'com.atlasi.app.Weekly',
  monthly: 'com.atlasi.app.Monthly',
  annual: 'com.atlasi.app.Annual',
} as const;

/**
 * Initialize RevenueCat SDK
 * Should be called once at app startup before any purchases
 */
export async function initializeRevenueCat(): Promise<void> {
  // Skip if already configured
  if (await Purchases.isConfigured()) {
    return;
  }

  // Enable debug logs in development
  if (isDevelopment) {
    Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  }

  const apiKey =
    Platform.OS === 'ios' ? env.revenueCatIosApiKey : env.revenueCatAndroidApiKey;

  if (!apiKey) {
    console.warn('[RevenueCat] No API key configured for platform:', Platform.OS);
    return;
  }

  await Purchases.configure({
    apiKey,
    appUserID: null, // Anonymous until user authenticates
  });

  console.log('[RevenueCat] SDK initialized');
}

/**
 * Identify user with RevenueCat after authentication
 * Links purchases to user's account across devices
 */
export async function identifyUser(userId: string): Promise<CustomerInfo> {
  const { customerInfo } = await Purchases.logIn(userId);
  console.log('[RevenueCat] User identified:', userId);
  return customerInfo;
}

/**
 * Log out user from RevenueCat
 * Resets to anonymous user - call on sign out
 */
export async function logOutUser(): Promise<CustomerInfo> {
  const customerInfo = await Purchases.logOut();
  console.log('[RevenueCat] User logged out');
  return customerInfo;
}

/**
 * Check if user has active premium entitlement
 */
export function isPremium(customerInfo: CustomerInfo): boolean {
  return customerInfo.entitlements.active[ENTITLEMENT_ID] !== undefined;
}

/**
 * Check if user is currently in a trial period
 */
export function isTrialing(customerInfo: CustomerInfo): boolean {
  const entitlement = customerInfo.entitlements.active[ENTITLEMENT_ID];
  return entitlement?.periodType === 'TRIAL';
}

/**
 * Get the active subscription plan type
 */
export function getSubscriptionPlan(
  customerInfo: CustomerInfo
): 'weekly' | 'monthly' | 'annual' | null {
  const entitlement = customerInfo.entitlements.active[ENTITLEMENT_ID];
  if (!entitlement) return null;

  const productId = entitlement.productIdentifier;
  if (productId === PRODUCT_IDS.weekly) return 'weekly';
  if (productId === PRODUCT_IDS.monthly) return 'monthly';
  if (productId === PRODUCT_IDS.annual) return 'annual';

  return null;
}

/**
 * Get expiration date of current subscription
 */
export function getExpirationDate(customerInfo: CustomerInfo): Date | null {
  const entitlement = customerInfo.entitlements.active[ENTITLEMENT_ID];
  if (!entitlement?.expirationDate) return null;
  return new Date(entitlement.expirationDate);
}
