/**
 * Tests for useAuthSession hook.
 *
 * Covers:
 * - RevenueCat SDK initialization error handling
 * - Analytics tracking for SDK failures
 * - Subscription store sdkAvailable flag
 */

import { renderHook, waitFor } from '@testing-library/react-native';

import { useAuthSession } from '@hooks/useAuthSession';
import { useAuthStore } from '@stores/authStore';
import { useSubscriptionStore } from '@stores/subscriptionStore';
import { supabase } from '@services/supabase';
import * as apiModule from '@services/api';

// Type the mocks
const mockGetSession = supabase.auth.getSession as jest.Mock;
const mockOnAuthStateChange = supabase.auth.onAuthStateChange as jest.Mock;
const mockStoreTokens = apiModule.storeTokens as jest.Mock;

// Add getOnboardingComplete to the api mock (not in global jest.setup)
jest.mock('@services/api', () => ({
  ...jest.requireActual('@services/api'),
  api: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    put: jest.fn(),
  },
  getStoredToken: jest.fn().mockResolvedValue('test-token'),
  storeTokens: jest.fn(),
  clearTokens: jest.fn(),
  setSignOutCallback: jest.fn(),
  getOnboardingComplete: jest.fn().mockResolvedValue(false),
}));

// Mock revenueCat service
jest.mock('@services/revenueCat', () => ({
  identifyUser: jest.fn(),
  logOutUser: jest.fn(),
  initializeRevenueCat: jest.fn(),
  ENTITLEMENT_ID: 'Full Access',
  isPremium: jest.fn(() => false),
  isTrialing: jest.fn(() => false),
  getSubscriptionPlan: jest.fn(() => null),
  getExpirationDate: jest.fn(() => null),
}));

// Mock analytics
jest.mock('@services/analytics', () => ({
  identifyUser: jest.fn(),
  resetUser: jest.fn(),
  Analytics: {
    subscriptionStatusChanged: jest.fn(),
    revenueCatError: jest.fn(),
  },
}));

// Mock appGroupSync
jest.mock('@services/appGroupSync', () => ({
  syncSubscriptionToAppGroup: jest.fn().mockResolvedValue(undefined),
  syncUsageToAppGroup: jest.fn().mockResolvedValue(undefined),
}));

// Get mocked revenueCat functions
const mockRevenueCat = jest.requireMock('@services/revenueCat');
const mockAnalytics = jest.requireMock('@services/analytics');

const mockSession = {
  user: { id: 'test-user-123' },
  access_token: 'test-token',
  refresh_token: 'test-refresh',
};

