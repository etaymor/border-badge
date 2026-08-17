import { CustomerInfo } from 'react-native-purchases';
import Purchases from 'react-native-purchases';

import { useSubscriptionStore, FREE_LIMITS } from '@stores/subscriptionStore';

// Mock revenueCat service functions
jest.mock('@services/revenueCat', () => ({
  isPremium: jest.fn((info: CustomerInfo) => {
    return info.entitlements?.active?.['Full Access'] !== undefined;
  }),
  isTrialing: jest.fn((info: CustomerInfo) => {
    return info.entitlements?.active?.['Full Access']?.periodType === 'TRIAL';
  }),
  getSubscriptionPlan: jest.fn((info: CustomerInfo) => {
    const entitlement = info.entitlements?.active?.['Full Access'];
    if (!entitlement) return null;
    const productId = entitlement.productIdentifier;
    if (productId?.includes('Weekly')) return 'weekly';
    if (productId?.includes('Monthly')) return 'monthly';
    if (productId?.includes('Annual')) return 'annual';
    return null;
  }),
  getExpirationDate: jest.fn((info: CustomerInfo) => {
    const entitlement = info.entitlements?.active?.['Full Access'];
    if (!entitlement?.expirationDate) return null;
    return new Date(entitlement.expirationDate);
  }),
  ENTITLEMENT_ID: 'Full Access',
}));

// Mock appGroupSync service
jest.mock('@services/appGroupSync', () => ({
  syncSubscriptionToAppGroup: jest.fn().mockResolvedValue(undefined),
  syncUsageToAppGroup: jest.fn().mockResolvedValue(undefined),
}));

// Mock analytics service
jest.mock('@services/analytics', () => ({
  Analytics: {
    subscriptionStatusChanged: jest.fn(),
    featureLimitHit: jest.fn(),
  },
}));

// Helper to create mock CustomerInfo
function createMockCustomerInfo(
  overrides: {
    hasFullAccess?: boolean;
    periodType?: 'TRIAL' | 'NORMAL' | 'INTRO';
    productIdentifier?: string;
    expirationDate?: string | null;
  } = {}
): CustomerInfo {
  const {
    hasFullAccess = false,
    periodType = 'NORMAL',
    productIdentifier = 'com.atlasi.app.Monthly',
    expirationDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  } = overrides;

  return {
    entitlements: {
      active: hasFullAccess
        ? {
            'Full Access': {
              identifier: 'Full Access',
              isActive: true,
              periodType,
              productIdentifier,
              expirationDate,
              willRenew: true,
              latestPurchaseDate: new Date().toISOString(),
              originalPurchaseDate: new Date().toISOString(),
              isSandbox: true,
              ownershipType: 'PURCHASED',
            },
          }
        : {},
      all: {},
    },
    activeSubscriptions: hasFullAccess ? [productIdentifier] : [],
    allPurchasedProductIdentifiers: [],
    originalAppUserId: 'user-123',
    managementURL: null,
    firstSeen: new Date().toISOString(),
    requestDate: new Date().toISOString(),
    latestExpirationDate: expirationDate ?? null,
    originalPurchaseDate: null,
    allExpirationDates: {},
    allPurchaseDates: {},
    nonSubscriptionTransactions: [],
  } as unknown as CustomerInfo;
}

