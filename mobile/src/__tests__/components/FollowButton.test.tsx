/**
 * Tests for FollowButton.
 *
 * Covers:
 * - renders Follow vs Following purely from the cache-backed `isFollowing`
 *   prop (no local optimistic state, per plan U8: the query cache is the
 *   single source of truth)
 * - pressing fires the correct mutation (follow -> POST, unfollow -> DELETE)
 * - pending-press guard: a rapid double-tap fires exactly one mutation
 * - pending state disables the button (accessibility disabled state)
 * - onFollowChange fires with the next state after a successful mutation
 */

import '@testing-library/react-native/extend-expect';

import React from 'react';
import { fireEvent, render, screen, waitFor } from '../utils/testUtils';

import { FollowButton } from '@components/friends/FollowButton';
import { api } from '@services/api';

const mockedApi = api as jest.Mocked<typeof api>;

/** A promise that only resolves when the test says so. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('FollowButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the Follow state when isFollowing is false', () => {
    render(<FollowButton userId="user-1" username="wanderer" isFollowing={false} />);

    expect(screen.getByText('Follow')).toBeTruthy();
    expect(screen.queryByText('Following')).toBeNull();
  });

  it('renders the Following state when isFollowing is true', () => {
    render(<FollowButton userId="user-1" username="wanderer" isFollowing={true} />);

    expect(screen.getByText('Following')).toBeTruthy();
    expect(screen.queryByText('Follow')).toBeNull();
  });

  it('renders from the prop only: a successful follow does not flip the label locally', async () => {
    mockedApi.post.mockResolvedValue({ data: { success: true } });
    const onFollowChange = jest.fn();
    const { rerender } = render(
      <FollowButton
        userId="user-1"
        username="wanderer"
        isFollowing={false}
        onFollowChange={onFollowChange}
      />
    );

    fireEvent.press(screen.getByText('Follow'));
    await waitFor(() => expect(onFollowChange).toHaveBeenCalledWith(true));

    // No local state: the label follows the (unchanged) prop, not the mutation.
    expect(screen.getByText('Follow')).toBeTruthy();
    expect(screen.queryByText('Following')).toBeNull();

    // The cache-driven prop update is what flips the label.
    rerender(
      <FollowButton
        userId="user-1"
        username="wanderer"
        isFollowing={true}
        onFollowChange={onFollowChange}
      />
    );
    expect(screen.getByText('Following')).toBeTruthy();
  });

  it('pressing Follow fires the follow mutation (POST /follows/:id)', async () => {
    mockedApi.post.mockResolvedValue({ data: { success: true } });
    render(<FollowButton userId="user-1" username="wanderer" isFollowing={false} />);

    fireEvent.press(screen.getByText('Follow'));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith('/follows/user-1'));
    expect(mockedApi.delete).not.toHaveBeenCalled();
  });

  it('pressing Following fires the unfollow mutation (DELETE /follows/:id)', async () => {
    mockedApi.delete.mockResolvedValue({ data: { success: true } });
    const onFollowChange = jest.fn();
    render(
      <FollowButton
        userId="user-1"
        username="wanderer"
        isFollowing={true}
        onFollowChange={onFollowChange}
      />
    );

    fireEvent.press(screen.getByText('Following'));

    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith('/follows/user-1'));
    expect(mockedApi.post).not.toHaveBeenCalled();
    await waitFor(() => expect(onFollowChange).toHaveBeenCalledWith(false));
  });

  it('guards against rapid double-taps: only one mutation while pending', async () => {
    const request = deferred<{ data: { success: boolean } }>();
    mockedApi.post.mockReturnValue(request.promise as ReturnType<typeof api.post>);
    render(<FollowButton userId="user-1" username="wanderer" isFollowing={false} />);

    const button = screen.getByText('Follow');
    fireEvent.press(button);
    // The mutationFn dispatch is async; wait for the first press to land.
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1));

    // Further taps while the request is still in flight are swallowed by the
    // isPending guard (and the disabled touchable).
    fireEvent.press(button);
    fireEvent.press(button);
    await waitFor(() => expect(screen.getByText('Follow')).toBeDisabled());
    expect(mockedApi.post).toHaveBeenCalledTimes(1);

    request.resolve({ data: { success: true } });
    await waitFor(() => expect(screen.getByText('Follow')).not.toBeDisabled());
  });

  it('is disabled while the mutation is pending', async () => {
    const request = deferred<{ data: { success: boolean } }>();
    mockedApi.post.mockReturnValue(request.promise as ReturnType<typeof api.post>);
    render(<FollowButton userId="user-1" username="wanderer" isFollowing={false} />);

    expect(screen.getByText('Follow')).not.toBeDisabled();

    fireEvent.press(screen.getByText('Follow'));
    await waitFor(() => expect(screen.getByText('Follow')).toBeDisabled());

    request.resolve({ data: { success: true } });
    await waitFor(() => expect(screen.getByText('Follow')).not.toBeDisabled());
  });
});
