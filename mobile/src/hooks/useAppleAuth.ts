import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { useMutation } from '@tanstack/react-query';
import { Alert, Platform } from 'react-native';

import { clearTokens, storeOnboardingComplete, storeTokens } from '@services/api';
import { migrateGuestData } from '@services/guestMigration';
import { registerForPushNotifications } from '@services/pushNotifications';
import { supabase } from '@services/supabase';
import { useAuthStore } from '@stores/authStore';
import { getAuthErrorMessage, getSafeLogMessage } from '@utils/authErrors';
import { hasUserOnboarded } from '@utils/authHelpers';

/**
 * Hook to sign in with Apple.
 * Uses expo-apple-authentication to get an identity token,
 * then authenticates with Supabase using signInWithIdToken.
 */
export function useAppleSignIn() {
  const { setSession, setHasCompletedOnboarding } = useAuthStore();

  return useMutation({
    mutationFn: async () => {
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

      // Update display name if Apple provided it (only on first sign-in)
      // Apple only provides name on the very first sign-in attempt
      if (credential.fullName?.givenName) {
        const displayName = [credential.fullName.givenName, credential.fullName.familyName]
          .filter(Boolean)
          .join(' ');

        if (displayName) {
          try {
            await supabase.rpc('update_display_name', {
              new_display_name: displayName,
            });
          } catch (error) {
            // Non-critical failure - user can update name later in settings
            console.warn('Failed to update display name from Apple Sign-In:', error);
          }
        }
      }

      return data;
    },
    onSuccess: async (data) => {
      if (data.session) {
        await clearTokens();
        await storeTokens(data.session.access_token, data.session.refresh_token ?? '');

        // Check if returning user using shared helper
        const onboarded = await hasUserOnboarded(data.session.user.id);

        if (onboarded) {
          setHasCompletedOnboarding(true);
          await storeOnboardingComplete();
        } else {
          // New user - attempt migration
          try {
            await migrateGuestData(data.session);
          } catch {
            console.warn('Migration failed for Apple user');
          }
        }

        // Register for push notifications
        // Non-blocking - don't await to avoid delaying auth flow
        registerForPushNotifications().catch((err) =>
          console.warn('Push notification registration failed:', err)
        );

        setSession(data.session);
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
