import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { FollowButton } from '../FollowButton';
import * as useFollowsModule from '../../../hooks/useFollows';

// Mock the hooks
jest.mock('../../../hooks/useFollows');

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

describe('FollowButton', () => {
  const mockFollowMutation = {
    mutate: jest.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
  };

  const mockUnfollowMutation = {
    mutate: jest.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useFollowsModule.useFollowUser as jest.Mock).mockReturnValue(mockFollowMutation);
    (useFollowsModule.useUnfollowUser as jest.Mock).mockReturnValue(mockUnfollowMutation);
  });

  it('should render "Follow" when not following', () => {
    const { getByText } = render(<FollowButton userId="user-123" isFollowing={false} />, {
      wrapper: createWrapper(),
    });

    expect(getByText('Follow')).toBeTruthy();
  });

  it('should render "Following" when following', () => {
    const { getByText } = render(<FollowButton userId="user-123" isFollowing={true} />, {
      wrapper: createWrapper(),
    });

    expect(getByText('Following')).toBeTruthy();
  });

  it('should call follow mutation when pressing Follow button', () => {
    const { getByText } = render(<FollowButton userId="user-123" isFollowing={false} />, {
      wrapper: createWrapper(),
    });

    fireEvent.press(getByText('Follow'));

    expect(mockFollowMutation.mutate).toHaveBeenCalledTimes(1);
    expect(mockUnfollowMutation.mutate).not.toHaveBeenCalled();
  });

  it('should call unfollow mutation when pressing Following button', () => {
    const { getByText } = render(<FollowButton userId="user-123" isFollowing={true} />, {
      wrapper: createWrapper(),
    });

    fireEvent.press(getByText('Following'));

    expect(mockUnfollowMutation.mutate).toHaveBeenCalledTimes(1);
    expect(mockFollowMutation.mutate).not.toHaveBeenCalled();
  });

  it('should show loading indicator when mutation is pending', () => {
    (useFollowsModule.useFollowUser as jest.Mock).mockReturnValue({
      ...mockFollowMutation,
      isPending: true,
    });

    const { queryByText, UNSAFE_getByType } = render(
      <FollowButton userId="user-123" isFollowing={false} />,
      { wrapper: createWrapper() }
    );

    // Button text should not be visible
    expect(queryByText('Follow')).toBeNull();

    // ActivityIndicator should be present
    expect(UNSAFE_getByType).toBeDefined();
  });

  it('should disable button when mutation is pending', () => {
    (useFollowsModule.useFollowUser as jest.Mock).mockReturnValue({
      ...mockFollowMutation,
      isPending: true,
    });

    const { getByRole } = render(<FollowButton userId="user-123" isFollowing={false} />, {
      wrapper: createWrapper(),
    });

    const button = getByRole('button');
    expect(button.props.accessibilityState.disabled).toBe(true);
  });

  it('should render compact button style when compact prop is true', () => {
    const { getByText } = render(<FollowButton userId="user-123" isFollowing={false} compact />, {
      wrapper: createWrapper(),
    });

    const button = getByText('Follow').parent?.parent;
    expect(button?.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ minHeight: 32 }), // Compact button height
      ])
    );
  });

  it('should render full-size button style when compact prop is false', () => {
    const { getByText } = render(
      <FollowButton userId="user-123" isFollowing={false} compact={false} />,
      { wrapper: createWrapper() }
    );

    const button = getByText('Follow').parent?.parent;
    expect(button?.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ minHeight: 44 }), // Full button height
      ])
    );
  });

  it('should apply custom styles', () => {
    const customStyle = { marginTop: 20 };

    const { getByText } = render(
      <FollowButton userId="user-123" isFollowing={false} style={customStyle} />,
      { wrapper: createWrapper() }
    );

    const button = getByText('Follow').parent?.parent;
    expect(button?.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining(customStyle)])
    );
  });
});
