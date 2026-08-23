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
 * A second, much cheaper pass type shares the same lock: a whole-library
 * intent-metadata sweep (`runIntentPass`, zero pixels) that refreshes
 * `photo_intent_tags` at most daily, because intent drifts - a photo can be
 * favorited next month.
 *
 * Structure note: `runTaggingPass` takes its dependencies as an argument and
 * `maybeRunTaggingPass` does the lazy-import wiring. That split is deliberate -
 * `photoBackgroundSync.ts` resolves its deps through a dynamic `import()` that
 * Jest cannot follow, which is why its own test file re-implements the lock
 * inline instead of importing the module. The seam here keeps the pass itself
 * directly testable while the heavy imports stay off the boot path.
 */

import { features } from '@config/features';
import { Analytics } from '@services/analytics';

import { getMetadata, setMetadata } from './photoCacheDb';
import { isBackgroundSyncInProgress } from './photoBackgroundSync';
import { isAnyLibraryJobRunning } from '@services/jobs/jobRuntimeState';
import {
  getStaleIntentIds,
  getTagCoverageStats,
  getUntaggedIds,
  INTENT_META_VERSION,
  TAGGER_VERSION,
  upsertIntentTags,
  upsertTags,
} from './photoTagDb';
import type { PhotoIntentTag, PhotoMlTag } from './photoTagDb';
import { SCAN_CONFIG } from './photoImportService';

/** Stop after this many photos in one pass, however fast they go. */
export const TAGGING_PASS_PHOTO_BUDGET = 400;

/** Stop after this much wall clock, however few photos got done. */
export const TAGGING_PASS_TIME_BUDGET_MS = 60_000;

/** Minimum gap between passes, so a chatty foreground does not loop us. */
export const TAGGING_PASS_MIN_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Minimum gap between whole-library intent-metadata sweeps. Intent changes
 * over time (a photo can be favorited next month), so unlike pixel tags the
 * sweep re-reads everything - daily is fresh enough and keeps the PhotoKit
 * churn bounded.
 */
export const INTENT_PASS_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Backstop only: metadata is cheap (no pixels), so a sweep normally finishes
 * in seconds. The budget exists for the pathological library, not the typical
 * one.
 */
export const INTENT_PASS_TIME_BUDGET_MS = 30_000;

const LAST_PASS_KEY = 'last_tagging_pass_at';
const LAST_INTENT_PASS_KEY = 'last_intent_pass_at';

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

export interface IntentPassResult {
  tagged: number;
  chunks: number;
  /**
   * `incomplete` means at least one chunk failed. It is deliberately distinct
   * from `complete`: a sweep that read nothing because the bridge was down
   * looks identical to one that found nothing stale, and treating it as
   * finished would stamp the 24h window over a library that never got swept.
   */
  stoppedBy: 'complete' | 'incomplete' | 'time-budget' | 'aborted';
}

/** Everything the intent sweep touches, injected so it can be driven from a test. */
export interface IntentPassDeps {
  /** Every cached photo id - the sweep is whole-library by design. */
  loadAllIds(): Promise<string[]>;
  /**
   * Filter to ids whose row is missing, stale-versioned, or older than the
   * sweep interval. This is the resume watermark: a time-budgeted sweep
   * commits per chunk, so the next one skips the fresh prefix and continues
   * into the tail instead of re-reading the same prefix forever.
   */
  getStaleIds(orderedIds: string[]): Promise<string[]>;
  readPhotoMeta(assetIds: string[]): Promise<PhotoIntentTag[]>;
  upsertIntentTags(tags: PhotoIntentTag[]): Promise<void>;
  chunkSize: number;
  now(): number;
  /** Yield to the UI thread between chunks. */
  yieldToUI(): Promise<void>;
}

/**
 * Run one whole-library intent-metadata sweep. Same contract as
 * `runTaggingPass`: the caller HOLDS the lock and has checked the gates, and
 * the pass never throws. No photo budget - metadata is cheap - but the time
 * budget stays as a backstop for pathological libraries.
 */
