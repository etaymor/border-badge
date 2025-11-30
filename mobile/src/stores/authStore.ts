import { create } from 'zustand';

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: {
    id: string;
    email: string;
  };
}

interface AuthState {
  session: Session | null;
  hasCompletedOnboarding: boolean;
  isLoading: boolean;

  // Actions
  setSession: (session: Session | null) => void;
  setHasCompletedOnboarding: (completed: boolean) => void;
  setIsLoading: (loading: boolean) => void;
  signOut: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  hasCompletedOnboarding: false,
  isLoading: true,

  setSession: (session) => set({ session }),
  setHasCompletedOnboarding: (completed) => set({ hasCompletedOnboarding: completed }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  signOut: () => set({ session: null, hasCompletedOnboarding: false }),
}));
