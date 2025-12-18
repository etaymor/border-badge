import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

interface AuthState {
  session: Session | null;
  hasCompletedOnboarding: boolean;
  isLoading: boolean;
  isMigrating: boolean;

  // Actions
  setSession: (session: Session | null) => void;
  setHasCompletedOnboarding: (completed: boolean) => void;
  setIsLoading: (loading: boolean) => void;
  setIsMigrating: (migrating: boolean) => void;
  signOut: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  hasCompletedOnboarding: false,
  isLoading: true,
  isMigrating: false,

  setSession: (session) => set({ session }),
  setHasCompletedOnboarding: (completed) => set({ hasCompletedOnboarding: completed }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setIsMigrating: (migrating) => set({ isMigrating: migrating }),
  signOut: () => set({ session: null, hasCompletedOnboarding: false, isMigrating: false }),
}));

// Selectors - use these to prevent re-renders when unrelated state changes
export const selectSession = (state: AuthState) => state.session;
export const selectHasCompletedOnboarding = (state: AuthState) => state.hasCompletedOnboarding;
export const selectIsLoading = (state: AuthState) => state.isLoading;
export const selectIsMigrating = (state: AuthState) => state.isMigrating;
