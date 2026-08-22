/**
 * Photo cache - on-device ML tags and persisted Guess Where eligibility verdicts.
 *
 * Extracted from photoCacheDb.ts to keep modules focused and under 500 lines.
 * All functions share the same SQLite database via getDb().
 *
 * Two tables, deliberately separate from `cached_photos` because they have a
 * different lifecycle and a different writer:
 *
 * - `photo_ml_tags` holds RAW signals from Apple's Vision framework (free,
 *   on-device). Interpretation lives in TypeScript (`quiz/tagSignals.ts`), never
 *   here and never in Swift, so thresholds retune over-the-air with zero
 *   re-tagging. Only a change to what Swift *emits* bumps TAGGER_VERSION.
 * - `photo_quiz_verdicts` holds the PAID Gemini eligibility verdicts, so a
 *   second game never re-buys a judgement the first game already paid for.
 *   Asset ids are client-only - the server never sees them.
 * - `photo_intent_tags` holds PhotoKit intent/context metadata (favorites,
 *   edits, bursts, capture modes, source, altitude/speed). Zero-pixel and
 *   cheap, so a pass covers the whole library and refreshes periodically -
 *   intent changes over time (a photo can be favorited next month), unlike
 *   pixel signals which are write-once-per-version.
 *
 * Rows for a deleted photo are dropped by `removeCachedPhotos`, and all three
 * tables are purged by `clearPhotoCache`.
 */

import { getDb, SQLITE_PARAM_LIMIT, withPhotoCacheWriteLock } from './photoCacheDb';

/**
 * Version of the native signal set. Bump ONLY when the Swift module changes what
 * it emits (a new request, a different normalization); rows below the current
 * version are re-tagged on the next pass. Retuning thresholds must NOT bump this
 * - that is the whole point of storing raw signals plus `labels_json`.
 */
export const TAGGER_VERSION = 1;

/**
 * Version of the native metadata signal set (`readPhotoMeta`). Same contract as
 * TAGGER_VERSION: bump ONLY when Swift emits different fields.
 */
export const INTENT_META_VERSION = 1;

/** Batch sizes stay well under SQLITE_PARAM_LIMIT (999). See photoCacheDb. */
const UPSERT_BATCH_SIZE = 50;
const ID_BATCH_SIZE = Math.min(100, SQLITE_PARAM_LIMIT);

/** Per-photo status reported by the native tagger. */
export type PhotoTagStatus = 'ok' | 'no-local-image' | 'not-found' | 'error';

/** A single Vision scene-classification label, as stored in `labels_json`. */
export interface PhotoTagLabel {
  /** Vision identifier, e.g. "beach", "mountain", "document". */
  identifier: string;
  confidence: number;
}

/**
 * Raw on-device signals for one photo. Areas are fractions of the frame
 * (normalized bounding-box area), so they are resolution independent.
 */
export interface PhotoMlTag {
  id: string;
  taggerVersion: number;
  status: PhotoTagStatus;
  isScreenshot: boolean;
  faceCount: number | null;
  maxFaceArea: number | null;
  totalFaceArea: number | null;
  humanCount: number | null;
  maxHumanArea: number | null;
  totalHumanArea: number | null;
  labels: PhotoTagLabel[];
  /** iOS 18+ only; null on older systems. Range -1..1. */
  aestheticScore: number | null;
  /** iOS 18+ only; null on older systems. */
  isUtility: boolean | null;
  computedAt: number;
}

/**
 * Deliberate-capture subtypes worth persisting (nobody takes an accidental
 * panorama). Matches the strings the native `readPhotoMeta` emits.
 */
export type PhotoCaptureSubtype = 'pano' | 'hdr' | 'live' | 'depthEffect' | 'screenshot';

/**
 * PhotoKit intent/context metadata for one photo. Every field is free to read
 * (no pixels); interpretation lives in `photoSignals/`.
 */
export interface PhotoIntentTag {
  id: string;
  metaVersion: number;
  /** Explicit like - the strongest "keeper" prior available. */
  isFavorite: boolean;
  /** The user spent effort editing this photo. */
  hasAdjustments: boolean;
  subtypes: PhotoCaptureSubtype[];
  /** PHAsset.burstIdentifier; null outside a burst. */
  burstId: string | null;
  /** iOS (or the user) picked this as the best frame of its burst. */
  burstIsRepresentative: boolean;
  /**
   * True when the asset came from the camera/user library rather than a save
   * from another app - a false here is the saved-from-social prior.
   */
  sourceUserLibrary: boolean;
  /** Member of at least one user-created album (hand-curated). */
  inUserAlbum: boolean;
  /** GPS altitude in meters; null when the fix carried none. */
  altitude: number | null;
  /** GPS speed in m/s at capture; null when unknown. */
  gpsSpeed: number | null;
  refreshedAt: number;
}

