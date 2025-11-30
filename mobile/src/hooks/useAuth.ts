import { useMutation } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { clearTokens, storeTokens } from '@services/api';
import { supabase } from '@services/supabase';
import { useAuthStore } from '@stores/authStore';
import { useOnboardingStore } from '@stores/onboardingStore';

interface SignInInput {
  email: string;
  password: string;
}

interface SignUpInput {
  email: string;
  password: string;
}

export function useSignIn() {
  const { setSession } = useAuthStore();

  return useMutation({
    mutationFn: async ({ email, password }: SignInInput) => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (data) => {
      if (data.session) {
        setSession(data.session);
        await storeTokens(data.session.access_token, data.session.refresh_token ?? '');
      }
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to sign in';
      Alert.alert('Sign In Failed', message);
    },
  });
}

export function useSignUp() {
  const { setSession, isGuest, setIsGuest } = useAuthStore();
  // Note: resetOnboarding is used in useSignOut, not here since migration happens after onboarding

  return useMutation({
    mutationFn: async ({ email, password }: SignUpInput) => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (data) => {
      if (data.session) {
        setSession(data.session);
        await storeTokens(data.session.access_token, data.session.refresh_token ?? '');

        // If user was in guest mode, migration will happen after onboarding completes
        if (isGuest) {
          setIsGuest(false);
        }
      } else if (data.user && !data.session) {
        // Email confirmation required
        Alert.alert(
          'Check Your Email',
          'We sent you a confirmation link. Please check your email to complete sign up.'
        );
      }
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to create account';
      Alert.alert('Sign Up Failed', message);
    },
  });
}

export function useSignOut() {
  const { signOut } = useAuthStore();
  const { reset: resetOnboarding } = useOnboardingStore();

  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
    onSuccess: async () => {
      signOut();
      resetOnboarding();
      await clearTokens();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to sign out';
      Alert.alert('Sign Out Failed', message);
    },
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw error;
    },
    onSuccess: () => {
      Alert.alert(
        'Check Your Email',
        'If an account exists with that email, we sent you a password reset link.'
      );
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to send reset email';
      Alert.alert('Reset Failed', message);
    },
  });
}
