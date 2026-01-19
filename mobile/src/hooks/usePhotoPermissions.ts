/**
 * Hook to check photo library permission status without prompting.
 *
 * Uses MediaLibrary.getPermissionsAsync() which returns current status
 * without triggering the permission dialog.
 */

import { useEffect, useState } from 'react';
import * as MediaLibrary from 'expo-media-library';

export type PhotoPermissionStatus = 'undetermined' | 'granted' | 'limited' | 'denied';

interface UsePhotoPermissionStatusResult {
  status: PhotoPermissionStatus;
  isLoading: boolean;
}

export function usePhotoPermissionStatus(): UsePhotoPermissionStatusResult {
  const [status, setStatus] = useState<PhotoPermissionStatus>('undetermined');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function checkPermission() {
      try {
        const { status: permStatus, accessPrivileges } =
          await MediaLibrary.getPermissionsAsync();

        if (permStatus === 'granted') {
          setStatus(accessPrivileges === 'limited' ? 'limited' : 'granted');
        } else if (permStatus === 'denied') {
          setStatus('denied');
        } else {
          setStatus('undetermined');
        }
      } catch {
        setStatus('undetermined');
      } finally {
        setIsLoading(false);
      }
    }

    checkPermission();
  }, []);

  return { status, isLoading };
}