export async function runIntentPass(
  deps: IntentPassDeps,
  signal: AbortSignal
): Promise<IntentPassResult> {
  const startedAt = deps.now();
  let tagged = 0;
  let chunks = 0;
  let failedChunks = 0;

  const allIds = await deps.loadAllIds();
  if (signal.aborted) return { tagged, chunks, stoppedBy: 'aborted' };

  const pending = await deps.getStaleIds(allIds);
  if (signal.aborted) return { tagged, chunks, stoppedBy: 'aborted' };

  for (let index = 0; index < pending.length; index += deps.chunkSize) {
    if (signal.aborted) return { tagged, chunks, stoppedBy: 'aborted' };
    if (deps.now() - startedAt >= INTENT_PASS_TIME_BUDGET_MS) {
      return { tagged, chunks, stoppedBy: 'time-budget' };
    }

    const chunk = pending.slice(index, index + deps.chunkSize);
    let results: PhotoIntentTag[];
    try {
      results = await deps.readPhotoMeta(chunk);
    } catch {
      // One bad chunk should not end the sweep; the next one may be fine. It
      // does have to be remembered, though - see `failedChunks` at the return.
      failedChunks += 1;
      continue;
    }
    if (results.length === 0) continue;

    // Commit after EVERY chunk, mirroring the pixel pass: an aborted sweep's
    // finished chunks keep their fresh rows instead of being thrown away.
    try {
      await deps.upsertIntentTags(results);
    } catch {
      // A failed write costs a re-read next sweep, nothing more.
      failedChunks += 1;
      continue;
    }
    tagged += results.length;
    chunks += 1;

    await deps.yieldToUI();
  }

  // Reaching the end of the list is not the same as having swept it: any failed
  // chunk leaves stale rows behind, so the caller must not stamp the window.
  return { tagged, chunks, stoppedBy: failedChunks > 0 ? 'incomplete' : 'complete' };
}

/**
 * Run the daily sweep if it is due, and stamp the window only when it actually
 * finished the library.
 *
 * Split out of `maybeRunTaggingPass` for the same reason `runIntentPass` takes
 * its deps as an argument: the entry point's dynamic imports are invisible to
 * Jest, and this branch is the one that can silence the sweep for 24h over a
 * library it never touched.
 */
export async function runIntentSweepWithWindow(
  deps: IntentPassDeps,
  signal: AbortSignal
): Promise<IntentPassResult | null> {
  if (signal.aborted || !(await intentPassIsDue())) return null;

  const result = await runIntentPass(deps, signal);
  // Only a COMPLETE sweep stamps the 24h window. An aborted, time-budgeted, or
  // partly failed one leaves it unstamped so the next pass (10-minute cadence)
  // resumes into the tail - per-chunk commits plus the staleness filter mean it
  // skips everything already fresh.
  if (result.stoppedBy === 'complete') {
    await setMetadata(LAST_INTENT_PASS_KEY, Date.now().toString());
  }
  return result;
}

/**
 * Report one pass's outcome plus overall coverage.
 *
 * `no_local_image` is the number that decides a real open question: if
 * "Optimize iPhone Storage" evicts even 512px thumbnails at scale, coverage
 * stays low no matter how many passes run, and allowing network access becomes
 * worth considering. Best-effort - telemetry never fails a pass.
 */
