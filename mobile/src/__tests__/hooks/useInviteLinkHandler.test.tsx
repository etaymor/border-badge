/**
 * Tests for useInviteLinkHandler (invite deep links, U7).
 *
 * Covers:
 * - /invite?code= URL parsing -> storePendingInviteCode called
 * - Signed-in warm link -> navigates to the Friends home surface
 * - Signed-out link -> stores the code but does not navigate
 * - Navigation-not-ready queueing -> navigates once handleNavigationReady fires
 * - Non-invite URLs (and codeless invite URLs) are ignored
 * - Cold start via Linking.getInitialURL
 */

// Social features on: invite links route to the Friends tab.
jest.mock('@config/features', () => ({
  features: { enableSocial: true },
}));

jest.mock('react-native/Libraries/Linking/Linking', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    getInitialURL: jest.fn(() => Promise.resolve(null)),
  },
}));

jest.mock('@hooks/useInvites', () => ({
  storePendingInviteCode: jest.fn(() => Promise.resolve()),
}));

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import type { Session } from '@supabase/supabase-js';

import { useInviteLinkHandler } from '@hooks/useInviteLinkHandler';
import { storePendingInviteCode } from '@hooks/useInvites';
import type { RootStackParamList } from '@navigation/types';

const INVITE_URL = 'https://atlasi.app/invite?code=signed-code-123';

const mockedLinking = Linking as jest.Mocked<typeof Linking>;
const mockedStore = storePendingInviteCode as jest.MockedFunction<typeof storePendingInviteCode>;

const signedInSession = { user: { id: 'user-123' } } as unknown as Session;

interface NavRefMock {
  ref: NavigationContainerRefWithCurrent<RootStackParamList>;
  navigate: jest.Mock;
  setReady: (ready: boolean) => void;
}

function createNavigationRef(initiallyReady: boolean): NavRefMock {
  let ready = initiallyReady;
  const navigate = jest.fn();
  const ref = {
    isReady: jest.fn(() => ready),
    navigate,
  } as unknown as NavigationContainerRefWithCurrent<RootStackParamList>;
  return {
    ref,
    navigate,
    setReady: (value: boolean) => {
      ready = value;
    },
  };
}

/** The 'url' listener the hook registered with Linking.addEventListener. */
function getUrlListener(): (event: { url: string }) => void {
  const call = (mockedLinking.addEventListener as jest.Mock).mock.calls.find(
    ([eventName]) => eventName === 'url'
  );
  expect(call).toBeDefined();
  return call![1];
}

describe('useInviteLinkHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockedLinking.getInitialURL as jest.Mock).mockResolvedValue(null);
  });

  it('parses a warm /invite?code= link, stores the code, and navigates when signed in', async () => {
    const nav = createNavigationRef(true);

    renderHook(() => useInviteLinkHandler(nav.ref, signedInSession));

    await act(async () => {
      getUrlListener()({ url: INVITE_URL });
    });

    await waitFor(() => expect(mockedStore).toHaveBeenCalledWith('signed-code-123'));
    expect(nav.navigate).toHaveBeenCalledWith('Main', {
      screen: 'Friends',
      params: { screen: 'FriendsHome' },
    });
  });

  it('stores the code without navigating when signed out', async () => {
    const nav = createNavigationRef(true);

    renderHook(() => useInviteLinkHandler(nav.ref, null));

    await act(async () => {
      getUrlListener()({ url: INVITE_URL });
    });

    await waitFor(() => expect(mockedStore).toHaveBeenCalledWith('signed-code-123'));
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('queues navigation while the container is not ready and fires it on handleNavigationReady', async () => {
    const nav = createNavigationRef(false);

    const { result } = renderHook(() => useInviteLinkHandler(nav.ref, signedInSession));

    await act(async () => {
      getUrlListener()({ url: INVITE_URL });
    });

    await waitFor(() => expect(mockedStore).toHaveBeenCalledWith('signed-code-123'));
    expect(nav.navigate).not.toHaveBeenCalled();

    nav.setReady(true);
    act(() => {
      result.current.handleNavigationReady();
    });

    expect(nav.navigate).toHaveBeenCalledWith('Main', {
      screen: 'Friends',
      params: { screen: 'FriendsHome' },
    });
  });

  it('ignores non-invite URLs', async () => {
    const nav = createNavigationRef(true);

    renderHook(() => useInviteLinkHandler(nav.ref, signedInSession));

    await act(async () => {
      getUrlListener()({ url: 'https://atlasi.app/u/alex' });
      getUrlListener()({ url: 'atlasi://share?url=https%3A%2F%2Fexample.com' });
    });

    expect(mockedStore).not.toHaveBeenCalled();
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('ignores invite URLs without a code', async () => {
    const nav = createNavigationRef(true);

    renderHook(() => useInviteLinkHandler(nav.ref, signedInSession));

    await act(async () => {
      getUrlListener()({ url: 'https://atlasi.app/invite' });
    });

    expect(mockedStore).not.toHaveBeenCalled();
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('handles a cold-start invite link from Linking.getInitialURL', async () => {
    (mockedLinking.getInitialURL as jest.Mock).mockResolvedValue(INVITE_URL);
    const nav = createNavigationRef(true);

    renderHook(() => useInviteLinkHandler(nav.ref, signedInSession));

    await waitFor(() => expect(mockedStore).toHaveBeenCalledWith('signed-code-123'));
    expect(nav.navigate).toHaveBeenCalledWith('Main', {
      screen: 'Friends',
      params: { screen: 'FriendsHome' },
    });
  });
});
