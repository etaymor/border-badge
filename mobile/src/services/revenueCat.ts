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

// Shared init promise to ensure configure() completes before logIn()/logOut()
let initPromise: Promise<void> | null = null;

/**
 * Initialize RevenueCat SDK
 * Should be called once at app startup before any purchases.
 * Returns a shared promise that can be awaited by other functions.
 */
export function initializeRevenueCat(): Promise<void> {
  // Return existing promise if initialization is in progress or complete
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    // Skip if already configured
    if (await Purchases.isConfigured()) {
      return;
    }

    // Enable debug logs in development
    if (isDevelopment) {
      Purchases.setLogLevel(LOG_LEVEL.DEBUG);
    }

    const apiKey = Platform.OS === 'ios' ? env.revenueCatIosApiKey : env.revenueCatAndroidApiKey;

    if (!apiKey) {
      console.warn('[RevenueCat] No API key configured for platform:', Platform.OS);
      return;
    }

    await Purchases.configure({
      apiKey,
      appUserID: null, // Anonymous until user authenticates
    });

    console.log('[RevenueCat] SDK initialized');
  })();

  return initPromise;
}

/**
 * Identify user with RevenueCat after authentication
 * Links purchases to user's account across devices.
 * Waits for SDK initialization to complete before calling logIn().
 */
export async function identifyUser(userId: string): Promise<CustomerInfo> {
  // Ensure SDK is initialized before calling logIn
  // If initPromise is null, trigger initialization to avoid calling logIn() before configure()
  if (!initPromise) {
    initPromise = initializeRevenueCat();
  }
  await initPromise;

  const { customerInfo } = await Purchases.logIn(userId);
  if (isDevelopment) {
    // Only log user ID in development - never in production
    console.log('[RevenueCat] User identified:', userId);
  } else {
    console.log('[RevenueCat] User identified');
  }
  return customerInfo;
}

/**
 * Log out user from RevenueCat
 * Resets to anonymous user - call on sign out.
 * Waits for SDK initialization to complete before calling logOut().
 */
export async function logOutUser(): Promise<CustomerInfo> {
  // Ensure SDK is initialized before calling logOut
  // If initPromise is null, trigger initialization to avoid calling logOut() before configure()
  if (!initPromise) {
    initPromise = initializeRevenueCat();
  }
  await initPromise;

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
