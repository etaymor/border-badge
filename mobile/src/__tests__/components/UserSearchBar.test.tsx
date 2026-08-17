/**
 * Tests for UserSearchBar.
 *
 * Covers:
 * - result rows are pressable and select the user
 * - the dropdown list persists keyboard taps (keyboardShouldPersistTaps)
 * - no delayed blur timeout: blur hides the dropdown immediately (the old
 *   200ms setTimeout race is gone)
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '../utils/testUtils';

import { UserSearchBar } from '@components/friends';
import * as useUserSearchModule from '@hooks/useUserSearch';

jest.mock('@services/api', () => ({
  api: {
    get: jest.fn().mockResolvedValue({ data: [] }),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

const searchResults = [
  {
    id: 'user-1',
    username: 'wanderer',
    avatar_url: null,
    country_count: 7,
    is_following: false,
  },
];

function mockSearch(data: typeof searchResults | undefined, isFetching = false) {
  jest.spyOn(useUserSearchModule, 'useUserSearch').mockReturnValue({
    data,
    isFetching,
  } as unknown as ReturnType<typeof useUserSearchModule.useUserSearch>);
}

describe('UserSearchBar', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows results while focused and selects a user on row press', async () => {
    mockSearch(searchResults);
    const onUserSelect = jest.fn();
    render(<UserSearchBar onUserSelect={onUserSelect} />);

    const input = screen.getByPlaceholderText('Find fellow travelers...');
    fireEvent(input, 'focus');
    fireEvent.changeText(input, 'wan');

    expect(await screen.findByText('@wanderer')).toBeTruthy();

    fireEvent.press(screen.getByText('@wanderer'));
    expect(onUserSelect).toHaveBeenCalledWith('user-1', 'wanderer');
    // Selecting clears the query (and thereby the dropdown).
    expect(input.props.value).toBe('');
  });

  it('keeps keyboard taps on the dropdown list (persistTaps handled)', async () => {
    mockSearch(searchResults);
    render(<UserSearchBar />);

    const input = screen.getByPlaceholderText('Find fellow travelers...');
    fireEvent(input, 'focus');
    fireEvent.changeText(input, 'wan');
    await screen.findByText('@wanderer');

    const list = screen.UNSAFE_getByProps({ keyboardShouldPersistTaps: 'handled' });
    expect(list).toBeTruthy();
  });

  it('hides the dropdown immediately on blur with no lingering timers', async () => {
    jest.useFakeTimers();
    try {
      mockSearch(searchResults);
      render(<UserSearchBar />);

      const input = screen.getByPlaceholderText('Find fellow travelers...');
      fireEvent(input, 'focus');
      fireEvent.changeText(input, 'wan');
      await waitFor(() => expect(screen.getByText('@wanderer')).toBeTruthy());

      fireEvent(input, 'blur');

      // Immediately hidden — no 200ms grace window racing row presses.
      expect(screen.queryByText('@wanderer')).toBeNull();
      // And nothing pending that would re-toggle visibility later.
      jest.advanceTimersByTime(500);
      expect(screen.queryByText('@wanderer')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
