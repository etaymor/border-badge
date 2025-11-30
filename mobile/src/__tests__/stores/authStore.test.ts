import type { Session } from '@supabase/supabase-js';

import { useAuthStore } from '@stores/authStore';

// Helper to create a mock Supabase session
function createMockSession(overrides: Partial<Session> = {}): Session {
  return {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: {
      id: 'user-123',
      email: 'test@example.com',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    },
    ...overrides,
  };
}

describe('authStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useAuthStore.setState({
      session: null,
      isGuest: false,
      hasCompletedOnboarding: false,
      isLoading: true,
    });
  });

  it('starts with initial state', () => {
    const state = useAuthStore.getState();

    expect(state.session).toBeNull();
    expect(state.isGuest).toBe(false);
    expect(state.hasCompletedOnboarding).toBe(false);
    expect(state.isLoading).toBe(true);
  });

  it('sets session', () => {
    const mockSession = createMockSession();

    useAuthStore.getState().setSession(mockSession);

    expect(useAuthStore.getState().session).toEqual(mockSession);
  });

  it('sets isGuest', () => {
    useAuthStore.getState().setIsGuest(true);

    expect(useAuthStore.getState().isGuest).toBe(true);
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
      session: createMockSession(),
      isGuest: false,
      hasCompletedOnboarding: true,
      isLoading: false,
    });

    // Sign out
    useAuthStore.getState().signOut();

    // Verify state is cleared
    const state = useAuthStore.getState();
    expect(state.session).toBeNull();
    expect(state.isGuest).toBe(false);
    expect(state.hasCompletedOnboarding).toBe(false);
  });

  it('clears guest mode on sign out', () => {
    // Set up guest state
    useAuthStore.setState({
      session: null,
      isGuest: true,
      hasCompletedOnboarding: true,
      isLoading: false,
    });

    // Sign out
    useAuthStore.getState().signOut();

    // Verify guest state is cleared
    expect(useAuthStore.getState().isGuest).toBe(false);
    expect(useAuthStore.getState().hasCompletedOnboarding).toBe(false);
  });
});
