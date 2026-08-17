/**
 * Background on-device photo tagging.
 *
 * Runs Apple's Vision framework over library photos and writes raw signals to
 * `photo_ml_tags`, so that by the time someone builds a Guess Where challenge
 * the ranking data already exists. Free (on the Neural Engine), and entirely
 * off the critical path: a pass only ever runs AFTER a foreground sync or scan
 * has finished, never during one, and never on the boot path.
 *
 * Priority order is the whole trick. A 50k-photo library will not be fully
 * tagged for a long time, so a pass tags photos in exactly the order quiz
 * creation would reach for them (country spread, home deprioritized, unused
 * first). Coverage where it matters arrives within a handful of sessions
 * instead of after the whole library.
 *
 * Structure note: `runTaggingPass` takes its dependencies as an argument and
 * `maybeRunTaggingPass` does the lazy-import wiring. That split is deliberate -
 * `photoBackgroundSync.ts` resolves its deps through a dynamic `import()` that
 * Jest cannot follow, which is why its own test file re-implements the lock
 * inline instead of importing the module. The seam here keeps the pass itself
 * directly testable while the heavy imports stay off the boot path.
 */

import { features } from '@config/features';

import { getMetadata, setMetadata } from './photoCacheDb';
import { isBackgroundSyncInProgress } from './photoBackgroundSync';
import { isScanRunning } from './photoScanState';
import { getUntaggedIds, TAGGER_VERSION, upsertTags } from './photoTagDb';
import type { PhotoMlTag } from './photoTagDb';
import { SCAN_CONFIG } from './photoImportService';

/** Stop after this many photos in one pass, however fast they go. */
export const TAGGING_PASS_PHOTO_BUDGET = 400;

/** Stop after this much wall clock, however few photos got done. */
export const TAGGING_PASS_TIME_BUDGET_MS = 60_000;

/** Minimum gap between passes, so a chatty foreground does not loop us. */
export const TAGGING_PASS_MIN_INTERVAL_MS = 10 * 60 * 1000;

const LAST_PASS_KEY = 'last_tagging_pass_at';

// Module-level lock, mirroring photoBackgroundSync's shape: a boolean guard
// checked before any await, a controller for aborts, and a generation id so a
// released-then-restarted pass's `finally` cannot clobber the newer holder.
let taggingController: AbortController | null = null;
let taggingInProgress = false;
let taggingPassId = 0;

export function isTaggingPassInProgress(): boolean {
  return taggingInProgress;
}

/**
 * Abort an in-flight pass. Called before a scan starts, so tagging never
 * competes with the scan for CPU or for the photo cache.
 */
export function abortTaggingPass(): void {
  if (taggingController) {
    taggingController.abort();
    taggingController = null;
    taggingInProgress = false;
  }
}

function acquireTaggingLock(): { controller: AbortController; passId: number } | null {
  // Atomic in JS's single-threaded model as long as no await intervenes.
  if (taggingInProgress) return null;
  taggingInProgress = true;
  taggingController = new AbortController();
  return { controller: taggingController, passId: ++taggingPassId };
}

function releaseTaggingLock(passId: number): void {
  if (taggingPassId === passId) {
    taggingInProgress = false;
    taggingController = null;
  }
}

export interface TaggingPassResult {
  tagged: number;
  chunks: number;
  stoppedBy: 'complete' | 'photo-budget' | 'time-budget' | 'aborted';
}

/** Everything the pass touches, injected so it can be driven from a test. */
export interface TaggingPassDeps {
  /** Candidate ids in the order quiz creation would reach for them. */
  loadPriorityIds(): Promise<string[]>;
  /** Filter to ids that still need tagging (missing or stale version). */
  getUntaggedIds(orderedIds: string[]): Promise<string[]>;
  tagPhotos(assetIds: string[]): Promise<PhotoMlTag[]>;
  upsertTags(tags: PhotoMlTag[]): Promise<void>;
  chunkSize: number;
  now(): number;
  /** Yield to the UI thread between chunks. */
  yieldToUI(): Promise<void>;
}

/**
 * Run one pass. Assumes the caller HOLDS the lock and has already checked the
 * gates. Never throws: a tagging failure must be invisible to the user.
 */
export async function runTaggingPass(
  deps: TaggingPassDeps,
  signal: AbortSignal
): Promise<TaggingPassResult> {
  const startedAt = deps.now();
  let tagged = 0;
  let chunks = 0;

  const priorityIds = await deps.loadPriorityIds();
  if (signal.aborted) return { tagged, chunks, stoppedBy: 'aborted' };

  const pending = await deps.getUntaggedIds(priorityIds);
  if (signal.aborted) return { tagged, chunks, stoppedBy: 'aborted' };

  for (let index = 0; index < pending.length; index += deps.chunkSize) {
    if (signal.aborted) return { tagged, chunks, stoppedBy: 'aborted' };
    if (tagged >= TAGGING_PASS_PHOTO_BUDGET) {
      return { tagged, chunks, stoppedBy: 'photo-budget' };
    }
    if (deps.now() - startedAt >= TAGGING_PASS_TIME_BUDGET_MS) {
      return { tagged, chunks, stoppedBy: 'time-budget' };
    }

    const chunk = pending.slice(index, index + deps.chunkSize);
    let results: PhotoMlTag[];
    try {
      results = await deps.tagPhotos(chunk);
    } catch {
      // One bad chunk should not end the pass; the next one may be fine.
      continue;
    }
    if (results.length === 0) continue;

    // Commit after EVERY chunk: the table is the resume watermark, so a pass
    // killed mid-way (backgrounded, aborted by a scan) never redoes its work.
    try {
      await deps.upsertTags(results);
    } catch {
      // A failed write costs a re-tag next pass, nothing more.
      continue;
    }
    tagged += results.length;
    chunks += 1;

    await deps.yieldToUI();
  }

  return { tagged, chunks, stoppedBy: 'complete' };
}