describe('useAuthSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Reset stores
    useAuthStore.setState({
      session: null,
      isLoading: true,
      hasCompletedOnboarding: false,
    });
    useSubscriptionStore.setState({
      status: 'loading',
      sdkAvailable: true,
    });

    // Default mock behavior
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: jest.fn() } },
    });
    mockStoreTokens.mockResolvedValue(undefined);
    mockRevenueCat.identifyUser.mockResolvedValue({
      entitlements: { active: {} },
    });
    mockRevenueCat.logOutUser.mockResolvedValue({
      entitlements: { active: {} },
    });
  });

  describe('RevenueCat error handling on session restore', () => {
    it('tracks analytics when identifyRevenueCatUser fails during session restore', async () => {
      mockGetSession.mockResolvedValue({ data: { session: mockSession } });
      mockRevenueCat.identifyUser.mockRejectedValue(new Error('SDK not initialized'));

      renderHook(() => useAuthSession());

      await waitFor(() => {
        expect(mockRevenueCat.identifyUser).toHaveBeenCalledWith('test-user-123');
      });

      await waitFor(() => {
        expect(mockAnalytics.Analytics.revenueCatError).toHaveBeenCalledWith({
          action: 'identify',
          error: 'SDK not initialized',
        });
      });
    });

    it('sets sdkAvailable to false when identifyRevenueCatUser fails during session restore', async () => {
      mockGetSession.mockResolvedValue({ data: { session: mockSession } });
      mockRevenueCat.identifyUser.mockRejectedValue(new Error('Network error'));

      renderHook(() => useAuthSession());

      await waitFor(() => {
        expect(useSubscriptionStore.getState().sdkAvailable).toBe(false);
      });
    });

    it('keeps sdkAvailable true when identifyRevenueCatUser succeeds', async () => {
      mockGetSession.mockResolvedValue({ data: { session: mockSession } });
      mockRevenueCat.identifyUser.mockResolvedValue({
        entitlements: { active: {} },
      });

      renderHook(() => useAuthSession());

      await waitFor(() => {
        expect(mockRevenueCat.identifyUser).toHaveBeenCalled();
      });

      // sdkAvailable should remain true
      expect(useSubscriptionStore.getState().sdkAvailable).toBe(true);
    });
  });

  describe('RevenueCat error handling on auth state change', () => {
    it('tracks analytics when identifyRevenueCatUser fails on sign-in', async () => {
      // Start with no session
      mockGetSession.mockResolvedValue({ data: { session: null } });

      let authChangeCallback: (event: string, session: typeof mockSession | null) => void;
      mockOnAuthStateChange.mockImplementation((callback) => {
        authChangeCallback = callback;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      });

      mockRevenueCat.identifyUser.mockRejectedValue(new Error('Invalid API key'));

      renderHook(() => useAuthSession());

      await waitFor(() => {
        expect(mockOnAuthStateChange).toHaveBeenCalled();
      });

      // Simulate sign-in event
      authChangeCallback!('SIGNED_IN', mockSession);

      await waitFor(() => {
        expect(mockAnalytics.Analytics.revenueCatError).toHaveBeenCalledWith({
          action: 'identify',
          error: 'Invalid API key',
        });
      });
    });

    it('sets sdkAvailable to false on sign-in RevenueCat failure', async () => {
      mockGetSession.mockResolvedValue({ data: { session: null } });

      let authChangeCallback: (event: string, session: typeof mockSession | null) => void;
      mockOnAuthStateChange.mockImplementation((callback) => {
        authChangeCallback = callback;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      });

      mockRevenueCat.identifyUser.mockRejectedValue(new Error('Network timeout'));

      renderHook(() => useAuthSession());

      await waitFor(() => {
        expect(mockOnAuthStateChange).toHaveBeenCalled();
      });

      authChangeCallback!('SIGNED_IN', mockSession);

      await waitFor(() => {
        expect(useSubscriptionStore.getState().sdkAvailable).toBe(false);
      });
    });

    it('tracks analytics when logOutRevenueCatUser fails on sign-out', async () => {
      mockGetSession.mockResolvedValue({ data: { session: null } });

      let authChangeCallback: (event: string, session: typeof mockSession | null) => void;
      mockOnAuthStateChange.mockImplementation((callback) => {
        authChangeCallback = callback;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      });

      mockRevenueCat.logOutUser.mockRejectedValue(new Error('Logout failed'));

      renderHook(() => useAuthSession());

      await waitFor(() => {
        expect(mockOnAuthStateChange).toHaveBeenCalled();
      });

      // Simulate sign-out event
      authChangeCallback!('SIGNED_OUT', null);

      await waitFor(() => {
        expect(mockAnalytics.Analytics.revenueCatError).toHaveBeenCalledWith({
          action: 'logout',
          error: 'Logout failed',
        });
      });
    });
  });

  describe('App readiness', () => {
    it('becomes ready even when RevenueCat fails', async () => {
      mockGetSession.mockResolvedValue({ data: { session: mockSession } });
      mockRevenueCat.identifyUser.mockRejectedValue(new Error('SDK crash'));

      const { result } = renderHook(() => useAuthSession());

      await waitFor(() => {
        expect(result.current.isAppReady).toBe(true);
      });
    });
  });

  describe('Stale subscription status (persisted store)', () => {
    it('resets stale premium status to loading on session restore before RevenueCat validates', async () => {
      // Simulate persisted store from a previous session where user was premium
      useSubscriptionStore.setState({
        status: 'premium',
        plan: 'annual',
        expirationDate: '2026-03-01T00:00:00.000Z',
        sdkAvailable: true,
      });

      // RevenueCat will eventually say user is free (trial expired)
      mockGetSession.mockResolvedValue({ data: { session: mockSession } });
      mockRevenueCat.identifyUser.mockResolvedValue({
        entitlements: { active: {} },
      });

      renderHook(() => useAuthSession());

      // Status should be reset to 'loading' immediately, not staying as stale 'premium'
      // This prevents the UI from briefly showing "Premium" before RevenueCat responds
      await waitFor(() => {
        const status = useSubscriptionStore.getState().status;
        expect(status).not.toBe('premium');
      });

      // After RevenueCat responds, status should be 'free'
      await waitFor(() => {
        expect(useSubscriptionStore.getState().status).toBe('free');
      });
    });

    it('clears stale premium status when RevenueCat SDK fails on session restore', async () => {
      // Simulate persisted store from a previous session where user was premium
      useSubscriptionStore.setState({
        status: 'premium',
        plan: 'annual',
        expirationDate: '2026-03-01T00:00:00.000Z',
        sdkAvailable: true,
      });

      mockGetSession.mockResolvedValue({ data: { session: mockSession } });
      mockRevenueCat.identifyUser.mockRejectedValue(new Error('Network error'));

      renderHook(() => useAuthSession());

      // After SDK failure, status should fall back to 'free', not remain stale 'premium'
      await waitFor(() => {
        expect(useSubscriptionStore.getState().status).toBe('free');
      });
    });

    it('syncs downgrade to backend when RevenueCat says user is no longer premium', async () => {
      const mockApiPost = apiModule.api.post as jest.Mock;

      // User was premium before
      useSubscriptionStore.setState({
        status: 'premium',
        plan: 'annual',
        sdkAvailable: true,
      });

      // RevenueCat now says free (trial/subscription expired)
      mockGetSession.mockResolvedValue({ data: { session: mockSession } });
      mockRevenueCat.identifyUser.mockResolvedValue({
        entitlements: { active: {} },
      });
      mockRevenueCat.isPremium.mockReturnValue(false);
      mockApiPost.mockResolvedValue({ data: {} });

      renderHook(() => useAuthSession());

      // Should call verify to sync the downgrade to backend
      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith('/subscriptions/verify');
      });
    });
  });
});
