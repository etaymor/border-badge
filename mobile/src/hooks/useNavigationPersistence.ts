import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NavigationState } from '@react-navigation/native';
import type { Session } from '@supabase/supabase-js';

import {
  NAVIGATION_STATE_VERSION,
  sanitizeNavigationState,
  validatePersistedState,
  type PersistedNavigationState,
} from '@utils/navigationPersistence';

const NAVIGATION_STATE_KEY = 'navigation-state';

// Trailing debounce window for navigation-state writes. Rapid navigation
// (e.g. tab switches, quick push/pop) previously wrote to AsyncStorage on every
// single state change; we coalesce those into one write ~1s after the last
// change. The read/restore path stays immediate.
const NAVIGATION_STATE_WRITE_DEBOUNCE_MS = 1000;

/**
 * Manages navigation state persistence (save/restore/clear).
 * Only restores state for authenticated users to prevent navigating to
 * auth-required screens before auth is ready.
 */
export function useNavigationPersistence(session: Session | null) {
  const [isNavigationReady, setIsNavigationReady] = useState(false);
  const [initialNavigationState, setInitialNavigationState] = useState<
    NavigationState | undefined
  >();

  const isAuthenticated = !!session;

  // Debounced write bookkeeping: a pending timer plus the last serialized
  // payload so the trailing write persists the most recent navigation state.
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWriteRef = useRef<string | null>(null);

  const flushNavigationWrite = useCallback(() => {
    if (writeTimerRef.current) {
      clearTimeout(writeTimerRef.current);
      writeTimerRef.current = null;
    }
    const payload = pendingWriteRef.current;
    if (payload == null) return;
    pendingWriteRef.current = null;
    AsyncStorage.setItem(NAVIGATION_STATE_KEY, payload).catch((error) => {
      console.warn('Failed to save navigation state:', error);
    });
  }, []);

  // Flush any pending write on unmount so the final state is not lost.
  useEffect(() => {
    return () => {
      flushNavigationWrite();
    };
  }, [flushNavigationWrite]);

  // Restore navigation state on app launch (only for authenticated users)
  useEffect(() => {
    let cancelled = false;

    const restoreNavigationState = async () => {
      try {
        if (!isAuthenticated) {
          setIsNavigationReady(true);
          return;
        }

        const savedData = await AsyncStorage.getItem(NAVIGATION_STATE_KEY);
        if (cancelled) return;

        if (savedData) {
          const persisted = JSON.parse(savedData) as PersistedNavigationState;
          const validState = validatePersistedState(persisted);

          if (validState) {
            setInitialNavigationState(validState);
          } else {
            await AsyncStorage.removeItem(NAVIGATION_STATE_KEY);
          }
        }
      } catch (error) {
        console.warn('Failed to restore navigation state:', error);
        // Clean up corrupted state before marking ready
        try {
          await AsyncStorage.removeItem(NAVIGATION_STATE_KEY);
        } catch {
          // Ignore cleanup errors
        }
      } finally {
        if (!cancelled) {
          setIsNavigationReady(true);
        }
      }
    };

    restoreNavigationState();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  // Clear navigation state when user signs out
  useEffect(() => {
    if (!isAuthenticated) {
      // Drop any pending debounced write so we don't resurrect stale state.
      if (writeTimerRef.current) {
        clearTimeout(writeTimerRef.current);
        writeTimerRef.current = null;
      }
      pendingWriteRef.current = null;

      setInitialNavigationState(undefined);
      AsyncStorage.removeItem(NAVIGATION_STATE_KEY).catch((error) => {
        console.warn('Failed to clear navigation state:', error);
      });
    }
  }, [isAuthenticated]);

  // Save navigation state when it changes (debounced ~1s trailing).
  const handleNavigationStateChange = useCallback(
    (state: NavigationState | undefined) => {
      if (state && session) {
        // Sanitize state to remove sensitive params before persisting.
        const sanitizedState = sanitizeNavigationState(state);
        const persistedState: PersistedNavigationState = {
          state: sanitizedState,
          timestamp: Date.now(),
          version: NAVIGATION_STATE_VERSION,
        };
        // Stash the latest payload and (re)arm the trailing timer. Rapid
        // navigation coalesces into a single AsyncStorage write.
        pendingWriteRef.current = JSON.stringify(persistedState);
        if (writeTimerRef.current) {
          clearTimeout(writeTimerRef.current);
        }
        writeTimerRef.current = setTimeout(() => {
          writeTimerRef.current = null;
          const payload = pendingWriteRef.current;
          if (payload == null) return;
          pendingWriteRef.current = null;
          AsyncStorage.setItem(NAVIGATION_STATE_KEY, payload).catch((error) => {
            console.warn('Failed to save navigation state:', error);
          });
        }, NAVIGATION_STATE_WRITE_DEBOUNCE_MS);
      }
    },
    [session]
  );

  return {
    isNavigationReady,
    initialNavigationState,
    handleNavigationStateChange,
    flushNavigationWrite,
  };
}
