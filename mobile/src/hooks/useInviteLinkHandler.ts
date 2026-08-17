import { useCallback, useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import type { Session } from '@supabase/supabase-js';

import { features } from '@config/features';
import { storePendingInviteCode } from '@hooks/useInvites';
import { getInviteCodeFromUrl, isInviteUrl } from '@navigation/linking';
import type { RootStackParamList } from '@navigation/types';

/**
 * Manual handler for invite deep links (/invite?code=...).
 *
 * These URLs are excluded from React Navigation's linking config (see the
 * filter in @navigation/linking) so this hook has exclusive ownership:
 * - Always: persist the code (storePendingInviteCode) so it survives signup
 *   and is redeemed once a session exists (usePendingInviteRedemption).
 * - Signed-in: route to the Friends home surface, where the follow-back
 *   prompt renders after redemption.
 *
 * Returns `handleNavigationReady` for NavigationContainer's `onReady` so a
 * cold-start invite link can navigate once the container is ready.
 */
export function useInviteLinkHandler(
  navigationRef: NavigationContainerRefWithCurrent<RootStackParamList>,
  session: Session | null
) {
  const pendingNavigationRef = useRef(false);
  const hasProcessedInitialUrlRef = useRef(false);

  const userId = session?.user?.id;

  const navigateToFriendsHome = useCallback(() => {
    if (!features.enableSocial) {
      return;
    }
    if (!navigationRef.isReady()) {
      pendingNavigationRef.current = true;
      return;
    }
    pendingNavigationRef.current = false;
    navigationRef.navigate('Main', {
      screen: 'Friends',
      params: { screen: 'FriendsHome' },
    });
  }, [navigationRef]);

  const handleInviteUrl = useCallback(
    async (url: string) => {
      const code = getInviteCodeFromUrl(url);
      if (!code) {
        return;
      }
      await storePendingInviteCode(code);
      if (userId) {
        navigateToFriendsHome();
      }
      // No session: the code stays stored and is redeemed after signup.
    },
    [userId, navigateToFriendsHome]
  );

  const handleNavigationReady = useCallback(() => {
    if (pendingNavigationRef.current && userId) {
      navigateToFriendsHome();
    }
  }, [navigateToFriendsHome, userId]);

  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      if (isInviteUrl(url)) {
        void handleInviteUrl(url);
      }
    });

    // Cold start: the app may have been opened via an invite universal link.
    if (!hasProcessedInitialUrlRef.current) {
      Linking.getInitialURL()
        .then((url) => {
          hasProcessedInitialUrlRef.current = true;
          if (url && isInviteUrl(url)) {
            void handleInviteUrl(url);
          }
        })
        .catch((error) => {
          hasProcessedInitialUrlRef.current = true;
          console.warn('Failed to get initial invite URL:', error);
        });
    }

    return () => {
      subscription.remove();
    };
  }, [handleInviteUrl]);

  return { handleNavigationReady };
}
