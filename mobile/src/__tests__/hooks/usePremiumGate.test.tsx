/**
 * Tests for usePremiumGate hook.
 *
 * Covers:
 * - checkAccess: checking access for different features and subscription states
 * - showPaywallIfNeeded: showing paywall when access denied
 */

import { renderHook } from '@testing-library/react-native';

import { usePremiumGate } from '@hooks/usePremiumGate';
import { useSubscriptionStore, FREE_LIMITS } from '@stores/subscriptionStore';
import { Analytics } from '@services/analytics';

// Mock navigation
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
  }),
}));

// Mock analytics
jest.mock('@services/analytics', () => ({
  Analytics: {
    featureLimitHit: jest.fn(),
    subscriptionStatusChanged: jest.fn(),
  },
}));

// Mock appGroupSync
jest.mock('@services/appGroupSync', () => ({
  syncSubscriptionToAppGroup: jest.fn().mockResolvedValue(undefined),
  syncUsageToAppGroup: jest.fn().mockResolvedValue(undefined),
}));

describe('usePremiumGate', () => {
  beforeEach(() => {
    // Reset store to free user state
    useSubscriptionStore.setState({
      status: 'free',
      plan: null,
      expirationDate: null,
      shareExtensionUsage: 0,
      photoImportUsage: 0,
    });
    jest.clearAllMocks();
  });

  describe('isPremium', () => {
    it('returns true when subscription status is premium', () => {
      useSubscriptionStore.setState({ status: 'premium' });
      const { result } = renderHook(() => usePremiumGate());
      expect(result.current.isPremium).toBe(true);
    });

    it('returns true when subscription status is trial', () => {
      useSubscriptionStore.setState({ status: 'trial' });
      const { result } = renderHook(() => usePremiumGate());
      expect(result.current.isPremium).toBe(true);
    });

    it('returns false when subscription status is free', () => {
      useSubscriptionStore.setState({ status: 'free' });
      const { result } = renderHook(() => usePremiumGate());
      expect(result.current.isPremium).toBe(false);
    });

    it('returns false when subscription status is loading', () => {
      useSubscriptionStore.setState({ status: 'loading' });
      const { result } = renderHook(() => usePremiumGate());
      expect(result.current.isPremium).toBe(false);
    });
  });

  describe('checkAccess', () => {
    describe('Premium users', () => {
      beforeEach(() => {
        useSubscriptionStore.setState({ status: 'premium' });
      });

      it('returns { allowed: true, remaining: Infinity } for shareExtension', () => {
        const { result } = renderHook(() => usePremiumGate());
        const gate = result.current.checkAccess('shareExtension');
        expect(gate.allowed).toBe(true);
        expect(gate.remaining).toBe(Infinity);
        expect(gate.limit).toBe(Infinity);
        expect(gate.used).toBe(0);
      });

      it('returns { allowed: true, remaining: Infinity } for photoImport', () => {
        const { result } = renderHook(() => usePremiumGate());
        const gate = result.current.checkAccess('photoImport');
        expect(gate.allowed).toBe(true);
        expect(gate.remaining).toBe(Infinity);
      });

      it('returns { allowed: true, remaining: Infinity } for entries regardless of tripEntryCount', () => {
        const { result } = renderHook(() => usePremiumGate());
        const gate = result.current.checkAccess('entries', 100);
        expect(gate.allowed).toBe(true);
        expect(gate.remaining).toBe(Infinity);
      });
    });

    describe('Trial users', () => {
      beforeEach(() => {
        useSubscriptionStore.setState({ status: 'trial' });
      });

      it('returns { allowed: true, remaining: Infinity } for all features', () => {
        const { result } = renderHook(() => usePremiumGate());
        expect(result.current.checkAccess('shareExtension').allowed).toBe(true);
        expect(result.current.checkAccess('photoImport').allowed).toBe(true);
        expect(result.current.checkAccess('entries', 50).allowed).toBe(true);
      });
    });

    describe('Free users - shareExtension', () => {
      beforeEach(() => {
        useSubscriptionStore.setState({ status: 'free' });
      });

      it('returns allowed=true when usage < 5', () => {
        useSubscriptionStore.setState({ shareExtensionUsage: 3 });
        const { result } = renderHook(() => usePremiumGate());
        const gate = result.current.checkAccess('shareExtension');
        expect(gate.allowed).toBe(true);
        expect(gate.remaining).toBe(2);
        expect(gate.limit).toBe(FREE_LIMITS.shareExtension);
        expect(gate.used).toBe(3);
      });

      it('returns allowed=false when usage >= 5', () => {
        useSubscriptionStore.setState({ shareExtensionUsage: 5 });
        const { result } = renderHook(() => usePremiumGate());
        const gate = result.current.checkAccess('shareExtension');
        expect(gate.allowed).toBe(false);
        expect(gate.remaining).toBe(0);
        expect(gate.limit).toBe(5);
        expect(gate.used).toBe(5);
      });

      it('returns correct remaining count (5 - usage)', () => {
        useSubscriptionStore.setState({ shareExtensionUsage: 1 });
        const { result } = renderHook(() => usePremiumGate());
        const gate = result.current.checkAccess('shareExtension');
        expect(gate.remaining).toBe(4);
      });

      it('returns remaining=0 when over limit (Math.max safety)', () => {
        useSubscriptionStore.setState({ shareExtensionUsage: 10 });
        const { result } = renderHook(() => usePremiumGate());
        const gate = result.current.checkAccess('shareExtension');
        expect(gate.remaining).toBe(0);
      });
    });

    describe('Free users - photoImport', () => {
      beforeEach(() => {
        useSubscriptionStore.setState({ status: 'free' });
      });

      it('returns allowed=true when usage < 1 (first import)', () => {
        useSubscriptionStore.setState({ photoImportUsage: 0 });
        const { result } = renderHook(() => usePremiumGate());
        const gate = result.current.checkAccess('photoImport');
        expect(gate.allowed).toBe(true);
        expect(gate.remaining).toBe(1);
      });

      it('returns allowed=false when usage >= 1', () => {
        useSubscriptionStore.setState({ photoImportUsage: 1 });
        const { result } = renderHook(() => usePremiumGate());
        const gate = result.current.checkAccess('photoImport');
        expect(gate.allowed).toBe(false);
        expect(gate.remaining).toBe(0);
        expect(gate.limit).toBe(FREE_LIMITS.photoImport);
      });
    });

    describe('Free users - entries', () => {
      beforeEach(() => {
        useSubscriptionStore.setState({ status: 'free' });
      });

      it('returns allowed=true when tripEntryCount < 10', () => {
        const { result } = renderHook(() => usePremiumGate());
        const gate = result.current.checkAccess('entries', 5);
        expect(gate.allowed).toBe(true);
        expect(gate.remaining).toBe(5);
        expect(gate.limit).toBe(FREE_LIMITS.entriesPerTrip);
        expect(gate.used).toBe(5);
      });

      it('returns allowed=false when tripEntryCount >= 10', () => {
        const { result } = renderHook(() => usePremiumGate());
        const gate = result.current.checkAccess('entries', 10);
        expect(gate.allowed).toBe(false);
        expect(gate.remaining).toBe(0);
        expect(gate.used).toBe(10);
      });

      it('returns correct remaining count (10 - tripEntryCount)', () => {
        const { result } = renderHook(() => usePremiumGate());
        const gate = result.current.checkAccess('entries', 7);
        expect(gate.remaining).toBe(3);
      });

      it('uses 0 as default when tripEntryCount undefined', () => {
        const { result } = renderHook(() => usePremiumGate());
        const gate = result.current.checkAccess('entries');
        expect(gate.allowed).toBe(true);
        expect(gate.used).toBe(0);
        expect(gate.remaining).toBe(10);
      });
    });

    describe('Unknown feature', () => {
      it('returns { allowed: true, remaining: Infinity } as default', () => {
        const { result } = renderHook(() => usePremiumGate());
        // TypeScript would normally prevent this, but testing runtime behavior
        const gate = result.current.checkAccess('unknownFeature' as 'shareExtension');
        expect(gate.allowed).toBe(true);
        expect(gate.remaining).toBe(Infinity);
      });
    });
  });

  describe('showPaywallIfNeeded', () => {
    it('returns true and does not navigate when access is allowed', () => {
      useSubscriptionStore.setState({ status: 'premium' });
      const { result } = renderHook(() => usePremiumGate());

      const allowed = result.current.showPaywallIfNeeded('shareExtension');

      expect(allowed).toBe(true);
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(Analytics.featureLimitHit).not.toHaveBeenCalled();
    });

    it('returns false and navigates to PaywallModal when access denied', () => {
      useSubscriptionStore.setState({ status: 'free', shareExtensionUsage: 5 });
      const { result } = renderHook(() => usePremiumGate());

      const allowed = result.current.showPaywallIfNeeded('shareExtension');

      expect(allowed).toBe(false);
      expect(mockNavigate).toHaveBeenCalledWith('PaywallModal', {
        feature: 'shareExtension',
      });
    });

    it('passes feature to PaywallModal params', () => {
      useSubscriptionStore.setState({ status: 'free', photoImportUsage: 1 });
      const { result } = renderHook(() => usePremiumGate());

      result.current.showPaywallIfNeeded('photoImport');

      expect(mockNavigate).toHaveBeenCalledWith('PaywallModal', {
        feature: 'photoImport',
      });
    });

    it('passes entries feature with tripEntryCount to check', () => {
      useSubscriptionStore.setState({ status: 'free' });
      const { result } = renderHook(() => usePremiumGate());

      const allowed = result.current.showPaywallIfNeeded('entries', 10);

      expect(allowed).toBe(false);
      expect(mockNavigate).toHaveBeenCalledWith('PaywallModal', {
        feature: 'entries',
      });
    });

    it('tracks Analytics.featureLimitHit when limit hit', () => {
      useSubscriptionStore.setState({ status: 'free', shareExtensionUsage: 5 });
      const { result } = renderHook(() => usePremiumGate());

      result.current.showPaywallIfNeeded('shareExtension');

      expect(Analytics.featureLimitHit).toHaveBeenCalledWith({
        feature: 'shareExtension',
        remaining: 0,
      });
    });

    it('does not track analytics when access allowed', () => {
      useSubscriptionStore.setState({ status: 'free', shareExtensionUsage: 2 });
      const { result } = renderHook(() => usePremiumGate());

      result.current.showPaywallIfNeeded('shareExtension');

      expect(Analytics.featureLimitHit).not.toHaveBeenCalled();
    });
  });
});
