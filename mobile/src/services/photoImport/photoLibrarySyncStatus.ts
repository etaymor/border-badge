/**
 * Photo-library sync status + freshness (P1).
 *
 * One persisted record of "when did ANY writer last bring the photo cache up
 * to date, and how did it go" - written by background sync, quiz refreshes,
 * trip scans, and manual re-scans alike. Replaces the old world where
 * background-sync errors were swallowed with no trace and freshness had no
 * single source of truth.
 *
 * Two clock subtleties this module exists to get right:
 * - `last_import_time` (photoCacheDb) is a PHOTO-CREATION-TIME watermark
 *   (the newest photo's own timestamp), useless for freshness: a user whose
 *   newest geotagged photo is two years old would read as permanently stale.
 * - `last_background_sync_time` is wall-clock but only background sync
 *   writes it. `lastSuccessAt` here is wall-clock and written by everyone.
 *
 * Leaf module: imports only photoCacheDb and expo-media-library (read-only
 * getPermissionsAsync - NEVER prompts; prompting is owned by screens).
 */

import * as MediaLibrary from 'expo-media-library';

import { getCachedPhotoCount, getMetadata, setMetadata } from './photoCacheDb';
import { isAnyLibraryJobRunning, isBackgroundSyncFlagSet } from '@services/jobs/jobRuntimeState';

export type SyncSource = 'background' | 'quiz' | 'trip-scan' | 'manual';

export interface LibrarySyncStatus {
  lastAttemptAt: number | null;
  /** Wall-clock time of the last successful cache refresh, any source. */
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  /** Truncated message of the last failure (analytics-style, never a stack). */
  lastError: string | null;
  lastSource: SyncSource | null;
  lastNewPhotoCount: number | null;
  /** Permission state at last success; a change invalidates freshness. */
  permissionFingerprint: string | null;
}

const SYNC_STATUS_KEY = 'photo_library_sync_status';

/** One number governs "recent": aligned with BACKGROUND_SYNC_INTERVAL_MS. */
export const LIBRARY_FRESHNESS_MS = 60 * 60 * 1000;

const EMPTY_STATUS: LibrarySyncStatus = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastError: null,
  lastSource: null,
  lastNewPhotoCount: null,
  permissionFingerprint: null,
};

export async function getLibrarySyncStatus(): Promise<LibrarySyncStatus> {
  try {
    const raw = await getMetadata(SYNC_STATUS_KEY);
    if (!raw) return { ...EMPTY_STATUS };
    const parsed = JSON.parse(raw) as Partial<LibrarySyncStatus>;
    if (typeof parsed !== 'object' || parsed === null) return { ...EMPTY_STATUS };
    return { ...EMPTY_STATUS, ...parsed };
  } catch {
    return { ...EMPTY_STATUS };
  }
}

async function writeStatus(patch: Partial<LibrarySyncStatus>): Promise<void> {
  const current = await getLibrarySyncStatus();
  await setMetadata(SYNC_STATUS_KEY, JSON.stringify({ ...current, ...patch }));
}

export async function recordSyncAttempt(source: SyncSource): Promise<void> {
  await writeStatus({ lastAttemptAt: Date.now(), lastSource: source });
}

export async function recordSyncSuccess(source: SyncSource, newPhotoCount: number): Promise<void> {
  let permission: string | null = null;
  try {
    permission = (await MediaLibrary.getPermissionsAsync()).status;
  } catch {
    /* fingerprint stays null; freshness degrades to stale rather than lying */
  }
  await writeStatus({
    lastSuccessAt: Date.now(),
    lastSource: source,
    lastNewPhotoCount: newPhotoCount,
    lastError: null,
    lastErrorAt: null,
    permissionFingerprint: permission,
  });
}

export async function recordSyncError(source: SyncSource, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await writeStatus({
    lastErrorAt: Date.now(),
    lastError: message.slice(0, 100),
    lastSource: source,
  });
}

export interface LibraryFreshness {
  fresh: boolean;
  reason:
    | 'synced-recently'
    | 'writer-active'
    | 'stale'
    | 'never-synced'
    | 'permission-changed'
    | 'no-permission';
  lastSuccessAt: number | null;
  cachedPhotoCount: number;
  permission: 'granted' | 'limited' | 'denied' | 'undetermined';
}

/**
 * Is the cache fresh enough to skip a scan? Fresh iff ALL of:
 * 1. lastSuccessAt within `maxStalenessMs` (default 60 min),
 * 2. permission is granted/limited AND matches the fingerprint at last
 *    success (a denied->granted or limited<->granted flip changes the
 *    visible library),
 * 3. the cache is non-empty (an empty cache is never "fresh" - first run
 *    must scan).
 * An active writer (scan/background sync) counts as fresh-enough: the cache
 * is being updated right now and a second writer would interleave.
 */
export async function getLibraryFreshness(
  maxStalenessMs: number = LIBRARY_FRESHNESS_MS
): Promise<LibraryFreshness> {
  let permission: LibraryFreshness['permission'] = 'undetermined';
  try {
    const result = await MediaLibrary.getPermissionsAsync();
    permission =
      result.status === 'granted' && result.accessPrivileges === 'limited'
        ? 'limited'
        : (result.status as LibraryFreshness['permission']);
  } catch {
    permission = 'undetermined';
  }

  const [status, cachedPhotoCount] = await Promise.all([
    getLibrarySyncStatus(),
    getCachedPhotoCount().catch(() => 0),
  ]);
  const base = { lastSuccessAt: status.lastSuccessAt, cachedPhotoCount, permission };

  if (permission !== 'granted' && permission !== 'limited') {
    return { fresh: false, reason: 'no-permission', ...base };
  }
  if (isBackgroundSyncFlagSet() || isAnyLibraryJobRunning()) {
    return { fresh: true, reason: 'writer-active', ...base };
  }
  if (status.lastSuccessAt === null || cachedPhotoCount === 0) {
    return { fresh: false, reason: 'never-synced', ...base };
  }
  if (status.permissionFingerprint !== null && status.permissionFingerprint !== permission) {
    return { fresh: false, reason: 'permission-changed', ...base };
  }
  // Inclusive comparison so maxStalenessMs 0 (the manual re-scan force)
  // reads even a same-millisecond success as stale.
  if (maxStalenessMs <= 0 || Date.now() - status.lastSuccessAt > maxStalenessMs) {
    return { fresh: false, reason: 'stale', ...base };
  }
  return { fresh: true, reason: 'synced-recently', ...base };
}
