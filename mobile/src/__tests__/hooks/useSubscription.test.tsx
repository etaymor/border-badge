/**
 * Tests for useSubscription hook.
 *
 * Covers:
 * - Initialization and cleanup
 * - Purchase and restore operations
 * - Error handling
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Purchases, {
  CustomerInfo,
  PurchasesPackage,
  PURCHASES_ERROR_CODE,
} from 'react-native-purchases';

import { useSubscription } from '@hooks/useSubscription';
import { useSubscriptionStore, FREE_LIMITS } from '@stores/subscriptionStore';
import { api } from '@services/api';
import { createTestQueryClient } from '../utils/testUtils';

// Type the mocks
const mockGetCustomerInfo = Purchases.getCustomerInfo as jest.Mock;
const mockIsConfigured = Purchases.isConfigured as jest.Mock;
const mockPurchasePackage = Purchases.purchasePackage as jest.Mock;
const mockRestorePurchases = Purchases.restorePurchases as jest.Mock;
const mockAddCustomerInfoUpdateListener = Purchases.addCustomerInfoUpdateListener as jest.Mock;

// Mock revenueCat service
jest.mock('@services/revenueCat', () => ({
  isPremium: jest.fn((info: CustomerInfo) => {
    return info.entitlements?.active?.['Full Access'] !== undefined;
  }),
  isTrialing: jest.fn((info: CustomerInfo) => {
    return info.entitlements?.active?.['Full Access']?.periodType === 'TRIAL';
  }),
  getSubscriptionPlan: jest.fn(() => 'monthly'),
  getExpirationDate: jest.fn(() => new Date('2025-12-31')),
  ENTITLEMENT_ID: 'Full Access',
}));

// Mock appGroupSync
jest.mock('@services/appGroupSync', () => ({
  syncSubscriptionToAppGroup: jest.fn().mockResolvedValue(undefined),
  syncUsageToAppGroup: jest.fn().mockResolvedValue(undefined),
}));

// Mock analytics
jest.mock('@services/analytics', () => ({
  Analytics: {
    subscriptionStatusChanged: jest.fn(),
    featureLimitHit: jest.fn(),
  },
}));

// Mock API
jest.mock('@services/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockApi = api as jest.Mocked<typeof api>;

// Helper to create mock CustomerInfo
function createMockCustomerInfo(
  overrides: {
    hasFullAccess?: boolean;
    periodType?: string;
  } = {}
): CustomerInfo {
  const { hasFullAccess = false, periodType = 'NORMAL' } = overrides;

  return {
    entitlements: {
      active: hasFullAccess
        ? {
            'Full Access': {
              identifier: 'Full Access',
              isActive: true,
              periodType,
              productIdentifier: 'com.atlasi.app.Monthly',
              expirationDate: '2025-12-31T23:59:59.000Z',
            },
          }
        : {},
      all: {},
    },
    activeSubscriptions: hasFullAccess ? ['com.atlasi.app.Monthly'] : [],
    allPurchasedProductIdentifiers: [],
  } as unknown as CustomerInfo;
}

// Create wrapper for hooks
function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useSubscription', () => {
  let queryClient: QueryClient;
  let removeListenerMock: jest.Mock;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    removeListenerMock = jest.fn();

    // Reset store
    useSubscriptionStore.setState({
      status: 'loading',
      plan: null,
      expirationDate: null,
      shareExtensionUsage: 0,
      photoImportUsage: 0,
    });

    // Reset all mocks
    jest.clearAllMocks();

    // Setup default mock behavior
    mockIsConfigured.mockResolvedValue(true);
    mockGetCustomerInfo.mockResolvedValue(createMockCustomerInfo());
    mockAddCustomerInfoUpdateListener.mockReturnValue(removeListenerMock);
    mockApi.get.mockResolvedValue({
      data: { share_extension_count: 2, photo_import_count: 0 },
    });
  });

  describe('Return values', () => {
    it('returns correct isPremium based on status', async () => {
      useSubscriptionStore.setState({ status: 'premium' });
      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(queryClient),
      });

      expect(result.current.isPremium).toBe(true);
    });

    it('returns correct isTrialing based on status', async () => {
      useSubscriptionStore.setState({ status: 'trial' });
      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(queryClient),
      });

      expect(result.current.isTrialing).toBe(true);
    });

    it('returns isLoading when status is loading', async () => {
      useSubscriptionStore.setState({ status: 'loading' });
      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(queryClient),
      });

      expect(result.current.isLoading).toBe(true);
    });

    it('returns FREE_LIMITS constant', async () => {
      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(queryClient),
      });

      expect(result.current.limits).toEqual(FREE_LIMITS);
    });

    it('exposes refetch and refetchUsage functions', async () => {
      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(queryClient),
      });

      expect(typeof result.current.refetch).toBe('function');
      expect(typeof result.current.refetchUsage).toBe('function');
    });
  });

  describe('Initialization', () => {
    it('sets up RevenueCat customer info listener on mount', async () => {
      renderHook(() => useSubscription(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(mockAddCustomerInfoUpdateListener).toHaveBeenCalled();
      });
    });

    it('fetches initial customer info', async () => {
      renderHook(() => useSubscription(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(mockGetCustomerInfo).toHaveBeenCalled();
      });
    });

    it('fetches initial usage limits from backend', async () => {
      renderHook(() => useSubscription(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(mockApi.get).toHaveBeenCalledWith('/subscriptions/usage');
      });
    });
  });

  describe('Cleanup', () => {
    it('removes customer info listener on unmount', async () => {
      const { unmount } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(mockAddCustomerInfoUpdateListener).toHaveBeenCalled();
      });

      unmount();

      // The mock returns a remove function that should be called
      expect(Purchases.removeCustomerInfoUpdateListener).toHaveBeenCalled();
    });
  });

  describe('purchasePackage', () => {
    const mockPackage = {
      identifier: 'monthly',
      packageType: 'MONTHLY',
      product: { identifier: 'com.atlasi.app.Monthly' },
    } as unknown as PurchasesPackage;

    it('calls Purchases.purchasePackage with provided package', async () => {
      mockPurchasePackage.mockResolvedValueOnce({
        customerInfo: createMockCustomerInfo({ hasFullAccess: true }),
      });

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.purchasePackage(mockPackage);
      });

      expect(mockPurchasePackage).toHaveBeenCalledWith(mockPackage);
    });

    it('returns { success: true, error: null } on success', async () => {
      mockPurchasePackage.mockResolvedValueOnce({
        customerInfo: createMockCustomerInfo({ hasFullAccess: true }),
      });

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(queryClient),
      });

      let purchaseResult: { success: boolean; error: string | null } | undefined;
      await act(async () => {
        purchaseResult = await result.current.purchasePackage(mockPackage);
      });

      expect(purchaseResult).toEqual({ success: true, error: null });
    });

    it('returns { success: false, error: "cancelled" } on cancellation', async () => {
      mockPurchasePackage.mockRejectedValueOnce({
        code: PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR,
        message: 'User cancelled',
      });

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(queryClient),
      });

      let purchaseResult: { success: boolean; error: string | null } | undefined;
      await act(async () => {
        purchaseResult = await result.current.purchasePackage(mockPackage);
      });

      expect(purchaseResult).toEqual({ success: false, error: 'cancelled' });
    });

    it('returns { success: false, error: message } on other errors', async () => {
      mockPurchasePackage.mockRejectedValueOnce({
        code: 'NETWORK_ERROR',
        message: 'Network connection failed',
      });

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(queryClient),
      });

      let purchaseResult: { success: boolean; error: string | null } | undefined;
      await act(async () => {
        purchaseResult = await result.current.purchasePackage(mockPackage);
      });

      expect(purchaseResult).toEqual({ success: false, error: 'Network connection failed' });
    });

    it('handles unknown errors gracefully', async () => {
      mockPurchasePackage.mockRejectedValueOnce('Unknown error');

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(queryClient),
      });

      let purchaseResult: { success: boolean; error: string | null } | undefined;
      await act(async () => {
        purchaseResult = await result.current.purchasePackage(mockPackage);
      });

      expect(purchaseResult).toEqual({ success: false, error: 'Unknown error' });
    });
  });

  describe('restorePurchases', () => {
    it('calls Purchases.restorePurchases', async () => {
      mockRestorePurchases.mockResolvedValueOnce(createMockCustomerInfo({ hasFullAccess: true }));

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.restorePurchases();
      });

      expect(mockRestorePurchases).toHaveBeenCalled();
    });

    it('returns { success: true } when entitlement is active', async () => {
      mockRestorePurchases.mockResolvedValueOnce(createMockCustomerInfo({ hasFullAccess: true }));

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(queryClient),
      });

      let restoreResult: { success: boolean; error: string | null } | undefined;
      await act(async () => {
        restoreResult = await result.current.restorePurchases();
      });

      expect(restoreResult?.success).toBe(true);
    });

    it('returns { success: false } when no active entitlement', async () => {
      mockRestorePurchases.mockResolvedValueOnce(createMockCustomerInfo({ hasFullAccess: false }));

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(queryClient),
      });

      let restoreResult: { success: boolean; error: string | null } | undefined;
      await act(async () => {
        restoreResult = await result.current.restorePurchases();
      });

      expect(restoreResult?.success).toBe(false);
    });

    it('handles errors gracefully', async () => {
      mockRestorePurchases.mockRejectedValueOnce({
        code: 'RESTORE_ERROR',
        message: 'Failed to restore',
      });

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(queryClient),
      });

      let restoreResult: { success: boolean; error: string | null } | undefined;
      await act(async () => {
        restoreResult = await result.current.restorePurchases();
      });

      expect(restoreResult).toEqual({ success: false, error: 'Failed to restore' });
    });
  });

  describe('Error Handling', () => {
    it('sets status to "free" when RevenueCat not configured', async () => {
      mockIsConfigured.mockResolvedValue(false);

      renderHook(() => useSubscription(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(useSubscriptionStore.getState().status).toBe('free');
      });
    });

    it('sets status to "free" when getCustomerInfo fails', async () => {
      mockGetCustomerInfo.mockRejectedValueOnce(new Error('Network error'));

      renderHook(() => useSubscription(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(useSubscriptionStore.getState().status).toBe('free');
      });
    });

    it('continues when usage limits fetch fails', async () => {
      mockApi.get.mockRejectedValueOnce(new Error('Network error'));

      // Should not throw - hook should handle error gracefully
      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(mockApi.get).toHaveBeenCalled();
      });

      // Hook should still be functional
      expect(result.current.refetch).toBeDefined();
    });
  });

  describe('Usage Limits', () => {
    it('updates store with fetched usage limits', async () => {
      mockApi.get.mockResolvedValueOnce({
        data: { share_extension_count: 3, photo_import_count: 1 },
      });

      renderHook(() => useSubscription(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        const state = useSubscriptionStore.getState();
        expect(state.shareExtensionUsage).toBe(3);
        expect(state.photoImportUsage).toBe(1);
      });
    });
  });
});
