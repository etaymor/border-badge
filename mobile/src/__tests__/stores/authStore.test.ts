import { useAuthStore } from '@stores/authStore';

describe('authStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useAuthStore.setState({
      session: null,
      hasCompletedOnboarding: false,
      isLoading: true,
    });
  });

  it('starts with initial state', () => {
    const state = useAuthStore.getState();

    expect(state.session).toBeNull();
    expect(state.hasCompletedOnboarding).toBe(false);
    expect(state.isLoading).toBe(true);
  });

  it('sets session', () => {
    const mockSession = {
      accessToken: 'test-token',
      refreshToken: 'test-refresh',
      expiresAt: Date.now() + 3600000,
      user: {
        id: 'user-123',
        email: 'test@example.com',
      },
    };

    useAuthStore.getState().setSession(mockSession);

    expect(useAuthStore.getState().session).toEqual(mockSession);
  });

  it('sets hasCompletedOnboarding', () => {
    useAuthStore.getState().setHasCompletedOnboarding(true);

    expect(useAuthStore.getState().hasCompletedOnboarding).toBe(true);
  });

  it('sets isLoading', () => {
    useAuthStore.getState().setIsLoading(false);

    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it('signs out and clears state', () => {
    // Set up logged in state
    useAuthStore.setState({
      session: {
        accessToken: 'test-token',
        refreshToken: 'test-refresh',
        expiresAt: Date.now() + 3600000,
        user: { id: 'user-123', email: 'test@example.com' },
      },
      hasCompletedOnboarding: true,
      isLoading: false,
    });

    // Sign out
    useAuthStore.getState().signOut();

    // Verify state is cleared
    const state = useAuthStore.getState();
    expect(state.session).toBeNull();
    expect(state.hasCompletedOnboarding).toBe(false);
  });
});
