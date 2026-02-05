import { useCallback, useEffect, useState } from 'react';
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

  // Restore navigation state on app launch (only for authenticated users)
  useEffect(() => {
    const restoreNavigationState = async () => {
      try {
        if (!session) {
          setIsNavigationReady(true);
          return;
        }

        const savedData = await AsyncStorage.getItem(NAVIGATION_STATE_KEY);
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
        setIsNavigationReady(true);
      }
    };

    restoreNavigationState();
  }, [session]);

  // Clear navigation state when user signs out
  useEffect(() => {
    if (!session) {
      AsyncStorage.removeItem(NAVIGATION_STATE_KEY).catch((error) => {
        console.warn('Failed to clear navigation state:', error);
      });
    }
  }, [session]);

  // Save navigation state when it changes
  const handleNavigationStateChange = useCallback(
    (state: NavigationState | undefined) => {
      if (state && session) {
        // Sanitize state to remove sensitive params before persisting
        const sanitizedState = sanitizeNavigationState(state);
        const persistedState: PersistedNavigationState = {
          state: sanitizedState,
          timestamp: Date.now(),
          version: NAVIGATION_STATE_VERSION,
        };
        AsyncStorage.setItem(NAVIGATION_STATE_KEY, JSON.stringify(persistedState)).catch(
          (error) => {
            console.warn('Failed to save navigation state:', error);
          }
        );
      }
    },
    [session]
  );

  return { isNavigationReady, initialNavigationState, handleNavigationStateChange };
}
