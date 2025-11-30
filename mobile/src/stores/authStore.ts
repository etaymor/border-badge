import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

interface AuthState {
  session: Session | null;
  isGuest: boolean;
  hasCompletedOnboarding: boolean;
  isLoading: boolean;

  // Actions
  setSession: (session: Session | null) => void;
  setIsGuest: (isGuest: boolean) => void;
  setHasCompletedOnboarding: (completed: boolean) => void;
  setIsLoading: (loading: boolean) => void;
  signOut: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  isGuest: false,
  hasCompletedOnboarding: false,
  isLoading: true,

  setSession: (session) => set({ session }),
  setIsGuest: (isGuest) => set({ isGuest }),
  setHasCompletedOnboarding: (completed) => set({ hasCompletedOnboarding: completed }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  signOut: () => set({ session: null, isGuest: false, hasCompletedOnboarding: false }),
}));
