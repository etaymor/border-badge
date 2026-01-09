import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { useMutation } from '@tanstack/react-query';
import { Alert, Platform } from 'react-native';

import { storeOnboardingComplete } from '@services/api';
import { migrateGuestData } from '@services/guestMigration';
import { supabase } from '@services/supabase';
import { useAuthStore } from '@stores/authStore';
import { getAuthErrorMessage, getSafeLogMessage } from '@utils/authErrors';
import { hasUserOnboarded } from '@utils/authHelpers';

interface AppleSignInParams {
  displayName?: string;
}

type AppleSignInVariables = AppleSignInParams | void;

/**
 * Hook to sign in with Apple.
 * Uses expo-apple-authentication to get an identity token,
 * then authenticates with Supabase using signInWithIdToken.
 */
export function useAppleSignIn() {
  const { setSession, setHasCompletedOnboarding, setIsMigrating } = useAuthStore();

  return useMutation<
    Awaited<ReturnType<typeof supabase.auth.signInWithIdToken>>['data'],
    Error,
    AppleSignInVariables
  >({
    mutationFn: async (params) => {
      if (Platform.OS !== 'ios') {
        throw new Error('Apple Sign In is only available on iOS');
      }

      // Generate nonce for security (prevents replay attacks)
      const rawNonce = Crypto.randomUUID();
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce
      );

      // Request Apple Sign In
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });

      if (!credential.identityToken) {
        throw new Error('No identity token received from Apple');
      }

      // Sign in with Supabase using the Apple ID token
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
        nonce: rawNonce,
      });

      if (error) throw error;

      // Validate refresh token - OAuth providers should always provide one
      // Without it, session refresh will fail and user will be logged out unexpectedly
      if (!data.session?.refresh_token) {
        throw new Error('No refresh token received - session cannot be refreshed');
      }

      // Determine display name to use:
      // 1. Use the name from onboarding if provided (user explicitly entered it)
      // 2. Fall back to Apple's provided name (only available on first sign-in)
      let nameToUse = params?.displayName;

      if (!nameToUse && credential.fullName?.givenName) {
        nameToUse = [credential.fullName.givenName, credential.fullName.familyName]
          .filter(Boolean)
          .join(' ');
      }

      if (nameToUse) {
        const { error: updateError } = await supabase.rpc('update_display_name', {
          new_display_name: nameToUse,
        });
        if (updateError) {
          // Non-critical failure - user can update name later in settings
          console.warn('Failed to update display name from Apple Sign-In:', updateError.message);
        }
      }

      return data;
    },
    onSuccess: async (data) => {
      // Session is set via supabase.auth.signInWithIdToken() in mutationFn, which triggers
      // onAuthStateChange in App.tsx. That listener handles:
      // - Updating Zustand session state
      // - Storing tokens to SecureStore
      // - Identifying user in analytics
      //
      // We only handle onboarding-specific logic here for consistency with Google auth
      // and to avoid any potential race conditions with duplicate setSession() calls.
      if (data.session) {
        // Check if returning user using shared helper
        const onboarded = await hasUserOnboarded(data.session.user.id);

        if (onboarded) {
          setHasCompletedOnboarding(true);
          await storeOnboardingComplete();
          setSession(data.session);
        } else {
          // New user - set isMigrating before session to prevent empty state
          setIsMigrating(true);
          setSession(data.session);

          // Migrate in background
          migrateGuestData(data.session)
            .catch(() => console.warn('Migration failed for Apple user'))
            .finally(() => setIsMigrating(false));
        }
      }
    },
    onError: (error) => {
      // Log sanitized error for debugging
      console.error('Apple Sign-In failed:', getSafeLogMessage(error));

      // Get user-friendly message (null means silent - user cancelled)
      const message = getAuthErrorMessage(error);
      if (message) {
        Alert.alert('Sign In Failed', message);
      }
    },
  });
}

/**
 * Returns true if Apple Sign In is available on this device.
 * Apple Sign In is only available on iOS 13+.
 */
export function useAppleAuthAvailable(): boolean {
  return Platform.OS === 'ios';
}
