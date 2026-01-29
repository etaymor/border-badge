/**
 * useSubscription - Hook for managing RevenueCat subscription state
 *
 * Handles:
 * - Listening for subscription changes from RevenueCat
 * - Fetching usage limits from backend
 * - Purchase and restore operations
 * - Syncing subscription status to App Group for Share Extension
 */

import { useCallback, useEffect, useRef } from 'react';
import Purchases, {
  PurchasesPackage,
  PURCHASES_ERROR_CODE,
  CustomerInfo,
} from 'react-native-purchases';
import { useSubscriptionStore, FREE_LIMITS } from '@stores/subscriptionStore';
import { syncSubscriptionToAppGroup } from '@services/appGroupSync';
import { api } from '@services/api';
import { ENTITLEMENT_ID } from '@services/revenueCat';

// Type guard for RevenueCat errors
function isPurchasesError(error: unknown): error is { code: string; message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as Record<string, unknown>).code === 'string'
  );
}

interface PurchaseResult {
  success: boolean;
  error: string | null;
}

export function useSubscription() {
  const { status, plan, expirationDate, setCustomerInfo, setUsageLimits, setStatus } =
    useSubscriptionStore();

  // Track mount state to prevent state updates after unmount
  const isMountedRef = useRef(true);
  // Version counter to handle listener vs fetch race condition
  const versionRef = useRef(0);

  // Fetch customer info from RevenueCat
  const fetchCustomerInfo = useCallback(async () => {
    try {
      const isConfigured = await Purchases.isConfigured();
      if (!isConfigured) {
        console.warn('[useSubscription] RevenueCat not configured');
        setStatus('free');
        return;
      }

      const info = await Purchases.getCustomerInfo();
      if (isMountedRef.current) {
        setCustomerInfo(info);
        syncSubscriptionToAppGroup(info).catch((error) => {
          console.error('Failed to sync subscription to App Group:', error);
        });
      }
    } catch (error) {
      console.error('[useSubscription] Failed to fetch customer info:', error);
      if (isMountedRef.current) {
        setStatus('free'); // Fail safe to free
      }
    }
  }, [setCustomerInfo, setStatus]);

  // Fetch usage limits from backend
  const fetchUsageLimits = useCallback(async () => {
    try {
      const response = await api.get<{
        share_extension_count: number;
        photo_import_count: number;
      }>('/subscriptions/usage');
      if (isMountedRef.current) {
        setUsageLimits(response.data.share_extension_count, response.data.photo_import_count);
      }
    } catch (error) {
      console.error('[useSubscription] Failed to fetch usage limits:', error);
    }
  }, [setUsageLimits]);

  // Set up listener for subscription changes
  useEffect(() => {
    isMountedRef.current = true;
    const currentVersion = ++versionRef.current;

    // Create a stable listener function that can be removed on cleanup
    const customerInfoListener = (info: CustomerInfo) => {
      // Only process if still mounted and this is the latest version
      if (isMountedRef.current && versionRef.current === currentVersion) {
        setCustomerInfo(info);
        syncSubscriptionToAppGroup(info).catch((err) => {
          console.error('Failed to sync subscription to App Group:', err);
        });
      }
    };

    // Add listener
    Purchases.addCustomerInfoUpdateListener(customerInfoListener);

    // Initial fetch
    void fetchCustomerInfo();
    void fetchUsageLimits();

    return () => {
      isMountedRef.current = false;
      // Remove the listener to prevent memory leaks
      Purchases.removeCustomerInfoUpdateListener(customerInfoListener);
    };
  }, [setCustomerInfo, fetchCustomerInfo, fetchUsageLimits]);

  // Purchase a package
  const purchasePackage = useCallback(
    async (pkg: PurchasesPackage): Promise<PurchaseResult> => {
      try {
        const { customerInfo } = await Purchases.purchasePackage(pkg);
        if (isMountedRef.current) {
          setCustomerInfo(customerInfo);
          syncSubscriptionToAppGroup(customerInfo).catch((error) => {
            console.error('Failed to sync subscription to App Group:', error);
          });
        }
        return { success: true, error: null };
      } catch (error: unknown) {
        if (isPurchasesError(error)) {
          if (error.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
            return { success: false, error: 'cancelled' };
          }
          return { success: false, error: error.message };
        }
        return { success: false, error: 'Unknown error' };
      }
    },
    [setCustomerInfo]
  );

  // Restore purchases
  const restorePurchases = useCallback(async (): Promise<PurchaseResult> => {
    try {
      const customerInfo = await Purchases.restorePurchases();
      if (isMountedRef.current) {
        setCustomerInfo(customerInfo);
        syncSubscriptionToAppGroup(customerInfo).catch((error) => {
          console.error('Failed to sync subscription to App Group:', error);
        });
      }
      const hasActive = customerInfo.entitlements.active[ENTITLEMENT_ID] !== undefined;
      return { success: hasActive, error: null };
    } catch (error: unknown) {
      if (isPurchasesError(error)) {
        return { success: false, error: error.message };
      }
      return { success: false, error: 'Unknown error' };
    }
  }, [setCustomerInfo]);

  return {
    // Status
    status,
    plan,
    expirationDate,
    isPremium: status === 'premium' || status === 'trial',
    isTrialing: status === 'trial',
    isLoading: status === 'loading',

    // Limits
    limits: FREE_LIMITS,

    // Actions
    purchasePackage,
    restorePurchases,
    refetch: fetchCustomerInfo,
    refetchUsage: fetchUsageLimits,
  };
}
