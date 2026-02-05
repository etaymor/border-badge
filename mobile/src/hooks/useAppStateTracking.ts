import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { Session } from '@supabase/supabase-js';

import { Analytics } from '@services/analytics';
import {
  syncOfflineQueueFromExtension,
  syncShareExtensionUsageFromAppGroup,
} from '@services/shareExtensionBridge';
import { syncAnalyticsFromExtension } from '@services/shareExtensionAnalytics';
import { performBackgroundPhotoSync } from '@services/photoImport';

function generateSessionId(): string {
  return Crypto.randomUUID();
}

/**
 * Tracks app foreground/background state changes.
 * On foreground: syncs offline queue, analytics, share extension usage,
 * tracks app_opened events, runs background photo sync, and checks
 * for shared URLs from the share extension.
 */
export function useAppStateTracking(
  session: Session | null,
  checkAppGroupForSharedURL: () => Promise<void>,
  homeCountry: string | null
): void {
  const appStateRef = useRef(AppState.currentState);
  const sessionIdRef = useRef(generateSessionId());
  const hasTrackedInitialOpenRef = useRef(false);
  const prevUserIdRef = useRef(session?.user?.id);

  const userId = session?.user?.id;

  // Reset tracking when user identity changes (sign-out or account switch)
  if (prevUserIdRef.current !== userId) {
    if (prevUserIdRef.current) {
      hasTrackedInitialOpenRef.current = false;
      sessionIdRef.current = generateSessionId();
    }
    prevUserIdRef.current = userId;
  }

  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      // When app comes to foreground
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        // Sync offline queue from Share Extension (runs regardless of auth state)
        syncOfflineQueueFromExtension().catch((error) => {
          console.error('Failed to sync offline queue from extension:', error);
        });

        // Sync analytics events queued by Share Extension
        syncAnalyticsFromExtension().catch((error) => {
          console.error('Failed to sync analytics from extension:', error);
        });

        // Check if user has used share extension (for tutorial dismissal)
        syncShareExtensionUsageFromAppGroup().catch((error) => {
          console.error('Failed to sync share extension usage:', error);
        });

        // Track analytics and check for immediate shares (only if authenticated)
        if (userId) {
          // Generate new session ID for this foreground event
          sessionIdRef.current = generateSessionId();
          Analytics.appOpened(sessionIdRef.current);

          // Check for URLs shared via Share Extension while app was in background
          void checkAppGroupForSharedURL();

          // Background photo sync - silently cache new photos for faster photo import
          performBackgroundPhotoSync(homeCountry).catch(() => {
            // Errors already handled internally
          });
        }
      }
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    // Track initial app open if authenticated (only once per user session)
    if (userId && !hasTrackedInitialOpenRef.current) {
      hasTrackedInitialOpenRef.current = true;
      Analytics.appOpened(sessionIdRef.current);
    }

    return () => {
      subscription.remove();
    };
  }, [userId, checkAppGroupForSharedURL, homeCountry]);
}
