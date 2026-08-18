/**
 * Tests for useInvites hooks.
 *
 * Covers:
 * - useRedeemInvite: redeeming an invite code after signup (U6 growth loop)
 * - useSendInvite: surfacing the invite link via the native share sheet
 * - pending invite code storage helpers (deep-link handoff for U7)
 */

import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  useRedeemInvite,
  useSendInvite,
  usePendingInviteRedemption,
  storePendingInviteCode,
  consumePendingInviteCode,
  RedeemInviteResponse,
} from '@hooks/useInvites';
import * as ShareModule from '@utils/share';
import { api } from '@services/api';
import { createTestQueryClient } from '../utils/testUtils';

jest.mock('@services/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockRedeemResponse: RedeemInviteResponse = {
  status: 'redeemed',
  invite_type: 'follow',
  inviter: {
    user_id: 'inviter-123',
    username: 'world_wanderer',
    display_name: 'World Wanderer',
    avatar_url: 'https://example.com/avatar.jpg',
  },
};

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useInvites', () => {
  let queryClient: QueryClient;
  const mockedApi = api as jest.Mocked<typeof api>;
  const mockedShare = jest
    .spyOn(ShareModule.Share, 'share')
    .mockResolvedValue({ action: 'sharedAction' } as never);

  beforeEach(() => {
    queryClient = createTestQueryClient();
    jest.clearAllMocks();
  });

  describe('useRedeemInvite', () => {
    it('posts the code and returns the inviter for the follow-back prompt', async () => {
      mockedApi.post.mockResolvedValue({ data: mockRedeemResponse });

      const { result } = renderHook(() => useRedeemInvite(), {
        wrapper: createWrapper(queryClient),
      });

      result.current.mutate('signed-invite-code');

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockedApi.post).toHaveBeenCalledWith('/invites/redeem', {
        code: 'signed-invite-code',
      });
      expect(result.current.data?.inviter?.username).toBe('world_wanderer');
      expect(result.current.data?.status).toBe('redeemed');
    });

    it('surfaces errors from expired or invalid codes', async () => {
      mockedApi.post.mockRejectedValue(new Error('This invite code is invalid or has expired'));

      const { result } = renderHook(() => useRedeemInvite(), {
        wrapper: createWrapper(queryClient),
      });

      result.current.mutate('expired-code');

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error?.message).toContain('invalid or has expired');
    });
  });

  describe('useSendInvite share-sheet delivery', () => {
    it('opens the native share sheet with the invite link', async () => {
      mockedApi.post.mockResolvedValue({
        data: {
          status: 'sent',
          email: 'friend@example.com',
          invite_url: 'https://atlasi.app/invite?code=abc',
        },
      });

      const { result } = renderHook(() => useSendInvite(), {
        wrapper: createWrapper(queryClient),
      });

      result.current.mutate({ email: 'friend@example.com', invite_type: 'follow' });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      await waitFor(() => expect(mockedShare).toHaveBeenCalled());

      const shareArg = mockedShare.mock.calls[0][0];
      expect(shareArg.message).toContain('https://atlasi.app/invite?code=abc');
    });

    it('falls back to an alert when no link is returned', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert');
      mockedApi.post.mockResolvedValue({
        data: { status: 'sent', email: 'friend@example.com', invite_url: null },
      });

      const { result } = renderHook(() => useSendInvite(), {
        wrapper: createWrapper(queryClient),
      });

      result.current.mutate({ email: 'friend@example.com' });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedShare).not.toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalled();
    });
  });

  describe('usePendingInviteRedemption (deep-link redemption, U7)', () => {
    it('consumes a stored code, redeems it, and exposes the inviter', async () => {
      const mockedStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
      (mockedStorage.getItem as jest.Mock).mockResolvedValue('deep-link-code');
      mockedApi.post.mockResolvedValue({ data: mockRedeemResponse });

      const { result } = renderHook(() => usePendingInviteRedemption(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.inviter?.username).toBe('world_wanderer'));
      expect(mockedApi.post).toHaveBeenCalledWith('/invites/redeem', {
        code: 'deep-link-code',
      });
      // Consume-once semantics: the stored code was cleared.
      expect(mockedStorage.removeItem).toHaveBeenCalled();
    });

    it('does nothing when no code is pending', async () => {
      const mockedStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
      (mockedStorage.getItem as jest.Mock).mockResolvedValue(null);

      const { result } = renderHook(() => usePendingInviteRedemption(), {
        wrapper: createWrapper(queryClient),
      });

      // Let the async consume settle.
      await waitFor(() => expect(mockedStorage.getItem).toHaveBeenCalled());
      expect(mockedApi.post).not.toHaveBeenCalled();
      expect(result.current.inviter).toBeNull();
    });

    it('re-stores the code when redemption fails transiently (network error, no response)', async () => {
      const mockedStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
      (mockedStorage.getItem as jest.Mock).mockResolvedValue('flaky-code');
      mockedApi.post.mockRejectedValue(new Error('network down'));

      renderHook(() => usePendingInviteRedemption(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() =>
        expect(mockedStorage.setItem).toHaveBeenCalledWith(expect.any(String), 'flaky-code')
      );
    });

    it('re-stores the code on a server-side 5xx failure', async () => {
      const mockedStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
      (mockedStorage.getItem as jest.Mock).mockResolvedValue('unlucky-code');
      mockedApi.post.mockRejectedValue({ response: { status: 503 } });

      renderHook(() => usePendingInviteRedemption(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() =>
        expect(mockedStorage.setItem).toHaveBeenCalledWith(expect.any(String), 'unlucky-code')
      );
    });

    it('drops a permanently invalid code instead of re-storing it (4xx)', async () => {
      const mockedStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
      (mockedStorage.getItem as jest.Mock).mockResolvedValue('bogus-code');
      mockedApi.post.mockRejectedValue({ response: { status: 400 } });

      renderHook(() => usePendingInviteRedemption(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(mockedApi.post).toHaveBeenCalled());
      // Flush the mutation's rejection through react-query's onError.
      await act(async () => {});
      await act(async () => {});

      // The invalid code is not re-stored: retrying it forever is pointless.
      expect(mockedStorage.setItem).not.toHaveBeenCalled();
    });

    it('dismiss clears the inviter', async () => {
      const mockedStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
      (mockedStorage.getItem as jest.Mock).mockResolvedValue('deep-link-code');
      mockedApi.post.mockResolvedValue({ data: mockRedeemResponse });

      const { result } = renderHook(() => usePendingInviteRedemption(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.inviter).not.toBeNull());
      act(() => {
        result.current.dismiss();
      });
      await waitFor(() => expect(result.current.inviter).toBeNull());
    });
  });

  describe('pending invite code storage', () => {
    it('stores and consumes a pending code exactly once', async () => {
      const mockedStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
      (mockedStorage.getItem as jest.Mock).mockResolvedValue('stored-code');

      await storePendingInviteCode('stored-code');
      expect(mockedStorage.setItem).toHaveBeenCalledWith(expect.any(String), 'stored-code');

      const code = await consumePendingInviteCode();
      expect(code).toBe('stored-code');
      expect(mockedStorage.removeItem).toHaveBeenCalled();
    });

    it('returns null when no code is stored', async () => {
      const mockedStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
      (mockedStorage.getItem as jest.Mock).mockResolvedValue(null);

      const code = await consumePendingInviteCode();
      expect(code).toBeNull();
    });
  });
});