/** A persisted Gemini eligibility verdict. */
export interface PhotoQuizVerdict {
  id: string;
  eligible: boolean;
  /** Server rejection reason; null when eligible. */
  reason: string | null;
  /** Scenic tag used to pick lookalike decoys; only meaningful when eligible. */
  landscape: string | null;
  classifierVersion: string;
  classifiedAt: number;
}

interface PhotoMlTagRow {
  id: string;
  tagger_version: number;
  status: string;
  is_screenshot: number;
  face_count: number | null;
  max_face_area: number | null;
  total_face_area: number | null;
  human_count: number | null;
  max_human_area: number | null;
  total_human_area: number | null;
  labels_json: string | null;
  aesthetic_score: number | null;
  is_utility: number | null;
  computed_at: number;
}

interface PhotoIntentTagRow {
  id: string;
  meta_version: number;
  is_favorite: number;
  has_adjustments: number;
  subtypes: string | null;
  burst_id: string | null;
  burst_is_representative: number;
  source_user_library: number;
  in_user_album: number;
  altitude: number | null;
  gps_speed: number | null;
  refreshed_at: number;
}

interface PhotoQuizVerdictRow {
  id: string;
  eligible: number;
  reason: string | null;
  landscape: string | null;
  classifier_version: string;
  classified_at: number;
}

/**
 * Parse `labels_json` defensively: a malformed blob must degrade the photo to
 * "no labels" (which ranks as `unknown`), never throw and abort a whole pass.
 */
function parseLabels(json: string | null): PhotoTagLabel[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const { i, c } = entry as { i?: unknown; c?: unknown };
      if (typeof i !== 'string' || typeof c !== 'number') return [];
      return [{ identifier: i, confidence: c }];
    });
  } catch {
    return [];
  }
}

/** Serialize labels compactly - `{i,c}` roughly halves the stored bytes. */
function serializeLabels(labels: PhotoTagLabel[]): string {
  return JSON.stringify(labels.map((l) => ({ i: l.identifier, c: l.confidence })));
}

function toPhotoMlTag(row: PhotoMlTagRow): PhotoMlTag {
  return {
    id: row.id,
    taggerVersion: row.tagger_version,
    status: row.status as PhotoTagStatus,
    isScreenshot: row.is_screenshot === 1,
    faceCount: row.face_count,
    maxFaceArea: row.max_face_area,
    totalFaceArea: row.total_face_area,
    humanCount: row.human_count,
    maxHumanArea: row.max_human_area,
    totalHumanArea: row.total_human_area,
    labels: parseLabels(row.labels_json),
    aestheticScore: row.aesthetic_score,
    isUtility: row.is_utility === null ? null : row.is_utility === 1,
    computedAt: row.computed_at,
  };
}

/** Parse the subtypes array with the same degrade-to-empty posture as labels. */
function parseSubtypes(json: string | null): PhotoCaptureSubtype[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is PhotoCaptureSubtype => typeof entry === 'string');
  } catch {
    return [];
  }
}

function toPhotoIntentTag(row: PhotoIntentTagRow): PhotoIntentTag {
  return {
    id: row.id,
    metaVersion: row.meta_version,
    isFavorite: row.is_favorite === 1,
    hasAdjustments: row.has_adjustments === 1,
    subtypes: parseSubtypes(row.subtypes),
    burstId: row.burst_id,
    burstIsRepresentative: row.burst_is_representative === 1,
    sourceUserLibrary: row.source_user_library === 1,
    inUserAlbum: row.in_user_album === 1,
    altitude: row.altitude,
    gpsSpeed: row.gps_speed,
    refreshedAt: row.refreshed_at,
  };
}

function toPhotoQuizVerdict(row: PhotoQuizVerdictRow): PhotoQuizVerdict {
  return {
    id: row.id,
    eligible: row.eligible === 1,
    reason: row.reason,
    landscape: row.landscape,
    classifierVersion: row.classifier_version,
    classifiedAt: row.classified_at,
  };
}

// =============================================================================
// ML tags
// =============================================================================

/**
 * Upsert a batch of tags. Called once per native chunk so the table doubles as
 * the resume watermark - an interrupted pass never re-tags what it already wrote.
 */
