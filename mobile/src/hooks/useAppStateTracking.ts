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
import {
  detectStuckScan,
  performBackgroundPhotoSync,
  resetForUserChange,
  tryResumeScan,
} from '@services/photoImport';
import { suggestionDispatch } from '@services/photoImport/suggestionDispatch';

function generateSessionId(): string {
  return Crypto.randomUUID();
}

/**
 * Spread a burst of jobs across successive animation frames so a foreground
 * resume doesn't run 6+ jobs on a single frame (which spikes the UI thread the
 * moment the user returns to the app). WHAT runs is unchanged — only WHEN: each
 * job runs on its own frame, in order. Returns a canceller so an unmount /
 * re-run mid-burst drops any not-yet-run jobs.
 */
function scheduleStaggered(jobs: Array<() => void>): () => void {
  let index = 0;
  let rafHandle: number | null = null;
  let cancelled = false;

  const runNext = () => {
    if (cancelled) return;
    if (index >= jobs.length) {
      rafHandle = null;
      return;
    }
    const job = jobs[index];
    index += 1;
    job();
    rafHandle = requestAnimationFrame(runNext);
  };

  rafHandle = requestAnimationFrame(runNext);

  return () => {
    cancelled = true;
    if (rafHandle != null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
  };
}

/**
 * Tracks app foreground/background state changes.
 * On foreground: resumes a paused photo-import dispatch, syncs offline queue,
 * analytics, share extension usage, tracks app_opened events, runs background
 * photo sync, and checks for shared URLs from the share extension.
 * On background: pauses photo-import suggestion dispatch (U9/KTD19) — this is
 * the ONE lifecycle subscriber, so resume shares the frame stagger below instead
 * of a screen-local listener firing a burst in a single frame and dying on
 * navigation.
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
  useEffect(() => {
    if (prevUserIdRef.current !== userId) {
      if (prevUserIdRef.current) {
        hasTrackedInitialOpenRef.current = false;
        sessionIdRef.current = generateSessionId();

        // Sign-out or account switch: clear ALL scan state — abort any in-flight
        // scan, drop the heavyweight result ref, clear durable metadata, and
        // reset the store. Stronger than cancelScan() so user A's photo data
        // cannot leak into user B's session via consumeResult().
        void resetForUserChange();
      }
      prevUserIdRef.current = userId;
    }
  }, [userId]);

  // Canceller for the most recent staggered foreground burst, so an unmount or
  // a re-run mid-burst drops any not-yet-executed jobs.
  const cancelStaggerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      // When app comes to foreground
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        // Cancel any prior in-flight burst before starting a new one.
        cancelStaggerRef.current?.();

        // Build the foreground job list. WHAT runs is unchanged from before —
        // these jobs are only spread across successive frames (see
        // scheduleStaggered) so resume doesn't spike a single frame.
        const jobs: Array<() => void> = [
          // U9/R15/KTD19: let a backgrounded photo-import dispatch start handing
          // out batches again. FIRST in the burst because it is the only job the
          // user is actually waiting on, and it is a flag flip — the batches
          // themselves still go out through the bounded pool, so at most
          // `concurrency` requests leave on this frame and the rest follow as
          // those settle. A no-op when nothing was paused.
          () => {
            suggestionDispatch.resume();
          },
          // Sync offline queue from Share Extension (runs regardless of auth state)
          () => {
            syncOfflineQueueFromExtension().catch((error) => {
              console.error('Failed to sync offline queue from extension:', error);
            });
          },
          // Sync analytics events queued by Share Extension
          () => {
            syncAnalyticsFromExtension().catch((error) => {
              console.error('Failed to sync analytics from extension:', error);
            });
          },
          // Check if user has used share extension (for tutorial dismissal)
          () => {
            syncShareExtensionUsageFromAppGroup().catch((error) => {
              console.error('Failed to sync share extension usage:', error);
            });
          },
        ];

        // Track analytics and check for immediate shares (only if authenticated)
        if (userId) {
          jobs.push(
            // Generate new session ID for this foreground event, then track open.
            () => {
              sessionIdRef.current = generateSessionId();
              Analytics.appOpened(sessionIdRef.current);
            },
            // Check for URLs shared via Share Extension while app was in background
            () => {
              void checkAppGroupForSharedURL();
            },
            // First, check whether a prior scan was suspended mid-run.
            // tryResumeScan runs the seven-gate check, transitions the store to
            // `failed` when a gate trips, and otherwise calls
            // photoScanService.start({ resumed: true }). If a scan is currently
            // running, also surface a stuck-detection check.
            () => {
              tryResumeScan().catch((err) => {
                if (__DEV__) console.warn('[AppStateTracking] tryResumeScan failed:', err);
              });
              detectStuckScan();
            },
            // Background photo sync - silently cache new photos for faster photo
            // import. No-ops when the scan service is running (early-return inside).
            () => {
              performBackgroundPhotoSync(homeCountry).catch(() => {
                // Errors already handled internally
              });
            }
          );
        }

        cancelStaggerRef.current = scheduleStaggered(jobs);
      }

      // Going away: stop spending suggestion requests (U9/R15/KTD19). This is a
      // pause, NOT `reset()` — batches already on the wire keep running and
      // their results still cache, so a request that was seconds from landing
      // isn't thrown away. Only a true `background`: iOS reports `inactive` for
      // transient overlays (control centre, the app switcher, a system prompt),
      // and pausing on those would stall an import the user is still watching.
      if (nextAppState === 'background') {
        suggestionDispatch.pause();
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
      cancelStaggerRef.current?.();
      cancelStaggerRef.current = null;
    };
  }, [userId, checkAppGroupForSharedURL, homeCountry]);
}
