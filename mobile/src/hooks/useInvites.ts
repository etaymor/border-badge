import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { socialKeys } from '@hooks/queryKeys';
import { api } from '@services/api';
import { Share } from '@utils/share';

// Types
export interface PendingInvite {
  id: string;
  email: string;
  invite_type: 'follow' | 'trip_tag';
  status: string;
  created_at: string;
}

interface InviteRequest {
  email: string;
  invite_type?: 'follow' | 'trip_tag';
  trip_id?: string;
}

interface InviteResponse {
  status: string;
  email: string;
  /** Public landing-page link -- the invite's primary delivery path. */
  invite_url?: string | null;
}

export interface InviterSummary {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

export interface RedeemInviteResponse {
  status: 'redeemed' | 'already_redeemed';
  invite_type: string;
  inviter: InviterSummary | null;
}

// AsyncStorage key holding an invite code that arrived (via deep link)
// before the user was signed in. Consumed after signup/first launch.
const PENDING_INVITE_CODE_KEY = 'atlasi-pending-invite-code';

/**
 * Persist an invite code until the user is authenticated and it can be
 * redeemed. Deep-link routing calls this when the app opens from an
 * /invite link without a session.
 */
export async function storePendingInviteCode(code: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_INVITE_CODE_KEY, code);
  } catch {
    // Storage failures degrade to email-match attribution at signup.
  }
}

/**
 * Read and clear the stored invite code (consume-once semantics).
 * Returns null when no code is pending.
 */
export async function consumePendingInviteCode(): Promise<string | null> {
  try {
    const code = await AsyncStorage.getItem(PENDING_INVITE_CODE_KEY);
    if (!code) return null;
    await AsyncStorage.removeItem(PENDING_INVITE_CODE_KEY);
    return code;
  } catch {
    return null;
  }
}

/**
 * Hook to get list of pending invites sent by the current user.
 */
export function usePendingInvites(options?: { limit?: number; offset?: number }) {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  return useQuery<PendingInvite[]>({
    queryKey: socialKeys.pendingInvites(limit, offset),
    queryFn: async () => {
      const response = await api.get<PendingInvite[]>('/invites/pending', {
        params: { limit, offset },
      });
      return response.data;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Hook to get pending trip_tag invites for a specific trip.
 */
export function useTripPendingInvites(tripId: string | undefined) {
  return useQuery<PendingInvite[]>({
    queryKey: socialKeys.tripInvites(tripId),
    queryFn: async () => {
      const response = await api.get<PendingInvite[]>(`/invites/trip/${tripId}`);
      return response.data;
    },
    enabled: !!tripId,
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Hook to send an invite to a non-user.
 */
export function useSendInvite() {
  const queryClient = useQueryClient();

  return useMutation<InviteResponse, Error, InviteRequest>({
    mutationFn: async (data) => {
      const response = await api.post<InviteResponse>('/invites', data);
      return response.data;
    },

    onSuccess: (data) => {
      // Invalidate pending invites query
      queryClient.invalidateQueries({ queryKey: socialKeys.invites });

      // Primary delivery: hand the link to the native share sheet so the
      // inviter sends it over iMessage/WhatsApp/etc. Email (Resend) is
      // best-effort on the backend and may not be configured at all.
      if (data.invite_url) {
        Share.share({
          message: `Join me on Atlasi and track your travels: ${data.invite_url}`,
        }).catch(() => {
          // User dismissed or share unavailable -- the invite still exists.
        });
        return;
      }

      if (data.status === 'already_pending') {
        Alert.alert('Already Invited', `An invite is already pending for ${data.email}`);
      } else {
        Alert.alert('Invite Sent', `An invitation has been sent to ${data.email}`);
      }
    },

    onError: (error) => {
      const message = error.message || 'Failed to send invite';
      Alert.alert('Error', message);
    },
  });
}

/**
 * Hook to redeem an invite code after signup or first launch from an invite
 * link. Redemption is the deterministic attribution path (it survives Apple
 * private-relay signups, which defeat email matching): the backend creates
 * the inviter->me follow, marks the invite accepted, and returns the inviter
 * so the UI can show a "〈inviter〉 invited you -- follow back" prompt.
 */
export function useRedeemInvite() {
  const queryClient = useQueryClient();

  return useMutation<RedeemInviteResponse, Error, string>({
    mutationFn: async (code) => {
      const response = await api.post<RedeemInviteResponse>('/invites/redeem', { code });
      return response.data;
    },

    onSuccess: () => {
      // The inviter now follows me: follower stats and the social home
      // surface changed server-side.
      queryClient.invalidateQueries({ queryKey: socialKeys.follows });
      queryClient.invalidateQueries({ queryKey: socialKeys.socialHome });
    },
  });
}

/**
 * Consume-and-redeem any invite code stored by the deep-link handler.
 *
 * Mounted on the Friends home surface: when a code is pending, it is
 * redeemed once and the inviter is exposed so the caller can render the
 * "〈inviter〉 invited you — follow back" prompt (InviteFollowBackPrompt).
 * A failed redemption re-stores the code so a transient network error does
 * not burn the attribution.
 */
export function usePendingInviteRedemption() {
  const [inviter, setInviter] = useState<InviterSummary | null>(null);
  const redeemMutation = useRedeemInvite();
  const attemptedRef = useRef(false);

  const { mutate: redeem } = redeemMutation;

  useEffect(() => {
    if (attemptedRef.current) {
      return;
    }
    attemptedRef.current = true;

    void (async () => {
      const code = await consumePendingInviteCode();
      if (!code) {
        return;
      }
      redeem(code, {
        onSuccess: (data) => {
          if (data.inviter) {
            setInviter(data.inviter);
          }
        },
        onError: (error) => {
          // Keep the code for a later retry (next mount) only when the
          // failure is transient: no response (network) or a server-side
          // 5xx. A 4xx means the code is permanently invalid (expired,
          // malformed, already used) -- re-storing it would retry forever.
          const status = (error as AxiosError)?.response?.status;
          if (status === undefined || status >= 500) {
            void storePendingInviteCode(code);
          }
        },
      });
    })();
  }, [redeem]);

  const dismiss = useCallback(() => setInviter(null), []);

  return { inviter, dismiss };
}

/**
 * Hook to cancel a pending invite.
 */
export function useCancelInvite() {
  const queryClient = useQueryClient();

  return useMutation<{ status: string; invite_id: string }, Error, string>({
    mutationFn: async (inviteId) => {
      const response = await api.delete<{ status: string; invite_id: string }>(
        `/invites/${inviteId}`
      );
      return response.data;
    },

    onSuccess: () => {
      // Invalidate pending invites query
      queryClient.invalidateQueries({ queryKey: socialKeys.invites });
    },

    onError: (error) => {
      const message = error.message || 'Failed to cancel invite';
      Alert.alert('Error', message);
    },
  });
}