export async function upsertTags(tags: PhotoMlTag[]): Promise<void> {
  if (tags.length === 0) return;

  const database = await getDb();

  // Shares one connection handle with photoCacheDb, whose writers take an
  // app-level mutex; an unserialized transaction here would collide with them
  // and both writers would lose their work to the rollback.
  await withPhotoCacheWriteLock(async () => {
    await database.withTransactionAsync(async () => {
      for (let i = 0; i < tags.length; i += UPSERT_BATCH_SIZE) {
        const batch = tags.slice(i, i + UPSERT_BATCH_SIZE);
        const placeholders = batch
          .map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .join(', ');
        const values = batch.flatMap((t) => [
          t.id,
          t.taggerVersion,
          t.status,
          t.isScreenshot ? 1 : 0,
          t.faceCount,
          t.maxFaceArea,
          t.totalFaceArea,
          t.humanCount,
          t.maxHumanArea,
          t.totalHumanArea,
          serializeLabels(t.labels),
          t.aestheticScore,
          t.isUtility === null ? null : t.isUtility ? 1 : 0,
          t.computedAt,
        ]);

        await database.runAsync(
          `INSERT OR REPLACE INTO photo_ml_tags
         (id, tagger_version, status, is_screenshot, face_count, max_face_area, total_face_area,
          human_count, max_human_area, total_human_area, labels_json, aesthetic_score, is_utility, computed_at)
         VALUES ${placeholders}`,
          values
        );
      }
    });
  });
}

/** Load tags for a specific set of photo ids, keyed by id. */
export async function getTagsForIds(ids: string[]): Promise<Map<string, PhotoMlTag>> {
  const result = new Map<string, PhotoMlTag>();
  if (ids.length === 0) return result;

  const database = await getDb();

  for (let i = 0; i < ids.length; i += ID_BATCH_SIZE) {
    const batch = ids.slice(i, i + ID_BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const rows = await database.getAllAsync<PhotoMlTagRow>(
      `SELECT id, tagger_version, status, is_screenshot, face_count, max_face_area, total_face_area,
              human_count, max_human_area, total_human_area, labels_json, aesthetic_score, is_utility, computed_at
       FROM photo_ml_tags WHERE id IN (${placeholders})`,
      batch
    );
    for (const row of rows) {
      result.set(row.id, toPhotoMlTag(row));
    }
  }

  return result;
}

/**
 * Retry window for photos with no locally-available pixels. iCloud thumbnail
 * availability changes over time (the OS re-materializes on its own schedule),
 * so `no-local-image` is a "try again later", not a permanent verdict.
 */
const NO_LOCAL_IMAGE_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Given candidate ids in priority order, return those still needing a tagging
 * pass, preserving that order. A photo needs tagging when it has no row, when
 * its row predates the current TAGGER_VERSION, or when it is a `no-local-image`
 * row old enough to be worth retrying.
 *
 * Loads the whole (id, version, status, computed_at) index once rather than
 * probing per id - one query beats thousands.
 */
export async function getUntaggedIds(
  orderedIds: string[],
  now: number = Date.now()
): Promise<string[]> {
  if (orderedIds.length === 0) return [];

  const database = await getDb();
  const rows = await database.getAllAsync<{
    id: string;
    tagger_version: number;
    status: string;
    computed_at: number;
  }>('SELECT id, tagger_version, status, computed_at FROM photo_ml_tags');

  const existing = new Map(rows.map((r) => [r.id, r]));

  return orderedIds.filter((id) => {
    const row = existing.get(id);
    if (!row) return true;
    if (row.tagger_version < TAGGER_VERSION) return true;
    if (row.status === 'no-local-image') {
      return now - row.computed_at >= NO_LOCAL_IMAGE_RETRY_MS;
    }
    return false;
  });
}

/** Coverage counters for the dev diagnostic surface and pass telemetry. */
export interface TagCoverageStats {
  total: number;
  currentVersion: number;
  byStatus: Record<string, number>;
}

export async function getTagCoverageStats(): Promise<TagCoverageStats> {
  const database = await getDb();
  const rows = await database.getAllAsync<{
    status: string;
    tagger_version: number;
    count: number;
  }>(
    'SELECT status, tagger_version, COUNT(*) as count FROM photo_ml_tags GROUP BY status, tagger_version'
  );

  const byStatus: Record<string, number> = {};
  let total = 0;
  let currentVersion = 0;

  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + row.count;
    total += row.count;
    if (row.tagger_version === TAGGER_VERSION) currentVersion += row.count;
  }

  return { total, currentVersion, byStatus };
}

// =============================================================================
// Intent tags
// =============================================================================

