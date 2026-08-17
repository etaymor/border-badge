/**
 * Tests for FriendsScreen.
 *
 * Covers:
 * - skeleton loaders replace the spinner-only loading state
 * - error state with a retry button that refetches
 * - flag-off 404 renders the friendly "social is unavailable" state
 * - the feed renders known activity types (incl. trip_updated) and
 *   default-skips unknown ones without crashing
 */

import React from 'react';
import { fireEvent, render, screen } from '../utils/testUtils';

import { FriendsScreen } from '@screens/friends/FriendsScreen';
import * as useSocialHomeModule from '@hooks/useSocialHome';
import type { FeedItem } from '@hooks/useSocialHome';
import type { FriendsStackScreenProps } from '@navigation/types';
import { createMockNavigation } from '../utils/mockFactories';

jest.mock('@services/api', () => ({
  api: {
    get: jest.fn().mockResolvedValue({ data: [] }),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockNavigation =
  createMockNavigation() as unknown as FriendsStackScreenProps<'FriendsHome'>['navigation'];
const mockRoute = {
  key: 'friends-home',
  name: 'FriendsHome',
} as FriendsStackScreenProps<'FriendsHome'>['route'];

function makeFeedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    activity_id: `activity-${Math.random()}`,
    activity_type: 'country_visited',
    created_at: '2024-01-15T10:00:00Z',
    user: { user_id: 'user-1', username: 'traveler1', avatar_url: null },
    country: { country_id: 'country-1', country_name: 'Japan', country_code: 'JP' },
    entry: null,
    ...overrides,
  };
}

type SocialHomeResult = ReturnType<typeof useSocialHomeModule.useSocialHome>;

function mockSocialHome(overrides: Partial<SocialHomeResult>) {
  const base = {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isRefetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: jest.fn(),
    refetch: jest.fn(),
  };
  jest
    .spyOn(useSocialHomeModule, 'useSocialHome')
    .mockReturnValue({ ...base, ...overrides } as SocialHomeResult);
}

function makeSocialData(items: FeedItem[]) {
  return {
    pages: [
      {
        feed: { items, next_cursor: null, has_more: false },
        follow_stats: { follower_count: 3, following_count: 2 },
        friends_ranking: {
          rank: 1,
          total_friends: 3,
          my_countries: 10,
          leader_username: null,
          leader_countries: null,
        },
        pending_tag_count: 0,
      },
    ],
    pageParams: [null],
  } as NonNullable<SocialHomeResult['data']>;
}

function renderScreen() {
  return render(<FriendsScreen navigation={mockNavigation} route={mockRoute} />);
}

describe('FriendsScreen', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows skeleton loaders (not a spinner) while loading', () => {
    mockSocialHome({ isLoading: true });
    renderScreen();

    expect(screen.getByTestId('friends-stats-skeleton')).toBeTruthy();
    expect(screen.getByTestId('feed-skeleton')).toBeTruthy();
  });

  it('shows an error state with retry when social-home fails, and retry refetches', () => {
    const refetch = jest.fn();
    mockSocialHome({
      isError: true,
      error: { response: { status: 500 } } as unknown as Error,
      refetch,
    });
    renderScreen();

    expect(screen.getByText("Couldn't load your feed")).toBeTruthy();

    fireEvent.press(screen.getByText('Try Again'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the friendly unavailable state on a flag-off 404', () => {
    mockSocialHome({
      isError: true,
      error: { response: { status: 404 } } as unknown as Error,
    });
    renderScreen();

    expect(screen.getByText('Social is taking a break')).toBeTruthy();
    expect(screen.queryByText('Try Again')).toBeNull();
  });

  it('renders trip_updated cards and default-skips unknown activity types', () => {
    const items = [
      makeFeedItem({ activity_id: 'a1' }),
      makeFeedItem({
        activity_id: 'a2',
        activity_type: 'trip_updated',
        user: { user_id: 'user-2', username: 'trip_editor', avatar_url: null },
      }),
      makeFeedItem({
        activity_id: 'a3',
        activity_type: 'mystery_future_type',
        user: { user_id: 'user-3', username: 'ghost_user', avatar_url: null },
      }),
    ];
    mockSocialHome({ data: makeSocialData(items) });
    renderScreen();

    // Known types render.
    expect(screen.getByText(/planted a flag in/)).toBeTruthy();
    expect(screen.getByText(/updated their trip in/)).toBeTruthy();
    // Unknown type renders nothing — no crash, no ghost content.
    expect(screen.queryByText('ghost_user')).toBeNull();
  });
});