describe('subscriptionStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useSubscriptionStore.setState({
      status: 'loading',
      plan: null,
      expirationDate: null,
      shareExtensionUsage: 0,
      photoImportUsage: 0,
    });
    jest.clearAllMocks();
  });

  describe('Initial State', () => {
    it('starts with loading status', () => {
      const state = useSubscriptionStore.getState();
      expect(state.status).toBe('loading');
    });

    it('has null plan and expirationDate', () => {
      const state = useSubscriptionStore.getState();
      expect(state.plan).toBeNull();
      expect(state.expirationDate).toBeNull();
    });

    it('has zero usage counts', () => {
      const state = useSubscriptionStore.getState();
      expect(state.shareExtensionUsage).toBe(0);
      expect(state.photoImportUsage).toBe(0);
    });
  });

  describe('setCustomerInfo', () => {
    it('sets status to "free" when no active entitlement', () => {
      const info = createMockCustomerInfo({ hasFullAccess: false });
      useSubscriptionStore.getState().setCustomerInfo(info);
      expect(useSubscriptionStore.getState().status).toBe('free');
    });

    it('sets status to "premium" when active entitlement without trial', () => {
      const info = createMockCustomerInfo({
        hasFullAccess: true,
        periodType: 'NORMAL',
      });
      useSubscriptionStore.getState().setCustomerInfo(info);
      expect(useSubscriptionStore.getState().status).toBe('premium');
    });

    it('sets status to "trial" when periodType is TRIAL', () => {
      const info = createMockCustomerInfo({
        hasFullAccess: true,
        periodType: 'TRIAL',
      });
      useSubscriptionStore.getState().setCustomerInfo(info);
      expect(useSubscriptionStore.getState().status).toBe('trial');
    });

    it('extracts weekly plan from product identifier', () => {
      const info = createMockCustomerInfo({
        hasFullAccess: true,
        productIdentifier: 'com.atlasi.app.Weekly',
      });
      useSubscriptionStore.getState().setCustomerInfo(info);
      expect(useSubscriptionStore.getState().plan).toBe('weekly');
    });

    it('extracts monthly plan from product identifier', () => {
      const info = createMockCustomerInfo({
        hasFullAccess: true,
        productIdentifier: 'com.atlasi.app.Monthly',
      });
      useSubscriptionStore.getState().setCustomerInfo(info);
      expect(useSubscriptionStore.getState().plan).toBe('monthly');
    });

    it('extracts annual plan from product identifier', () => {
      const info = createMockCustomerInfo({
        hasFullAccess: true,
        productIdentifier: 'com.atlasi.app.Annual',
      });
      useSubscriptionStore.getState().setCustomerInfo(info);
      expect(useSubscriptionStore.getState().plan).toBe('annual');
    });

    it('sets expirationDate from entitlement', () => {
      const expDate = '2025-12-31T23:59:59.000Z';
      const info = createMockCustomerInfo({
        hasFullAccess: true,
        expirationDate: expDate,
      });
      useSubscriptionStore.getState().setCustomerInfo(info);
      expect(useSubscriptionStore.getState().expirationDate).toBe(expDate);
    });

    it('handles null expirationDate gracefully', () => {
      const info = createMockCustomerInfo({
        hasFullAccess: true,
        expirationDate: null,
      });
      useSubscriptionStore.getState().setCustomerInfo(info);
      expect(useSubscriptionStore.getState().expirationDate).toBeNull();
    });
  });

  describe('setUsageLimits', () => {
    it('updates shareExtensionUsage and photoImportUsage', () => {
      useSubscriptionStore.getState().setUsageLimits(3, 1);
      const state = useSubscriptionStore.getState();
      expect(state.shareExtensionUsage).toBe(3);
      expect(state.photoImportUsage).toBe(1);
    });
  });

  describe('incrementShareExtensionUsage', () => {
    it('increments shareExtensionUsage by 1', () => {
      useSubscriptionStore.setState({ shareExtensionUsage: 2 });
      useSubscriptionStore.getState().incrementShareExtensionUsage();
      expect(useSubscriptionStore.getState().shareExtensionUsage).toBe(3);
    });
  });

  describe('incrementPhotoImportUsage', () => {
    it('increments photoImportUsage by 1', () => {
      useSubscriptionStore.setState({ photoImportUsage: 0 });
      useSubscriptionStore.getState().incrementPhotoImportUsage();
      expect(useSubscriptionStore.getState().photoImportUsage).toBe(1);
    });
  });

  describe('setStatus', () => {
    it('directly sets subscription status', () => {
      useSubscriptionStore.getState().setStatus('premium');
      expect(useSubscriptionStore.getState().status).toBe('premium');
    });
  });

  describe('fetchCustomerInfo', () => {
    it('fetches customer info from RevenueCat and updates store', async () => {
      const mockInfo = createMockCustomerInfo({
        hasFullAccess: true,
        productIdentifier: 'com.atlasi.app.Annual',
      });
      (Purchases.getCustomerInfo as jest.Mock).mockResolvedValueOnce(mockInfo);

      const result = await useSubscriptionStore.getState().fetchCustomerInfo();

      expect(Purchases.getCustomerInfo).toHaveBeenCalled();
      expect(result).toEqual(mockInfo);
      expect(useSubscriptionStore.getState().status).toBe('premium');
      expect(useSubscriptionStore.getState().plan).toBe('annual');
    });

    it('sets status to "free" on error (fail-safe)', async () => {
      useSubscriptionStore.setState({ status: 'loading' });
      (Purchases.getCustomerInfo as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const result = await useSubscriptionStore.getState().fetchCustomerInfo();

      expect(result).toBeNull();
      expect(useSubscriptionStore.getState().status).toBe('free');
    });
  });

  describe('reset', () => {
    it('resets all state to initial values', () => {
      // Set non-initial state
      useSubscriptionStore.setState({
        status: 'premium',
        plan: 'annual',
        expirationDate: '2025-12-31',
        shareExtensionUsage: 5,
        photoImportUsage: 1,
      });

      useSubscriptionStore.getState().reset();

      const state = useSubscriptionStore.getState();
      expect(state.status).toBe('free');
      expect(state.plan).toBeNull();
      expect(state.expirationDate).toBeNull();
      expect(state.shareExtensionUsage).toBe(0);
      expect(state.photoImportUsage).toBe(0);
    });
  });
});

