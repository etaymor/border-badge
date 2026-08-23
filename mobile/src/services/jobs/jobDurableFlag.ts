/**
 * jobDurableFlag - The breadcrumb that lets a job resume after iOS suspends
 * or kills the JS runtime.
 *
 * One key per job kind (`job:<kind>:state`) holding a JSON record. PRESENCE of
 * a parseable record means "this job was in progress". Per-kind keys rather
 * than one combined key because two writers would otherwise race on a
 * read-modify-write of the same row.
 *
 * LEGACY COMPAT (remove one release after the runtime ships):
 * The trip scan previously used a `scan_in_progress` / `scan_started_at` pair.
 * Three rules keep both directions of an OTA safe:
 *   1. READ falls back to the legacy pair, so a user who is mid-scan when the
 *      update lands still resumes.
 *   2. CLEAR also writes `scan_in_progress = 'false'`, so an
 *      upgrade -> finish -> rollback can't leave a permanently-true legacy flag
 *      driving a scan that resumes forever.
 *   3. WRITE dual-writes both shapes for `trip-scan` only.
 */

import { getMetadata, setMetadata } from '@services/photoImport/photoCacheDb';

import type { LibraryJobKind } from './jobTypes';

/** Legacy trip-scan keys. TODO(post-runtime-release): delete with the dual-write. */
const LEGACY_IN_PROGRESS_KEY = 'scan_in_progress';
const LEGACY_STARTED_AT_KEY = 'scan_started_at';

const RECORD_VERSION = 1;

export interface DurableJobRecord {
  v: number;
  startedAt: number;
  options?: unknown;
  checkpoint?: unknown;
  /**
   * When the checkpoint was last written. Staleness is measured from the most
   * recent of this and `startedAt`: a job that has been running (and
   * checkpointing) for 40 minutes is not dead, it is long. Absent on records
   * written before this field existed; readers fall back to `startedAt`.
   */
  lastCheckpointAt?: number;
}

function keyFor(kind: LibraryJobKind): string {
  return `job:${kind}:state`;
}

/**
 * Read the durable record for a kind, or null when no job was in progress.
 * Falls back to the legacy trip-scan pair when the new key is absent.
 */
export async function readDurableJob(kind: LibraryJobKind): Promise<DurableJobRecord | null> {
  const raw = await getMetadata(keyFor(kind));
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as DurableJobRecord;
      if (parsed && typeof parsed.startedAt === 'number') {
        return parsed;
      }
    } catch {
      // A corrupt record is treated as "no job in progress" rather than
      // thrown: a resume path that crashes is worse than one that declines.
    }
    return null;
  }

  if (kind !== 'trip-scan') return null;

  // Legacy fallback: a scan that started before this module existed.
  const legacyFlag = await getMetadata(LEGACY_IN_PROGRESS_KEY);
  if (legacyFlag !== 'true') return null;
  const legacyStartedAt = await getMetadata(LEGACY_STARTED_AT_KEY);
  return {
    v: RECORD_VERSION,
    startedAt: legacyStartedAt ? parseInt(legacyStartedAt, 10) : Date.now(),
  };
}

/**
 * Persist the durable record. Callers MUST await this before reporting a job
 * as started — that ordering closes a crash window where the in-memory lock is
 * set but no breadcrumb exists for foreground auto-resume to find.
 */
export async function writeDurableJob(
  kind: LibraryJobKind,
  record: Omit<DurableJobRecord, 'v'>
): Promise<void> {
  await setMetadata(keyFor(kind), JSON.stringify({ v: RECORD_VERSION, ...record }));
  if (kind === 'trip-scan') {
    // Dual-write so a rollback to the previous bundle still sees the scan.
    await setMetadata(LEGACY_IN_PROGRESS_KEY, 'true');
    await setMetadata(LEGACY_STARTED_AT_KEY, record.startedAt.toString());
  }
}

/** Update only the checkpoint, preserving startedAt/options. No-op if absent. */
export async function saveDurableCheckpoint(
  kind: LibraryJobKind,
  checkpoint: unknown
): Promise<void> {
  const existing = await readDurableJob(kind);
  if (!existing) return;
  await setMetadata(
    keyFor(kind),
    JSON.stringify({ ...existing, v: RECORD_VERSION, checkpoint, lastCheckpointAt: Date.now() })
  );
}

/**
 * Clear the breadcrumb. Also flips the legacy flag to 'false' so a rolled-back
 * bundle doesn't resurrect a finished scan.
 */
export async function clearDurableJob(kind: LibraryJobKind): Promise<void> {
  await setMetadata(keyFor(kind), '');
  if (kind === 'trip-scan') {
    await setMetadata(LEGACY_IN_PROGRESS_KEY, 'false');
    // `scan_started_at` is deliberately left behind as a forensic trail,
    // matching the prior behavior of clearScanMetadata.
  }
}