async function reportPass(
  result: TaggingPassResult,
  intentResult: IntentPassResult | null
): Promise<void> {
  try {
    const coverage = await getTagCoverageStats();
    const intentTagged = intentResult?.tagged ?? 0;
    // How the sweep ENDED is the part telemetry could not see before: a sweep
    // that failed every chunk reported zero rows, which is what a sweep with
    // nothing to do reports too.
    const intentStoppedBy = intentResult?.stoppedBy;
    if (__DEV__) {
      console.log(
        `[PhotoTagging] pass complete: tagged=${result.tagged} chunks=${result.chunks} ` +
          `stoppedBy=${result.stoppedBy} coverage=${coverage.currentVersion}/${coverage.total} ` +
          `noLocalImage=${coverage.byStatus['no-local-image'] ?? 0} intentTagged=${intentTagged} ` +
          `intentStoppedBy=${intentStoppedBy ?? 'not-due'}`
      );
    }
    Analytics.photoTaggingPass({
      tagged: result.tagged,
      chunks: result.chunks,
      stoppedBy: result.stoppedBy,
      coverageTotal: coverage.total,
      coverageCurrentVersion: coverage.currentVersion,
      noLocalImage: coverage.byStatus['no-local-image'] ?? 0,
      intentTagged,
      intentStoppedBy,
    });
  } catch {
    // Telemetry is never worth failing a pass over.
  }
}

/** Whether a pass may start right now. Never prompts for anything. */
async function passIsAllowed(): Promise<boolean> {
  if (!features.enablePhotoTagging) return false;
  // Another writer owns the cache; tagging always yields to it.
  if (isAnyLibraryJobRunning() || isBackgroundSyncInProgress()) return false;

  const lastPass = await getMetadata(LAST_PASS_KEY);
  if (lastPass) {
    const elapsed = Date.now() - parseInt(lastPass, 10);
    if (elapsed >= 0 && elapsed < TAGGING_PASS_MIN_INTERVAL_MS) return false;
  }
  return true;
}

/** Whether the daily whole-library intent sweep is due. */
async function intentPassIsDue(): Promise<boolean> {
  if (!features.enableIntentSignals) return false;

  const lastPass = await getMetadata(LAST_INTENT_PASS_KEY);
  if (lastPass) {
    const elapsed = Date.now() - parseInt(lastPass, 10);
    if (elapsed >= 0 && elapsed < INTENT_PASS_MIN_INTERVAL_MS) return false;
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
      {
        isPhotoTaggerAvailable,
        photoTaggerCapabilities,
        tagPhotos,
        readPhotoMeta,
        TAG_CHUNK_SIZE,
        META_CHUNK_SIZE,
      },
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

      // The intent sweep rides the SAME lock and abort controller: it is a
      // second pass type in this service, never a competing scheduler. It runs
      // after the pixel pass so a budgeted pixel pass is never starved by
      // metadata work.
      const intentResult = await runIntentSweepWithWindow(
        {
          loadAllIds: () => loadAllCachedIds(),
          getStaleIds: (ids) => getStaleIntentIds(ids, INTENT_PASS_MIN_INTERVAL_MS),
          readPhotoMeta: (ids) => readPhotoMeta(ids).then(toStoredIntentTags),
          upsertIntentTags,
          chunkSize: META_CHUNK_SIZE,
          now: () => Date.now(),
          yieldToUI: () =>
            new Promise((resolve) => setTimeout(resolve, SCAN_CONFIG.YIELD_INTERVAL_MS)),
        },
        lock.controller.signal
      );

      await reportPass(result, intentResult);
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

/** Map the native metadata payload onto stored rows. */
function toStoredIntentTags(
  native: Array<import('@modules/photo-tagger').NativePhotoMeta>
): PhotoIntentTag[] {
  const refreshedAt = Date.now();
  return native.map((meta) => ({
    id: meta.id,
    metaVersion: INTENT_META_VERSION,
    isFavorite: meta.isFavorite,
    hasAdjustments: meta.hasAdjustments,
    subtypes: meta.subtypes,
    burstId: meta.burstId,
    burstIsRepresentative: meta.burstIsRepresentative,
    sourceUserLibrary: meta.sourceUserLibrary,
    inUserAlbum: meta.inUserAlbum,
    altitude: meta.altitude,
    gpsSpeed: meta.gpsSpeed,
    refreshedAt,
  }));
}

/** Every cached photo id - the intent sweep is whole-library by design. */
async function loadAllCachedIds(): Promise<string[]> {
  const { getCachedPhotoIds } = await import('./photoCacheDb');
  return [...(await getCachedPhotoIds())];
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
