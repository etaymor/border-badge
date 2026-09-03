import type { PhotoPermissionStatus } from '@hooks/usePhotoPermissions';

export type PhotoPermissionPhase =
  | 'checking'
  | 'soft-ask'
  | 'recovery'
  | 'ready'
  | 'blocked-settings';

/** Map Expo/app status to UI phase. `forceRecovery` shows recovery even for limited. */
export function phaseFromStatus(
  status: PhotoPermissionStatus,
  opts?: { forceRecovery?: boolean }
): PhotoPermissionPhase {
  if (status === 'undetermined') return 'soft-ask';
  if (status === 'denied') return 'blocked-settings';
  if (status === 'limited' && opts?.forceRecovery) return 'recovery';
  if (status === 'granted' || status === 'limited') return 'ready';
  return 'checking';
}