/** Whether a pass may start right now. Never prompts for anything. */
async function passIsAllowed(): Promise<boolean> {
  if (!features.enablePhotoTagging) return false;
  // Another writer owns the cache; tagging always yields to it.
  if (isScanRunning() || isBackgroundSyncInProgress()) return false;

  const lastPass = await getMetadata(LAST_PASS_KEY);
  if (lastPass) {
    const elapsed = Date.now() - parseInt(lastPass, 10);
    if (elapsed >= 0 && elapsed < TAGGING_PASS_MIN_INTERVAL_MS) return false;
  }
  return true;
}

/**
 * Entry point for the triggers. Fire-and-forget (`void maybeRunTaggingPass()`):
 * never awaited, never throws, and silently does nothing whenever a gate says
 * no - including on Android and in binaries without the native module.
 */
export async function maybeRunTaggingPass(): Promise<TaggingPassResult | null> {
  try {
    if (!(await passIsAllowed())) return null;

    // Lazy so the native module, the country coder, and the quiz selection
    // machinery all stay off the boot path.
    const [
      { isPhotoTaggerAvailable, photoTaggerCapabilities, tagPhotos, TAG_CHUNK_SIZE },
      MediaLibrary,
    ] = await Promise.all([import('@modules/photo-tagger'), import('expo-media-library')]);

    if (!isPhotoTaggerAvailable()) return null;

    // Never prompt: tagging is opportunistic, and a permission dialog from a
    // background task would be baffling.
    const permission = await MediaLibrary.getPermissionsAsync();
    if (permission.status !== 'granted') return null;

    // Do not add heat or drain to a device already struggling.
    const capabilities = photoTaggerCapabilities();
    if (capabilities?.lowPower) return null;
    if (capabilities?.thermalState === 'serious' || capabilities?.thermalState === 'critical') {
      return null;
    }

    const lock = acquireTaggingLock();
    if (!lock) return null;

    try {
      const result = await runTaggingPass(
        {
          loadPriorityIds: () => loadPriorityIds(),
          getUntaggedIds: (ids) => getUntaggedIds(ids),
          tagPhotos: (ids) => tagPhotos(ids).then(toStoredTags),
          upsertTags,
          chunkSize: TAG_CHUNK_SIZE,
          now: () => Date.now(),
          yieldToUI: () =>
            new Promise((resolve) => setTimeout(resolve, SCAN_CONFIG.YIELD_INTERVAL_MS)),
        },
        lock.controller.signal
      );

      await setMetadata(LAST_PASS_KEY, Date.now().toString());
      if (__DEV__) {
        console.log(
          `[PhotoTagging] pass complete: tagged=${result.tagged} chunks=${result.chunks} ` +
            `stoppedBy=${result.stoppedBy}`
        );
      }
      return result;
    } finally {
      releaseTaggingLock(lock.passId);
    }
  } catch (error) {
    if (__DEV__) console.log('[PhotoTagging] pass failed:', error);
    return null;
  }
}

/** Map the native payload onto stored rows. */
function toStoredTags(native: Array<import('@modules/photo-tagger').NativePhotoTag>): PhotoMlTag[] {
  const computedAt = Date.now();
  return native.map((tag) => ({
    id: tag.id,
    taggerVersion: TAGGER_VERSION,
    status: tag.status,
    isScreenshot: tag.isScreenshot,
    faceCount: tag.faceCount,
    maxFaceArea: tag.maxFaceArea,
    totalFaceArea: tag.totalFaceArea,
    humanCount: tag.humanCount,
    maxHumanArea: tag.maxHumanArea,
    totalHumanArea: tag.totalHumanArea,
    labels: tag.labels,
    aestheticScore: tag.aestheticScore,
    isUtility: tag.isUtility,
    computedAt,
  }));
}

/**
 * Candidate ids in quiz-creation priority order.
 *
 * Reuses the exact selection machinery creation uses, so the photos we tag
 * first are the photos the next challenge will reach for first. Ordering the
 * pool by anything else (recency, id) would spend a pass on photos creation may
 * not touch for months.
 */
async function loadPriorityIds(): Promise<string[]> {
  const [{ getAllCachedPhotos }, { getAllCountries, getHomeCountry }] = await Promise.all([
    import('./photoCacheDb'),
    import('@services/countriesDb'),
  ]);
  const { orderByCountrySpread, prepareCandidatePool, toCandidate } =
    await import('@services/quiz/candidateSelection');
  const { getUsedAssetIds } = await import('@services/quiz/quizDraftStore');

  const [cached, countries, usedAssetIds, homeCountry] = await Promise.all([
    getAllCachedPhotos(),
    getAllCountries(),
    getUsedAssetIds(),
    getHomeCountry().catch(() => null),
  ]);

  const validCodes = new Set(countries.map((country) => country.code));
  const prepared = prepareCandidatePool(cached.map(toCandidate), validCodes);
  const homeCountries = new Set(homeCountry ? [homeCountry] : []);

  return orderByCountrySpread(prepared, usedAssetIds, homeCountries).map(
    (candidate) => candidate.id
  );
}