/**
 * Upsert a batch of intent tags. Called per native chunk during a metadata
 * pass; like `upsertTags`, the table doubles as the resume watermark.
 */
export async function upsertIntentTags(tags: PhotoIntentTag[]): Promise<void> {
  if (tags.length === 0) return;

  const database = await getDb();

  await withPhotoCacheWriteLock(async () => {
    await database.withTransactionAsync(async () => {
      for (let i = 0; i < tags.length; i += UPSERT_BATCH_SIZE) {
        const batch = tags.slice(i, i + UPSERT_BATCH_SIZE);
        const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        const values = batch.flatMap((t) => [
          t.id,
          t.metaVersion,
          t.isFavorite ? 1 : 0,
          t.hasAdjustments ? 1 : 0,
          t.subtypes.length > 0 ? JSON.stringify(t.subtypes) : null,
          t.burstId,
          t.burstIsRepresentative ? 1 : 0,
          t.sourceUserLibrary ? 1 : 0,
          t.inUserAlbum ? 1 : 0,
          t.altitude,
          t.gpsSpeed,
          t.refreshedAt,
        ]);

        await database.runAsync(
          `INSERT OR REPLACE INTO photo_intent_tags
         (id, meta_version, is_favorite, has_adjustments, subtypes, burst_id,
          burst_is_representative, source_user_library, in_user_album, altitude, gps_speed, refreshed_at)
         VALUES ${placeholders}`,
          values
        );
      }
    });
  });
}

/** Load intent tags for a specific set of photo ids, keyed by id. */
export async function getIntentTagsForIds(ids: string[]): Promise<Map<string, PhotoIntentTag>> {
  const result = new Map<string, PhotoIntentTag>();
  if (ids.length === 0) return result;

  const database = await getDb();

  for (let i = 0; i < ids.length; i += ID_BATCH_SIZE) {
    const batch = ids.slice(i, i + ID_BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const rows = await database.getAllAsync<PhotoIntentTagRow>(
      `SELECT id, meta_version, is_favorite, has_adjustments, subtypes, burst_id,
              burst_is_representative, source_user_library, in_user_album, altitude, gps_speed, refreshed_at
       FROM photo_intent_tags WHERE id IN (${placeholders})`,
      batch
    );
    for (const row of rows) {
      result.set(row.id, toPhotoIntentTag(row));
    }
  }

  return result;
}

/** Row count at the current meta version, for pass telemetry. */
export async function getIntentTagCount(): Promise<number> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM photo_intent_tags WHERE meta_version = ?',
    [INTENT_META_VERSION]
  );
  return row?.count ?? 0;
}

// =============================================================================
// Quiz verdicts
// =============================================================================

/**
 * Persist eligibility verdicts. Written fire-and-forget after each classified
 * batch, for eligible AND ineligible photos alike - knowing a photo already
 * failed is exactly as valuable as knowing it passed, because it keeps the next
 * hunt from re-drawing it.
 */
export async function upsertVerdicts(verdicts: PhotoQuizVerdict[]): Promise<void> {
  if (verdicts.length === 0) return;

  const database = await getDb();

  // Serialized for the same reason as upsertTags: one shared connection handle.
  await withPhotoCacheWriteLock(async () => {
    await database.withTransactionAsync(async () => {
      for (let i = 0; i < verdicts.length; i += UPSERT_BATCH_SIZE) {
        const batch = verdicts.slice(i, i + UPSERT_BATCH_SIZE);
        const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
        const values = batch.flatMap((v) => [
          v.id,
          v.eligible ? 1 : 0,
          v.reason,
          v.landscape,
          v.classifierVersion,
          v.classifiedAt,
        ]);

        await database.runAsync(
          `INSERT OR REPLACE INTO photo_quiz_verdicts
         (id, eligible, reason, landscape, classifier_version, classified_at)
         VALUES ${placeholders}`,
          values
        );
      }
    });
  });
}

/**
 * Load every stored verdict, keyed by id. Creation reads the whole set once and
 * intersects it with the candidate pool in memory; the table is bounded by the
 * classification budget spent to date, so it stays far smaller than the library.
 */
export async function getAllVerdicts(): Promise<Map<string, PhotoQuizVerdict>> {
  const database = await getDb();
  const rows = await database.getAllAsync<PhotoQuizVerdictRow>(
    'SELECT id, eligible, reason, landscape, classifier_version, classified_at FROM photo_quiz_verdicts'
  );
  return new Map(rows.map((row) => [row.id, toPhotoQuizVerdict(row)]));
}
