/**
 * React Query hooks for subscription API endpoints.
 *
 * These hooks provide a clean interface to the backend subscription endpoints,
 * using React Query for caching and mutation handling.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@services/api';
import { STALE_TIMES } from '../queryClient';

// Query key constants for subscription data
const SUBSCRIPTION_KEYS = {
  status: ['subscription', 'status'] as const,
  usage: ['subscription', 'usage'] as const,
  canAddEntry: (tripId: string) => ['subscription', 'canAddEntry', tripId] as const,
};

// GC time constant (30 minutes)
const GC_TIME = 1000 * 60 * 30;

// ============================================================================
// Types matching backend schemas
// ============================================================================

export type SubscriptionStatus = 'free' | 'trial' | 'premium';
export type SubscriptionPlan = 'weekly' | 'monthly' | 'annual';
export type UsageFeature = 'share_extension' | 'photo_import';

export interface SubscriptionInfo {
  status: SubscriptionStatus;
  plan: SubscriptionPlan | null;
  expires_at: string | null;
}

export interface UsageLimits {
  share_extension_count: number;
  share_extension_limit: number;
  share_extension_period_start: string | null;
  photo_import_count: number;
  photo_import_limit: number;
  /**
   * The trip that consumed the free photo import, or null (U16/R17).
   *
   * Every client gate that guards entry to matching must allow the run when this
   * equals the trip being opened, EVEN WHEN `photo_import_count >=
   * photo_import_limit` — it is the same field the server compares against, so a
   * gate that ignores it locks the user out of a trip the server would happily
   * serve. Device markers are a fast path, never the decision.
   */
  photo_import_trip_id: string | null;
  entries_per_trip_limit: number;
}

export interface IncrementUsageResponse {
  status: string;
  new_count: number;
}

export interface CanAddEntryResponse {
  allowed: boolean;
  count: number;
  limit: number;
  remaining: number;
}

export interface VerifySubscriptionResponse {
  status: string;
  subscription_status: SubscriptionStatus | null;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Fetch the current user's subscription status.
 *
 * @example
 * const { data, isLoading } = useSubscriptionStatus();
 * if (data?.status === 'premium') { ... }
 */
export function useSubscriptionStatus() {
  return useQuery({
    queryKey: SUBSCRIPTION_KEYS.status,
    queryFn: async (): Promise<SubscriptionInfo> => {
      const response = await api.get('/subscriptions/status');
      return response.data;
    },
    staleTime: STALE_TIMES.USER_DATA, // 5 minutes
    gcTime: GC_TIME, // 30 minutes
  });
}

/**
 * Fetch the current user's usage counts and limits.
 *
 * @example
 * const { data } = useSubscriptionUsage();
 * const remainingSaves = data.share_extension_limit - data.share_extension_count;
 */
export function useSubscriptionUsage() {
  return useQuery({
    queryKey: SUBSCRIPTION_KEYS.usage,
    queryFn: async (): Promise<UsageLimits> => {
      const response = await api.get('/subscriptions/usage');
      return response.data;
    },
    staleTime: STALE_TIMES.USER_DATA, // 5 minutes
    gcTime: GC_TIME, // 30 minutes
  });
}

/**
 * Increment usage counter for a feature (share_extension or photo_import).
 *
 * Automatically invalidates the usage cache on success.
 *
 * @example
 * const { mutateAsync } = useIncrementUsage();
 * const result = await mutateAsync({ feature: 'share_extension' });
 * console.log('New count:', result.new_count);
 *
 * For `photo_import`, `trip_id` is REQUIRED in practice (U16/R17): the server
 * records it as the consuming trip, and without it there is no trip to exempt on
 * re-entry, so the user's half-matched trip becomes uncompletable.
 */
/**
 * Increment input, discriminated so `photo_import` cannot omit its trip.
 *
 * The RPC still increments `usage_photo_import_count` when `p_trip_id` is NULL,
 * but records NO consuming trip -- spending the user's lifetime import while
 * leaving nothing to exempt on re-entry, which permanently gates the very trip
 * they just paid for. Making it required here means that call cannot be written
 * by accident; the backend rejects it independently.
 */
export type IncrementUsageInput =
  | { feature: 'photo_import'; trip_id: string }
  | { feature: Exclude<UsageFeature, 'photo_import'>; trip_id?: string };

export function useIncrementUsage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: IncrementUsageInput): Promise<IncrementUsageResponse> => {
      if (input.feature === 'photo_import' && !input.trip_id?.trim()) {
        // Belt and braces for a JS caller the type cannot reach.
        throw new Error('photo_import usage increments require a trip_id');
      }
      const response = await api.post('/subscriptions/usage/increment', input);
      return response.data;
    },
    onSuccess: () => {
      // Invalidate usage cache so it refetches with new count
      queryClient.invalidateQueries({ queryKey: SUBSCRIPTION_KEYS.usage });
    },
  });
}

/**
 * Check if user can add another entry to a trip.
 *
 * This is a UX optimization only - actual enforcement happens server-side.
 *
 * @param tripId - The trip ID to check
 * @param options.enabled - Whether to enable the query (default: true if tripId is provided)
 *
 * @example
 * const { data } = useCanAddEntry(tripId);
 * if (!data?.allowed) {
 *   showUpgradePrompt();
 * }
 */
export function useCanAddEntry(tripId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: SUBSCRIPTION_KEYS.canAddEntry(tripId),
    queryFn: async (): Promise<CanAddEntryResponse> => {
      const response = await api.get(`/subscriptions/can-add-entry/${tripId}`);
      return response.data;
    },
    enabled: options?.enabled ?? !!tripId,
    staleTime: STALE_TIMES.USER_DATA, // 5 minutes
    gcTime: GC_TIME, // 30 minutes
  });
}

/**
 * Verify subscription with RevenueCat API directly.
 *
 * Fallback for missed webhooks - queries RevenueCat to get current status
 * and updates the database if needed.
 *
 * Automatically invalidates status cache on success.
 *
 * @example
 * const { mutateAsync, isPending } = useVerifySubscription();
 * const result = await mutateAsync();
 * if (result.subscription_status === 'premium') { ... }
 */
export function useVerifySubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<VerifySubscriptionResponse> => {
      const response = await api.post('/subscriptions/verify');
      return response.data;
    },
    onSuccess: () => {
      // Invalidate status cache to reflect any updates
      queryClient.invalidateQueries({ queryKey: SUBSCRIPTION_KEYS.status });
      // Also invalidate usage as subscription changes affect limits
      queryClient.invalidateQueries({ queryKey: SUBSCRIPTION_KEYS.usage });
    },
  });
}

/**
 * Invalidate all subscription-related caches.
 *
 * Useful after purchase/restore operations to ensure fresh data.
 *
 * @example
 * const invalidateSubscription = useInvalidateSubscription();
 * await purchasePackage(pkg);
 * invalidateSubscription();
 */
export function useInvalidateSubscription() {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({ queryKey: SUBSCRIPTION_KEYS.status });
    queryClient.invalidateQueries({ queryKey: SUBSCRIPTION_KEYS.usage });
  };
}
