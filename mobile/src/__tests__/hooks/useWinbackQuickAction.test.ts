/**
 * "Deleting? Get 50% off" home-screen quick action.
 *
 * Registered only for signed-in free users who haven't used it; cleared when
 * they subscribe or sign out; a tap (including a cold-start launch action)
 * presents the winback once the session and app are ready.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as QuickActions from 'expo-quick-actions';
import { useQuickActionCallback } from 'expo-quick-actions/hooks';

import { useWinbackQuickAction, WINBACK_QUICK_ACTION } from '@hooks/useWinbackQuickAction';
import { useSubscriptionStore } from '@stores/subscriptionStore';

const mockPresentWinback = jest.fn();
jest.mock('@hooks/useWinbackOffer', () => ({
  useWinbackOffer: () => ({ presentWinback: mockPresentWinback }),
}));

const mockSetItems = QuickActions.setItems as jest.Mock;
const mockUseCallback = useQuickActionCallback as jest.Mock;
const mockGetItem = AsyncStorage.getItem as jest.Mock;

const session = { user: { id: 'user-1' } } as unknown as Session;

function lastSetItems() {
  return mockSetItems.mock.calls[mockSetItems.mock.calls.length - 1]?.[0];
}

function tapAction(id: string) {
  const callback = mockUseCallback.mock.calls[mockUseCallback.mock.calls.length - 1][0];
  act(() => {
    callback({ id, title: '' });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetItem.mockResolvedValue(null);
  mockPresentWinback.mockResolvedValue(null);
  useSubscriptionStore.setState({ status: 'free' });
});

describe('useWinbackQuickAction registration', () => {
  it('registers the action for a signed-in free user', async () => {
    renderHook(() => useWinbackQuickAction(session, true));
    await waitFor(() => expect(lastSetItems()).toEqual([WINBACK_QUICK_ACTION]));
  });

  it('clears the action when the user becomes premium', async () => {
    renderHook(() => useWinbackQuickAction(session, true));
    await waitFor(() => expect(lastSetItems()).toEqual([WINBACK_QUICK_ACTION]));

    act(() => {
      useSubscriptionStore.setState({ status: 'premium' });
    });
    await waitFor(() => expect(lastSetItems()).toEqual([]));
  });

  it('clears the action when signed out', async () => {
    renderHook(() => useWinbackQuickAction(null, true));
    await waitFor(() => expect(lastSetItems()).toEqual([]));
  });

  it('clears the action once it has been used', async () => {
    mockGetItem.mockResolvedValue('2026-09-28T00:00:00.000Z');
    renderHook(() => useWinbackQuickAction(session, true));
    await waitFor(() => expect(lastSetItems()).toEqual([]));
  });

  it('waits while subscription status is loading', async () => {
    useSubscriptionStore.setState({ status: 'loading' });
    renderHook(() => useWinbackQuickAction(session, true));
    await act(async () => {});
    expect(mockSetItems).not.toHaveBeenCalled();
  });
});

describe('useWinbackQuickAction tap', () => {
  it('presents the winback when the action is tapped', async () => {
    renderHook(() => useWinbackQuickAction(session, true));
    tapAction('winback');
    await waitFor(() => expect(mockPresentWinback).toHaveBeenCalledWith('quick_action'));
    expect(mockPresentWinback).toHaveBeenCalledTimes(1);
  });

  it('holds a cold-start tap until the session is restored', async () => {
    const { rerender } = renderHook(
      ({ s, ready }: { s: Session | null; ready: boolean }) => useWinbackQuickAction(s, ready),
      { initialProps: { s: null as Session | null, ready: false } }
    );
    tapAction('winback');
    await act(async () => {});
    expect(mockPresentWinback).not.toHaveBeenCalled();

    rerender({ s: session, ready: true });
    await waitFor(() => expect(mockPresentWinback).toHaveBeenCalledWith('quick_action'));
  });

  it('ignores other actions', async () => {
    renderHook(() => useWinbackQuickAction(session, true));
    tapAction('something-else');
    await act(async () => {});
    expect(mockPresentWinback).not.toHaveBeenCalled();
  });

  it('passes the library a stable callback so the launch action is not replayed', () => {
    const { rerender } = renderHook(() => useWinbackQuickAction(session, true));
    rerender({});
    const callbacks = mockUseCallback.mock.calls.map((c) => c[0]);
    expect(new Set(callbacks).size).toBe(1);
  });
});
