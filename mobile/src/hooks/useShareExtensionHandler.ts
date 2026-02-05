import { useCallback, useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import type { Session } from '@supabase/supabase-js';

import type { RootStackParamList, ShareCaptureSource } from '@navigation/types';
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
  clearProcessingStatus,
  scheduleProcessingTimeout,
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
  navigationRef: NavigationContainerRefWithCurrent<RootStackParamList>,
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
        screen: 'Passport',
        params: { screen: 'ShareCapture', params },
      });
      pendingAuthedShareRef.current = null;
      return 'navigated';
    },
    [userId, navigationRef]
  );

  const flushPendingAuthedShare = useCallback(() => {
    if (!pendingAuthedShareRef.current) return;

    const params = pendingAuthedShareRef.current;
    const result = tryNavigateToShareCapture(params);
    if (result === 'navigated') {
      // Schedule processing timeout for shares that were queued and are now navigating.
      // This ensures timeout protection even when arriving via the queued → flush path.
      if (params.source === 'share_extension') {
        scheduleProcessingTimeout(params.url);
      }
      if (shouldClearPendingShareRef.current) {
        shouldClearPendingShareRef.current = false;
        void clearPendingShare();
      }
    }
  }, [tryNavigateToShareCapture]);

  const processPendingShare = useCallback(async (): Promise<boolean> => {
    if (!userId) return false;

    const pendingShare = await getPendingShare();
    if (pendingShare) {
      const result = tryNavigateToShareCapture({
        url: pendingShare.url,
        source: 'share_extension',
      });

      if (result === 'navigated') {
        await clearPendingShare();
        return true;
      } else if (result === 'queued') {
        shouldClearPendingShareRef.current = true;
        return true;
      }
    }
    return false;
  }, [userId, tryNavigateToShareCapture]);

  // Check for shared URLs in App Group (from Share Extension)
  const checkAppGroupForSharedURL = useCallback(async () => {
    if (!userId) return;

    const sharedURL = await getSharedURLFromAppGroup();
    if (sharedURL) {
      // Skip if this URL is already being processed (prevents race condition when
      // multiple events trigger simultaneously, e.g., app foreground + navigation ready)
      // Also checks persisted state to survive app crashes
      if (await isCurrentlyProcessing(sharedURL)) {
        return;
      }

      // Skip if this URL was recently processed (prevents duplicate handling on app restart)
      const recentlyProcessed = await wasRecentlyProcessed(sharedURL);
      if (recentlyProcessed) {
        return;
      }

      // Mark as processing BEFORE navigation to prevent race conditions
      // Persisted to AsyncStorage to survive app crashes
      await markAsProcessing(sharedURL);

      // Navigate to ShareCapture - App Group will be cleared after successful save
      // in ShareCaptureScreen via completeAppGroupShare() to prevent data loss
      // if the app crashes before processing completes
      const result = tryNavigateToShareCapture({
        url: sharedURL,
        source: 'share_extension',
      });

      if (result === 'navigated') {
        // Schedule a safety timeout to auto-clear processing state if ShareCapture
        // never calls completeAppGroupShare (e.g., screen crashes or hangs)
        scheduleProcessingTimeout(sharedURL);
      } else if (result === 'queued') {
        // URL is queued in pendingAuthedShareRef — keep processing lock alive
        // so the URL isn't picked up again by a concurrent check. Schedule a
        // timeout in case the flush never happens (e.g., user signs out before
        // navigation becomes ready).
        scheduleProcessingTimeout(sharedURL);
      } else {
        // 'unauthenticated' — clear processing state so the URL can be
        // picked up after sign-in via the pending share mechanism
        void clearProcessingStatus(sharedURL);
      }
    }
  }, [userId, tryNavigateToShareCapture]);

  const handleNavigationReady = useCallback(() => {
    flushPendingAuthedShare();
    void (async () => {
      const handled = await processPendingShare();
      if (!handled) {
        await checkAppGroupForSharedURL();
      }
    })();
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
      pendingAuthedShareRef.current = null;
      shouldClearPendingShareRef.current = false;
    };
  }, [tryNavigateToShareCapture]);

  return { handleNavigationReady, checkAppGroupForSharedURL };
}
