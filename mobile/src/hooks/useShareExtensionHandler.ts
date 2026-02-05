import { useCallback, useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import type { Session } from '@supabase/supabase-js';

import type { ShareCaptureSource } from '@navigation/types';
import {
  isShareExtensionDeepLink,
  parseDeepLinkParams,
  savePendingShare,
  getPendingShare,
  clearPendingShare,
  getSharedURLFromAppGroup,
  wasRecentlyProcessed,
  isCurrentlyProcessing,
  markAsProcessing,
} from '@services/shareExtensionBridge';

type ShareCaptureNavigationParams = {
  url: string;
  caption?: string;
  source: ShareCaptureSource;
};

/**
 * Handles share extension deep links, App Group shared URLs, and pending shares.
 *
 * Returns `handleNavigationReady` for NavigationContainer's `onReady` prop,
 * and `checkAppGroupForSharedURL` for use in app foreground handling.
 */
export function useShareExtensionHandler(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  navigationRef: NavigationContainerRefWithCurrent<any>,
  session: Session | null
) {
  const pendingAuthedShareRef = useRef<ShareCaptureNavigationParams | null>(null);
  const shouldClearPendingShareRef = useRef(false);
  const hasProcessedInitialDeepLinkRef = useRef(false);

  const userId = session?.user?.id;

  // Attempt to navigate to ShareCapture; queues the share if navigation isn't ready yet.
  const tryNavigateToShareCapture = useCallback(
    (params: ShareCaptureNavigationParams): 'navigated' | 'queued' | 'unauthenticated' => {
      if (!userId) {
        return 'unauthenticated';
      }

      if (!navigationRef.isReady()) {
        pendingAuthedShareRef.current = params;
        return 'queued';
      }

      navigationRef.navigate('Main', {
        screen: 'ShareCapture',
        params,
      });
      pendingAuthedShareRef.current = null;
      return 'navigated';
    },
    [userId, navigationRef]
  );

  const flushPendingAuthedShare = useCallback(() => {
    if (!pendingAuthedShareRef.current) return;

    const result = tryNavigateToShareCapture(pendingAuthedShareRef.current);
    if (result === 'navigated' && shouldClearPendingShareRef.current) {
      shouldClearPendingShareRef.current = false;
      void clearPendingShare();
    }
  }, [tryNavigateToShareCapture]);

  const processPendingShare = useCallback(async () => {
    if (!userId) return;

    const pendingShare = await getPendingShare();
    if (pendingShare) {
      const result = tryNavigateToShareCapture({
        url: pendingShare.url,
        source: 'share_extension',
      });

      if (result === 'navigated') {
        await clearPendingShare();
      } else if (result === 'queued') {
        shouldClearPendingShareRef.current = true;
      }
    }
  }, [userId, tryNavigateToShareCapture]);

  // Check for shared URLs in App Group (from Share Extension)
  const checkAppGroupForSharedURL = useCallback(async () => {
    if (!userId) return;

    const sharedURL = await getSharedURLFromAppGroup();
    if (sharedURL) {
      // Skip if this URL is already being processed (prevents race condition when
      // multiple events trigger simultaneously, e.g., app foreground + navigation ready)
      if (isCurrentlyProcessing(sharedURL)) {
        return;
      }

      // Skip if this URL was recently processed (prevents duplicate handling on app restart)
      const recentlyProcessed = await wasRecentlyProcessed(sharedURL);
      if (recentlyProcessed) {
        return;
      }

      // Mark as processing BEFORE navigation to prevent race conditions
      markAsProcessing(sharedURL);

      // Navigate to ShareCapture - App Group will be cleared after successful save
      // in ShareCaptureScreen via completeAppGroupShare() to prevent data loss
      // if the app crashes before processing completes
      tryNavigateToShareCapture({
        url: sharedURL,
        source: 'share_extension',
      });
    }
  }, [userId, tryNavigateToShareCapture]);

  const handleNavigationReady = useCallback(() => {
    flushPendingAuthedShare();
    void processPendingShare();
    void checkAppGroupForSharedURL();
  }, [flushPendingAuthedShare, processPendingShare, checkAppGroupForSharedURL]);

  // If user signs out before we could navigate, persist the queued share for later.
  useEffect(() => {
    if (userId) {
      flushPendingAuthedShare();
      return;
    }

    if (pendingAuthedShareRef.current) {
      const urlToPersist = pendingAuthedShareRef.current.url;
      pendingAuthedShareRef.current = null;
      shouldClearPendingShareRef.current = false;
      void savePendingShare(urlToPersist);
    } else {
      shouldClearPendingShareRef.current = false;
    }
  }, [flushPendingAuthedShare, userId]);

  // Handle deep links: share extension only
  // Note: Auth callbacks (atlasi://auth-callback) are handled directly by
  // WebBrowser.openAuthSessionAsync() in OAuth hooks (useGoogleAuth, useAppleAuth).
  // We do NOT process them here to avoid race conditions with double session setting.
  useEffect(() => {
    const handleShareDeepLink = async (deepLinkUrl: string) => {
      // Only process share extension deep links
      if (!isShareExtensionDeepLink(deepLinkUrl)) return;

      // Extract the shared URL from the deep link query parameter
      const params = parseDeepLinkParams(deepLinkUrl);
      const sharedUrl = params.url;

      if (sharedUrl) {
        const result = tryNavigateToShareCapture({
          url: sharedUrl,
          source: 'share_extension',
        });

        if (result === 'unauthenticated') {
          // User not authenticated - save for later
          await savePendingShare(sharedUrl);
        }
      }
    };

    // Subscribe to deep link events
    const subscription = Linking.addEventListener('url', ({ url }) => {
      void handleShareDeepLink(url);
    });

    // Check for initial URL (app opened via share extension deep link)
    // This handles cold start scenarios where the app is opened via share
    if (!hasProcessedInitialDeepLinkRef.current) {
      Linking.getInitialURL()
        .then((url) => {
          // Set ref after getting URL to prevent race condition
          hasProcessedInitialDeepLinkRef.current = true;
          if (url) {
            void handleShareDeepLink(url);
          }
        })
        .catch((error) => {
          hasProcessedInitialDeepLinkRef.current = true;
          console.error('Failed to get initial deep link URL:', error);
        });
    }

    return () => {
      subscription.remove();
    };
  }, [tryNavigateToShareCapture]);

  return { handleNavigationReady, checkAppGroupForSharedURL };
}
