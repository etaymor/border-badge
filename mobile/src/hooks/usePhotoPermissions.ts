/**
 * Hook to check and manage photo library permission status.
 *
 * Uses MediaLibrary.getPermissionsAsync() which returns current status
 * without triggering the permission dialog.
 *
 * Provides:
 * - status: Current permission status
 * - isLoading: Whether initial check is in progress
 * - refresh: Re-check permission (e.g., after returning from Settings)
 * - requestPermission: Request permission from user (first time only)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as MediaLibrary from 'expo-media-library';

export type PhotoPermissionStatus = 'undetermined' | 'granted' | 'limited' | 'denied';

interface UsePhotoPermissionStatusResult {
  status: PhotoPermissionStatus;
  isLoading: boolean;
  refresh: () => Promise<void>;
  requestPermission: () => Promise<PhotoPermissionStatus>;
}

export function usePhotoPermissionStatus(): UsePhotoPermissionStatusResult {
  const [status, setStatus] = useState<PhotoPermissionStatus>('undetermined');
  const [isLoading, setIsLoading] = useState(true);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const checkPermission = useCallback(async () => {
    try {
      const { status: permStatus, accessPrivileges } = await MediaLibrary.getPermissionsAsync();

      if (permStatus === 'granted') {
        setStatus(accessPrivileges === 'limited' ? 'limited' : 'granted');
      } else if (permStatus === 'denied') {
        setStatus('denied');
      } else {
        setStatus('undetermined');
      }
    } catch {
      setStatus('undetermined');
    }
  }, []);

  const refresh = useCallback(async () => {
    await checkPermission();
  }, [checkPermission]);

  const requestPermission = useCallback(async (): Promise<PhotoPermissionStatus> => {
    try {
      const { status: permStatus, accessPrivileges } = await MediaLibrary.requestPermissionsAsync();

      let newStatus: PhotoPermissionStatus;
      if (permStatus === 'granted') {
        newStatus = accessPrivileges === 'limited' ? 'limited' : 'granted';
      } else if (permStatus === 'denied') {
        newStatus = 'denied';
      } else {
        newStatus = 'undetermined';
      }

      setStatus(newStatus);
      return newStatus;
    } catch {
      return 'undetermined';
    }
  }, []);

  // Initial permission check
  useEffect(() => {
    async function initialCheck() {
      await checkPermission();
      setIsLoading(false);
    }
    initialCheck();
  }, [checkPermission]);

  // Re-check permission when app returns to foreground (e.g., after Settings)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        // App has come to foreground - refresh permission status
        checkPermission();
      }
      appStateRef.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [checkPermission]);

  return { status, isLoading, refresh, requestPermission };
}
