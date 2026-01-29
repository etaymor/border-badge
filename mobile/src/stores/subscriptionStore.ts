/**
 * Subscription Store - Zustand store for subscription state management
 *
 * Manages subscription status, usage limits, and premium access checks.
 * Backend is the source of truth for usage limits; client state is for UX optimization.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { CustomerInfo } from 'react-native-purchases';
import { create } from 'zustand';
import { persist, createJSONStorage, subscribeWithSelector } from 'zustand/middleware';
import Purchases from 'react-native-purchases';
import { Analytics } from '@services/analytics';
import { syncUsageToAppGroup } from '@services/appGroupSync';
import {
  isPremium as checkIsPremium,
  isTrialing as checkIsTrialing,
  getSubscriptionPlan,
  getExpirationDate,
} from '@services/revenueCat';

export type SubscriptionStatus = 'free' | 'trial' | 'premium' | 'loading';
export type SubscriptionPlan = 'weekly' | 'monthly' | 'annual' | null;

// Free tier limits (lifetime, not monthly)
// IMPORTANT: These values must stay in sync across all codebases!
// - Python: backend/app/api/subscriptions.py (FREE_LIMITS)
// - Swift: mobile/plugins/share-extension/Utilities/AppGroupStorage.swift (freeShareExtensionLimit)
// - CI Test: backend/tests/test_limits_consistency.py
export const FREE_LIMITS = {
  shareExtension: 5,
  photoImport: 1,
  entriesPerTrip: 10,
} as const;

interface SubscriptionState {
  // Subscription status
  status: SubscriptionStatus;
  plan: SubscriptionPlan;
  expirationDate: string | null;

  // Usage limits (synced from backend - source of truth)
  shareExtensionUsage: number;
  photoImportUsage: number;

  // Actions
  setCustomerInfo: (info: CustomerInfo) => void;
  setUsageLimits: (share: number, photo: number) => void;
  incrementShareExtensionUsage: () => void;
  incrementPhotoImportUsage: () => void;
  setStatus: (status: SubscriptionStatus) => void;
  fetchCustomerInfo: () => Promise<CustomerInfo | null>;
  reset: () => void;
}

export const useSubscriptionStore = create<SubscriptionState>()(
  subscribeWithSelector(
    persist(
      (set) => ({
        status: 'loading',
        plan: null,
        expirationDate: null,
        shareExtensionUsage: 0,
        photoImportUsage: 0,

        setCustomerInfo: (info: CustomerInfo) => {
          const premium = checkIsPremium(info);
          const trial = checkIsTrialing(info);
          const plan = getSubscriptionPlan(info);
          const expiration = getExpirationDate(info);

          set({
            status: premium ? (trial ? 'trial' : 'premium') : 'free',
            plan,
            expirationDate: expiration?.toISOString() ?? null,
          });
        },

        setUsageLimits: (share: number, photo: number) => {
          set({
            shareExtensionUsage: share,
            photoImportUsage: photo,
          });
        },

        incrementShareExtensionUsage: () => {
          set((state) => ({
            shareExtensionUsage: state.shareExtensionUsage + 1,
          }));
        },

        incrementPhotoImportUsage: () => {
          set((state) => ({
            photoImportUsage: state.photoImportUsage + 1,
          }));
        },

        setStatus: (status: SubscriptionStatus) => {
          set({ status });
        },

        fetchCustomerInfo: async () => {
          try {
            const info = await Purchases.getCustomerInfo();
            const premium = checkIsPremium(info);
            const trial = checkIsTrialing(info);
            const plan = getSubscriptionPlan(info);
            const expiration = getExpirationDate(info);

            set({
              status: premium ? (trial ? 'trial' : 'premium') : 'free',
              plan,
              expirationDate: expiration?.toISOString() ?? null,
            });

            return info;
          } catch (error) {
            console.error('[SubscriptionStore] Failed to fetch customer info:', error);
            set({ status: 'free' }); // Fail safe to free
            return null;
          }
        },

        reset: () => {
          set({
            status: 'free',
            plan: null,
            expirationDate: null,
            shareExtensionUsage: 0,
            photoImportUsage: 0,
          });
        },
      }),
      {
        name: 'subscription-storage',
        storage: createJSONStorage(() => AsyncStorage),
        // Only persist status and usage for offline access
        // CustomerInfo is transient and fetched fresh on each session
        partialize: (state) => ({
          status: state.status,
          plan: state.plan,
          expirationDate: state.expirationDate,
          shareExtensionUsage: state.shareExtensionUsage,
          photoImportUsage: state.photoImportUsage,
        }),
      }
    )
  )
);

// Selectors for optimized re-renders
export const useIsPremium = () =>
  useSubscriptionStore((s) => s.status === 'premium' || s.status === 'trial');

export const useIsTrialing = () => useSubscriptionStore((s) => s.status === 'trial');

export const useSubscriptionStatus = () => useSubscriptionStore((s) => s.status);

export const useSubscriptionPlan = () => useSubscriptionStore((s) => s.plan);

// Helper to check if status grants premium access (excludes 'loading' and 'free')
const hasPremiumAccess = (status: SubscriptionStatus): boolean =>
  status === 'premium' || status === 'trial';

export const useCanUseShareExtension = () =>
  useSubscriptionStore(
    (s) => hasPremiumAccess(s.status) || s.shareExtensionUsage < FREE_LIMITS.shareExtension
  );

export const useCanImportPhotos = () =>
  useSubscriptionStore(
    (s) => hasPremiumAccess(s.status) || s.photoImportUsage < FREE_LIMITS.photoImport
  );

export const useShareExtensionRemaining = () =>
  useSubscriptionStore((s) =>
    hasPremiumAccess(s.status)
      ? Infinity
      : Math.max(0, FREE_LIMITS.shareExtension - s.shareExtensionUsage)
  );

export const usePhotoImportRemaining = () =>
  useSubscriptionStore((s) =>
    hasPremiumAccess(s.status)
      ? Infinity
      : Math.max(0, FREE_LIMITS.photoImport - s.photoImportUsage)
  );

// Subscribe to usage changes and sync to App Group for Share Extension access
useSubscriptionStore.subscribe(
  (state) => ({ share: state.shareExtensionUsage, photo: state.photoImportUsage }),
  (current, prev) => {
    // Only sync if usage actually changed
    if (current.share !== prev.share || current.photo !== prev.photo) {
      syncUsageToAppGroup(current.share, current.photo).catch((err) => {
        console.error('[SubscriptionStore] Failed to sync usage to App Group:', err);
      });
    }
  },
  { equalityFn: (a, b) => a.share === b.share && a.photo === b.photo }
);

// Subscribe to subscription status changes for analytics
useSubscriptionStore.subscribe(
  (state) => ({ status: state.status, plan: state.plan }),
  (current, prev) => {
    // Only track meaningful status changes (not loading state)
    if (
      current.status !== prev.status &&
      prev.status !== 'loading' &&
      current.status !== 'loading'
    ) {
      Analytics.subscriptionStatusChanged({
        from: prev.status,
        to: current.status,
        plan: current.plan ?? undefined,
      });
    }
  },
  { equalityFn: (a, b) => a.status === b.status && a.plan === b.plan }
);