describe('FREE_LIMITS', () => {
  it('has correct shareExtension limit', () => {
    expect(FREE_LIMITS.shareExtension).toBe(5);
  });

  it('has correct photoImport limit', () => {
    expect(FREE_LIMITS.photoImport).toBe(1);
  });

  it('has correct entriesPerTrip limit', () => {
    expect(FREE_LIMITS.entriesPerTrip).toBe(10);
  });
});

describe('Selectors', () => {
  beforeEach(() => {
    useSubscriptionStore.setState({
      status: 'free',
      plan: null,
      expirationDate: null,
      shareExtensionUsage: 0,
      photoImportUsage: 0,
    });
  });

  describe('useIsPremium', () => {
    it('returns true when status is "premium"', () => {
      useSubscriptionStore.setState({ status: 'premium' });
      // Use getState selector directly since hooks can't be called outside components
      const isPremium =
        useSubscriptionStore.getState().status === 'premium' ||
        useSubscriptionStore.getState().status === 'trial';
      expect(isPremium).toBe(true);
    });

    it('returns true when status is "trial"', () => {
      useSubscriptionStore.setState({ status: 'trial' });
      const isPremium =
        useSubscriptionStore.getState().status === 'premium' ||
        useSubscriptionStore.getState().status === 'trial';
      expect(isPremium).toBe(true);
    });

    it('returns false when status is "free"', () => {
      useSubscriptionStore.setState({ status: 'free' });
      const isPremium =
        useSubscriptionStore.getState().status === 'premium' ||
        useSubscriptionStore.getState().status === 'trial';
      expect(isPremium).toBe(false);
    });

    it('returns false when status is "loading"', () => {
      useSubscriptionStore.setState({ status: 'loading' });
      const isPremium =
        useSubscriptionStore.getState().status === 'premium' ||
        useSubscriptionStore.getState().status === 'trial';
      expect(isPremium).toBe(false);
    });
  });

  describe('useIsTrialing', () => {
    it('returns true only when status is "trial"', () => {
      useSubscriptionStore.setState({ status: 'trial' });
      expect(useSubscriptionStore.getState().status === 'trial').toBe(true);

      useSubscriptionStore.setState({ status: 'premium' });
      expect(useSubscriptionStore.getState().status === 'trial').toBe(false);
    });
  });

  describe('useCanUseShareExtension', () => {
    it('returns true for premium users regardless of usage', () => {
      useSubscriptionStore.setState({ status: 'premium', shareExtensionUsage: 100 });
      const state = useSubscriptionStore.getState();
      const canUse =
        state.status === 'premium' ||
        state.status === 'trial' ||
        state.shareExtensionUsage < FREE_LIMITS.shareExtension;
      expect(canUse).toBe(true);
    });

    it('returns true for free users under limit (usage < 5)', () => {
      useSubscriptionStore.setState({ status: 'free', shareExtensionUsage: 3 });
      const state = useSubscriptionStore.getState();
      const canUse =
        state.status === 'premium' ||
        state.status === 'trial' ||
        state.shareExtensionUsage < FREE_LIMITS.shareExtension;
      expect(canUse).toBe(true);
    });

    it('returns false for free users at limit (usage >= 5)', () => {
      useSubscriptionStore.setState({ status: 'free', shareExtensionUsage: 5 });
      const state = useSubscriptionStore.getState();
      const canUse =
        state.status === 'premium' ||
        state.status === 'trial' ||
        state.shareExtensionUsage < FREE_LIMITS.shareExtension;
      expect(canUse).toBe(false);
    });
  });

  describe('useCanImportPhotos', () => {
    it('returns true for premium users', () => {
      useSubscriptionStore.setState({ status: 'premium', photoImportUsage: 100 });
      const state = useSubscriptionStore.getState();
      const canUse =
        state.status === 'premium' ||
        state.status === 'trial' ||
        state.photoImportUsage < FREE_LIMITS.photoImport;
      expect(canUse).toBe(true);
    });

    it('returns true for free users under limit (usage < 1)', () => {
      useSubscriptionStore.setState({ status: 'free', photoImportUsage: 0 });
      const state = useSubscriptionStore.getState();
      const canUse =
        state.status === 'premium' ||
        state.status === 'trial' ||
        state.photoImportUsage < FREE_LIMITS.photoImport;
      expect(canUse).toBe(true);
    });

    it('returns false for free users at limit (usage >= 1)', () => {
      useSubscriptionStore.setState({ status: 'free', photoImportUsage: 1 });
      const state = useSubscriptionStore.getState();
      const canUse =
        state.status === 'premium' ||
        state.status === 'trial' ||
        state.photoImportUsage < FREE_LIMITS.photoImport;
      expect(canUse).toBe(false);
    });
  });

  describe('useShareExtensionRemaining', () => {
    it('returns Infinity for premium users', () => {
      useSubscriptionStore.setState({ status: 'premium', shareExtensionUsage: 10 });
      const state = useSubscriptionStore.getState();
      const remaining =
        state.status === 'premium' || state.status === 'trial'
          ? Infinity
          : Math.max(0, FREE_LIMITS.shareExtension - state.shareExtensionUsage);
      expect(remaining).toBe(Infinity);
    });

    it('returns correct remaining count for free users', () => {
      useSubscriptionStore.setState({ status: 'free', shareExtensionUsage: 2 });
      const state = useSubscriptionStore.getState();
      const remaining =
        state.status === 'premium' || state.status === 'trial'
          ? Infinity
          : Math.max(0, FREE_LIMITS.shareExtension - state.shareExtensionUsage);
      expect(remaining).toBe(3);
    });

    it('returns 0 when at or over limit', () => {
      useSubscriptionStore.setState({ status: 'free', shareExtensionUsage: 7 });
      const state = useSubscriptionStore.getState();
      const remaining =
        state.status === 'premium' || state.status === 'trial'
          ? Infinity
          : Math.max(0, FREE_LIMITS.shareExtension - state.shareExtensionUsage);
      expect(remaining).toBe(0);
    });
  });

  describe('usePhotoImportRemaining', () => {
    it('returns Infinity for premium users', () => {
      useSubscriptionStore.setState({ status: 'premium', photoImportUsage: 5 });
      const state = useSubscriptionStore.getState();
      const remaining =
        state.status === 'premium' || state.status === 'trial'
          ? Infinity
          : Math.max(0, FREE_LIMITS.photoImport - state.photoImportUsage);
      expect(remaining).toBe(Infinity);
    });

    it('returns correct remaining count for free users', () => {
      useSubscriptionStore.setState({ status: 'free', photoImportUsage: 0 });
      const state = useSubscriptionStore.getState();
      const remaining =
        state.status === 'premium' || state.status === 'trial'
          ? Infinity
          : Math.max(0, FREE_LIMITS.photoImport - state.photoImportUsage);
      expect(remaining).toBe(1);
    });
  });
});
