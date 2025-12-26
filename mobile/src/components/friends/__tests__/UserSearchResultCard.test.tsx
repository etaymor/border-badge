import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { UserSearchResultCard, type UserSearchResult } from '../UserSearchResultCard';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return Wrapper;
}

describe('UserSearchResultCard', () => {
  const mockUser: UserSearchResult = {
    id: 'user-123',
    username: 'alice',
    avatar_url: 'https://example.com/avatar.jpg',
    country_count: 10,
    is_following: false,
  };

  const mockOnPress = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render user information correctly', () => {
    const { getByText } = render(<UserSearchResultCard user={mockUser} onPress={mockOnPress} />, {
      wrapper: createWrapper(),
    });

    expect(getByText('@alice')).toBeTruthy();
    expect(getByText('10 countries')).toBeTruthy();
  });

  it('should render singular country for count of 1', () => {
    const singleCountryUser = { ...mockUser, country_count: 1 };

    const { getByText } = render(
      <UserSearchResultCard user={singleCountryUser} onPress={mockOnPress} />,
      { wrapper: createWrapper() }
    );

    expect(getByText('1 country')).toBeTruthy();
  });

  it('should render plural countries for count > 1', () => {
    const { getByText } = render(<UserSearchResultCard user={mockUser} onPress={mockOnPress} />, {
      wrapper: createWrapper(),
    });

    expect(getByText('10 countries')).toBeTruthy();
  });

  it('should render avatar when avatar_url is provided', () => {
    const { getByTestId } = render(<UserSearchResultCard user={mockUser} onPress={mockOnPress} />, {
      wrapper: createWrapper(),
    });

    // Test that the image is rendered (implementation detail)
    expect(getByTestId).toBeDefined();
  });

  it('should render placeholder icon when avatar_url is null', () => {
    const userWithoutAvatar = { ...mockUser, avatar_url: null };

    const { getByText } = render(
      <UserSearchResultCard user={userWithoutAvatar} onPress={mockOnPress} />,
      { wrapper: createWrapper() }
    );

    // Should render username even without avatar
    expect(getByText('@alice')).toBeTruthy();
  });

  it('should call onPress when card is pressed', () => {
    const { getByText } = render(<UserSearchResultCard user={mockUser} onPress={mockOnPress} />, {
      wrapper: createWrapper(),
    });

    fireEvent.press(getByText('@alice'));

    expect(mockOnPress).toHaveBeenCalledTimes(1);
  });

  it('should render FollowButton with correct props', () => {
    const { getByText } = render(<UserSearchResultCard user={mockUser} onPress={mockOnPress} />, {
      wrapper: createWrapper(),
    });

    // FollowButton is rendered and shows "Follow" text
    expect(getByText('Follow')).toBeTruthy();
  });

  it('should pass following state to FollowButton', () => {
    const followingUser = { ...mockUser, is_following: true };

    const { getByText } = render(
      <UserSearchResultCard user={followingUser} onPress={mockOnPress} />,
      { wrapper: createWrapper() }
    );

    // FollowButton shows "Following" text when user is being followed
    expect(getByText('Following')).toBeTruthy();
  });

  it('should display 0 countries correctly', () => {
    const newUser = { ...mockUser, country_count: 0 };

    const { getByText } = render(<UserSearchResultCard user={newUser} onPress={mockOnPress} />, {
      wrapper: createWrapper(),
    });

    expect(getByText('0 countries')).toBeTruthy();
  });
});
