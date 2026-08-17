/**
 * RevenueCat Service - SDK initialization and subscription helpers
 *
 * Handles RevenueCat SDK configuration, user identification, and subscription
 * status checking. Uses "Full Access" entitlement for premium features.
 */

import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL, CustomerInfo } from 'react-native-purchases';
import { AppEventsLogger } from 'react-native-fbsdk-next';
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

// Shared logIn promise so the paywall can wait for user identification.
// Resolves to true if logIn succeeded, false if it failed or was never called.
let logInPromise: Promise<boolean> | null = null;
let resolveLogIn: ((success: boolean) => void) | null = null;

/**
 * Create the logIn promise that paywall presentation can await.
 * Called by useAuthSession before firing identifyUser().
 */
export function prepareLogIn(): void {
  // Settle any pending promise from a previous call so it doesn't hang forever
  if (resolveLogIn) {
    resolveLogIn(false);
    resolveLogIn = null;
  }
  logInPromise = new Promise<boolean>((resolve) => {
    resolveLogIn = resolve;
  });
}

/**
 * Signal that logIn completed (success or failure).
 */
export function settleLogIn(success: boolean): void {
  resolveLogIn?.(success);
  resolveLogIn = null;
}

/**
 * Wait for the logIn flow to finish. Returns true if the user was
 * successfully identified, false otherwise. If no logIn was initiated
 * (e.g. user is not authenticated), resolves immediately with false.
 */
export function waitForLogIn(): Promise<boolean> {
  return logInPromise ?? Promise.resolve(false);
}

/**
 * Send Facebook Anonymous ID to RevenueCat so the Meta Ads integration
 * can match subscription events back to the originating ad click.
 */
async function setFBAnonymousIDIfAvailable(): Promise<void> {
  try {
    const fbAnonId = await AppEventsLogger.getAnonymousID();
    if (fbAnonId) {
      await Purchases.setFBAnonymousID(fbAnonId);
    }
  } catch {
    // Facebook SDK may not be ready yet — non-fatal
  }
}

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

    // Collect device identifiers (IDFA if ATT granted, IDFV) for attribution matching
    Purchases.collectDeviceIdentifiers();

    // Enable automatic Apple Search Ads attribution token collection (iOS only)
    if (Platform.OS === 'ios') {
      Purchases.enableAdServicesAttributionTokenCollection();
    }

    // Send Facebook Anonymous ID to RevenueCat for Meta Ads attribution matching
    setFBAnonymousIDIfAvailable();

    console.log('[RevenueCat] SDK initialized');
  })();

  return initPromise;
}

/**
 * Identify user with RevenueCat after authentication.
 * Links purchases to user's account across devices and sets subscriber
 * attributes (email, displayName) so they appear in the RevenueCat dashboard.
 * Waits for SDK initialization to complete before calling logIn().
 */
export async function identifyUser(
  userId: string,
  attributes?: { email?: string; displayName?: string }
): Promise<CustomerInfo> {
  // Ensure SDK is initialized before calling logIn
  // If initPromise is null, trigger initialization to avoid calling logIn() before configure()
  if (!initPromise) {
    initPromise = initializeRevenueCat();
  }
  await initPromise;

  const { customerInfo } = await Purchases.logIn(userId);

  // Set subscriber attributes for the RevenueCat dashboard.
  // These are the reserved attribute keys that RC displays natively.
  if (attributes?.email) {
    await Purchases.setEmail(attributes.email);
  }
  if (attributes?.displayName) {
    await Purchases.setDisplayName(attributes.displayName);
  }

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
