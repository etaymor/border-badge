/**
 * Tests for BlockedUsersScreen.
 *
 * Covers:
 * - blocked users render from the API
 * - unblocking (confirm dialog -> DELETE) refetches and updates the list
 * - error state with retry
 */

import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '../utils/testUtils';

import { BlockedUsersScreen } from '@screens/friends/BlockedUsersScreen';
import { api } from '@services/api';
import type { FriendsStackScreenProps } from '@navigation/types';
import { createMockNavigation } from '../utils/mockFactories';

jest.mock('@services/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedApi = api as jest.Mocked<typeof api>;

const mockNavigation =
  createMockNavigation() as unknown as FriendsStackScreenProps<'BlockedUsers'>['navigation'];
const mockRoute = {
  key: 'blocked-users',
  name: 'BlockedUsers',
} as FriendsStackScreenProps<'BlockedUsers'>['route'];

const blockedUser = {
  id: 'block-1',
  user_id: 'user-9',
  username: 'blocked_traveler',
  avatar_url: null,
};

function renderScreen() {
  return render(<BlockedUsersScreen navigation={mockNavigation} route={mockRoute} />);
}

describe('BlockedUsersScreen', () => {
  it('renders the blocked users list', async () => {
    mockedApi.get.mockResolvedValue({ data: [blockedUser] });
    renderScreen();

    expect(await screen.findByText('@blocked_traveler')).toBeTruthy();
    expect(mockedApi.get).toHaveBeenCalledWith('/blocks', {
      params: { limit: 50, offset: 0 },
    });
  });

  it('unblocking a user updates the list', async () => {
    // First load returns the blocked user; after unblock, the list is empty.
    mockedApi.get.mockResolvedValueOnce({ data: [blockedUser] }).mockResolvedValue({ data: [] });
    mockedApi.delete.mockResolvedValue({
      data: { status: 'unblocked', blocked_id: blockedUser.user_id },
    });

    renderScreen();
    expect(await screen.findByText('@blocked_traveler')).toBeTruthy();

    fireEvent.press(screen.getByText('Unblock'));

    // Confirm via the Alert dialog.
    const alertMock = Alert.alert as jest.Mock;
    expect(alertMock).toHaveBeenCalled();
    const buttons = alertMock.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    const confirm = buttons.find((b) => b.text === 'Unblock');
    expect(confirm).toBeTruthy();
    confirm?.onPress?.();

    await waitFor(() =>
      expect(mockedApi.delete).toHaveBeenCalledWith(`/blocks/${blockedUser.user_id}`)
    );
    await waitFor(() => expect(screen.queryByText('@blocked_traveler')).toBeNull());
    expect(screen.getByText('All clear')).toBeTruthy();
  });

  it('shows an error state with retry when the list fails to load', async () => {
    mockedApi.get.mockRejectedValueOnce({ response: { status: 500 } });
    renderScreen();

    expect(await screen.findByText("Couldn't load blocked travelers")).toBeTruthy();

    mockedApi.get.mockResolvedValue({ data: [blockedUser] });
    fireEvent.press(screen.getByText('Try Again'));

    expect(await screen.findByText('@blocked_traveler')).toBeTruthy();
  });
});
