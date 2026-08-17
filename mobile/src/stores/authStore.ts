import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

export interface AuthState {
  session: Session | null;
  hasCompletedOnboarding: boolean;
  isLoading: boolean;
  isMigrating: boolean;
  needsPostSignupFlow: boolean;

  // Actions
  setSession: (session: Session | null) => void;
  setHasCompletedOnboarding: (completed: boolean) => void;
  setIsLoading: (loading: boolean) => void;
  setIsMigrating: (migrating: boolean) => void;
  setNeedsPostSignupFlow: (needs: boolean) => void;
  signOut: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  hasCompletedOnboarding: false,
  isLoading: true,
  isMigrating: false,
  needsPostSignupFlow: false,

  setSession: (session) => set({ session }),
  setHasCompletedOnboarding: (completed) => set({ hasCompletedOnboarding: completed }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setIsMigrating: (migrating) => set({ isMigrating: migrating }),
  setNeedsPostSignupFlow: (needs) => set({ needsPostSignupFlow: needs }),
  signOut: () =>
    set({
      session: null,
      hasCompletedOnboarding: false,
      isMigrating: false,
      needsPostSignupFlow: false,
    }),
}));

// Selectors - use these to prevent re-renders when unrelated state changes
// Note: Currently unused but kept for future optimization. Usage example:
// const session = useAuthStore(selectSession);
export const selectSession = (state: AuthState) => state.session;
export const selectHasCompletedOnboarding = (state: AuthState) => state.hasCompletedOnboarding;
export const selectIsLoading = (state: AuthState) => state.isLoading;
export const selectIsMigrating = (state: AuthState) => state.isMigrating;
