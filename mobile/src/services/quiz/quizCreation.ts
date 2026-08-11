/**
 * Quiz creation orchestration for the travel photo quiz.
 *
 * One tap from the entry point to a built quiz awaiting owner play:
 *   draft -> refresh photo cache -> select candidates -> vision eligibility
 *   -> pick 5-10 with country spread -> upload via quiz signed URLs -> finalize.
 *
 * Key behaviors:
 * - KTD1: candidates come from the existing SQLite photo cache. Refresh uses
 *   the background-sync mechanics (incremental extract since last import) -
 *   never a forced full rescan. A fresh install with an empty cache runs the
 *   initial extraction here, so the flow works with photo permission as the
 *   only prerequisite (R7).
 * - KTD3: first batch <= FIRST_BATCH_MAX, ONE resample of ~RESAMPLE_BATCH_MAX
 *   from unclassified countries when fewer than QUIZ_MIN_PHOTOS are eligible,
 *   bounded by the server-reported remaining budget.
 * - KTD5: eligibility thumbnails reuse the 768px JPEG vision pipeline; final
 *   picks are ALWAYS re-encoded through expo-image-manipulator before upload
 *   (its native save writes pixels only - `UIImage.jpegData` on iOS - so EXIF
 *   GPS never reaches storage). Uploads go to the quiz signed URLs with the
 *   server-directed cacheControl header, NOT through the trip/entry media flow.
 * - KTD7: a thin-library decline deletes the draft server-side; an interrupted
 *   or abandoned creation keeps a locally persisted resumable draft, and
 *   resuming never re-uploads completed photos.
 * - KTD12: used asset ids persist locally (photo cache metadata) so repeat
 *   creations prefer unused photos.
 *
 * Module-load discipline: this file is evaluated at app boot (the creation
 * screen is registered in the root navigator), so country-coder access goes
 * through the LAZY accessor and expo-image-manipulator through an inline
 * require - mirroring the photo-import modules.
 */

import { File as ExpoFile } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';

import { api } from '@services/api';
import { getAllCountries } from '@services/countriesDb';
import { getImageDimensions } from '@services/mediaUpload';
import { iso1A2Code } from '@services/photoImport/countryCoder';
import { isBackgroundSyncInProgress } from '@services/photoImport/photoBackgroundSync';
import {
  cachePhotos,
  getAllCachedPhotos,
  getLastImportTime,
  getMetadata,
  setLastImportTime,
  setMetadata,
} from '@services/photoImport/photoCacheDb';
import { photoToCachedPhoto } from '@services/photoImport/photoClusteringCache';
import { extractPhotosWithLocation } from '@services/photoImport/photoImportService';
import { isScanRunning } from '@services/photoImport/photoScanState';
import { prepareVisionImage } from '@services/photoImport/visionPhoto';
import type { CachedPhoto } from '@services/photoImport/types';

import {
  CLASSIFICATION_BUDGET_PER_QUIZ,
  FIRST_BATCH_MAX,
  QUIZ_MIN_PHOTOS,
  RESAMPLE_BATCH_MAX,
  pickQuizPhotos,
  selectEligibilityBatch,
  toCandidate,
  type GeoEligibleCandidate,
} from './candidateSelection';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type QuizCreationStep = 'scanning' | 'checking' | 'building';

export interface QuizCreationProgress {
  step: QuizCreationStep;
  current?: number;
  total?: number;
}

export type QuizCreationOutcome =
  /** Quiz finalized; awaiting owner play. */
  | { status: 'created'; quizId: string; photoCount: number }
  /** Genuine thin library (AE2). hasGeoCandidates distinguishes "no geotagged
   * travel photos at all" from "photos exist but too few passed the gate". */
  | { status: 'thin-library'; eligibleCount: number; hasGeoCandidates: boolean }
  /** Retryable service failure - DISTINCT from a thin-library decline. */
  | { status: 'service-error'; stage: 'scan' | 'classify' }
  /** Upload/finalize interrupted; a resumable draft is persisted locally. */
  | { status: 'interrupted'; quizId: string; uploadedCount: number; totalCount: number }
  /** Caller aborted; any persisted draft state is left resumable. */
  | { status: 'cancelled' };

export interface CreateQuizOptions {
  onProgress?: (progress: QuizCreationProgress) => void;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Local persistence (photo cache metadata conventions - local and simple)
// ---------------------------------------------------------------------------

const DRAFT_STATE_KEY = 'quiz_draft_state';
const USED_ASSET_IDS_KEY = 'quiz_used_asset_ids';

interface DraftPick {
  assetId: string;
  uri: string;
  countryCode: string;
  captureYear: number | null;
  storagePath: string | null;
  uploaded: boolean;
}

export interface QuizDraftState {
  quizId: string;
  createdAt: number;
  /** Empty until final picks are chosen; uploads flip `uploaded` per photo. */
  picks: DraftPick[];
}

export async function loadDraftState(): Promise<QuizDraftState | null> {
  try {
    const raw = await getMetadata(DRAFT_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as QuizDraftState;
    if (!parsed?.quizId || !Array.isArray(parsed.picks)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function saveDraftState(state: QuizDraftState): Promise<void> {
  await setMetadata(DRAFT_STATE_KEY, JSON.stringify(state));
}

export async function clearDraftState(): Promise<void> {
  await setMetadata(DRAFT_STATE_KEY, '');
}

/** Asset ids already used by the owner's existing quizzes (KTD12). */
export async function getUsedAssetIds(): Promise<Set<string>> {
  try {
    const raw = await getMetadata(USED_ASSET_IDS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

/** Record asset ids as quiz-used (KTD12). Exported for the swap flow. */
export async function markAssetsUsed(assetIds: string[]): Promise<void> {
  const existing = await getUsedAssetIds();
  for (const id of assetIds) existing.add(id);
  await setMetadata(USED_ASSET_IDS_KEY, JSON.stringify([...existing]));
}

/**
 * Discard the current draft server-side AND locally (KTD7 decline path).
 * DELETE /quiz/{id} cascades DB rows; storage object cleanup is the backend's
 * scheduled-deletion seam. Best-effort: a failed delete never blocks the UX.
 */
export async function discardDraft(quizId: string): Promise<void> {
  try {
    await api.delete(`/quiz/${quizId}`);
  } catch {
    // Best-effort: an unreachable server just leaves an orphan draft row.
  }
  await clearDraftState();
}

// ---------------------------------------------------------------------------
// HTTP error classification
// ---------------------------------------------------------------------------

interface HttpErrorLike {
  response?: {
    status?: number;
    data?: { detail?: string | { code?: string } };
  };
}

function httpStatus(error: unknown): number | null {
  const status = (error as HttpErrorLike)?.response?.status;
  return typeof status === 'number' ? status : null;
}

function httpDetailCode(error: unknown): string | null {
  const detail = (error as HttpErrorLike)?.response?.data?.detail;
  if (detail && typeof detail === 'object' && typeof detail.code === 'string') {
    return detail.code;
  }
  return null;
}

/** The server draft no longer exists (owner deleted it / it was purged). */
function isDraftGoneError(error: unknown): boolean {
  return httpStatus(error) === 404;
}

/**
 * The per-draft classification budget is spent (429 with the explicit code).
 * NOT a transport failure: retrying never succeeds, and re-classifying only
 * re-spends budget - the flow must proceed with what is already eligible.
 */
function isBudgetExceededError(error: unknown): boolean {
  return (
    httpStatus(error) === 429 && httpDetailCode(error) === 'QUIZ_CLASSIFICATION_BUDGET_EXCEEDED'
  );
}

// ---------------------------------------------------------------------------
// Photo cache refresh (KTD1)
// ---------------------------------------------------------------------------

/**
 * Bring the SQLite photo cache up to date using the background-sync mechanics:
 * an incremental extract since the last import when a cache exists, or the
 * initial extraction when it does not (fresh install, R7). Skipped entirely
 * when the scan service or background sync already owns the cache.
 */
async function refreshPhotoCache(
  onProgress: ((progress: QuizCreationProgress) => void) | undefined,
  signal: AbortSignal | undefined
): Promise<void> {
  if (isScanRunning() || isBackgroundSyncInProgress()) {
    return; // Another writer owns the cache right now; use it as-is.
  }
  const lastImportTime = await getLastImportTime();
  const newPhotos = await extractPhotosWithLocation(
    (progress) =>
      onProgress?.({ step: 'scanning', current: progress.current, total: progress.total }),
    signal,
    lastImportTime ? new Date(lastImportTime) : undefined
  );
  if (signal?.aborted || newPhotos.length === 0) return;

  await cachePhotos(newPhotos.map((photo) => photoToCachedPhoto(photo)));
  const newestTime = newPhotos.reduce(
    (max, photo) => Math.max(max, photo.creationTime.getTime()),
    0
  );
  await setLastImportTime(newestTime);
}

// ---------------------------------------------------------------------------
// Eligibility classification (R2)
// ---------------------------------------------------------------------------

interface EligibilityResult {
  id: string;
  eligible: boolean;
  status: 'eligible' | 'ineligible' | 'error';
  reason?: string | null;
}

interface EligibilityResponse {
  results: EligibilityResult[];
  classified_count: number;
  budget_remaining: number;
}

type ClassifyBatchResult =
  | { budgetRemaining: number }
  /** Transport/5xx outage - retryable. */
  | 'unavailable'
  /** 404: the server draft is gone - clear the local mirror and start fresh. */
  | 'draft-gone'
  /** 429 budget-exceeded - terminal for classification; build from what we have. */
  | 'budget-exceeded';

/** Bounded concurrency for local thumbnail preparation (I/O + native resize). */
const PREPARE_CONCURRENCY = 6;

/**
 * Send one batch through POST /quiz/eligibility.
 *
 * Every prepared image is marked classified regardless of outcome - attempts
 * consume the server-side budget, so a later resample must target NEW photos.
 * "error" statuses (transport failures inside the vision service) do not
 * produce verdicts; a batch with zero verdicts is a retryable outage.
 */
async function classifyBatch(
  quizId: string,
  batch: GeoEligibleCandidate[],
  classifiedIds: Set<string>,
  eligible: GeoEligibleCandidate[],
  onProgress: ((progress: QuizCreationProgress) => void) | undefined
): Promise<ClassifyBatchResult> {
  const byId = new Map(batch.map((candidate) => [candidate.id, candidate]));
  const images: Array<{ id: string; image_base64: string }> = [];
  let checked = 0;
  for (let start = 0; start < batch.length; start += PREPARE_CONCURRENCY) {
    onProgress?.({ step: 'checking', current: checked, total: batch.length });
    // 768px JPEG thumbnails via the existing vision pipeline (KTD5), prepared
    // a bounded chunk at a time; results keep the batch's candidate order.
    const chunk = batch.slice(start, start + PREPARE_CONCURRENCY);
    const prepared = await Promise.all(chunk.map((candidate) => prepareVisionImage(candidate.uri)));
    checked += chunk.length;
    prepared.forEach((base64, index) => {
      const candidate = chunk[index];
      if (base64) {
        images.push({ id: candidate.id, image_base64: base64 });
      } else {
        // Unreadable locally - never send, never retry within this creation.
        classifiedIds.add(candidate.id);
      }
    });
  }
  if (images.length === 0) {
    return 'unavailable';
  }

  let data: EligibilityResponse;
  try {
    ({ data } = await api.post<EligibilityResponse>('/quiz/eligibility', {
      quiz_id: quizId,
      images,
    }));
  } catch (error) {
    // A 404 (draft gone) or 429 (budget exceeded) is NOT a transport failure:
    // retrying can never succeed, so neither maps to the retryable outage.
    if (isDraftGoneError(error)) return 'draft-gone';
    if (isBudgetExceededError(error)) return 'budget-exceeded';
    return 'unavailable';
  }

  // The server reserved budget for every image sent, so all of them count as
  // classified even when their individual status is "error".
  for (const image of images) classifiedIds.add(image.id);

  let sawVerdict = false;
  for (const result of data.results) {
    if (result.status === 'error') continue;
    sawVerdict = true;
    const candidate = byId.get(result.id);
    if (candidate && result.eligible) {
      eligible.push(candidate);
    }
  }
  onProgress?.({ step: 'checking', current: batch.length, total: batch.length });
  if (!sawVerdict) {
    return 'unavailable';
  }
  return { budgetRemaining: data.budget_remaining };
}

// ---------------------------------------------------------------------------
// Upload preparation (KTD5 - EXIF stripping)
// ---------------------------------------------------------------------------

const QUIZ_UPLOAD_MAX_DIMENSION = 2048;
const QUIZ_UPLOAD_JPEG_QUALITY = 0.8;

/**
 * Prepare a final quiz photo for upload.
 *
 * ALWAYS re-encodes through expo-image-manipulator - no pass-through for
 * already-small images (unlike `resizeImageForUpload` in mediaUpload.ts).
 * The manipulator's native save serializes pixels only (`UIImage.jpegData` on
 * iOS, `Bitmap.compress` on Android), so the output carries no EXIF GPS; the
 * unconditional re-encode is the explicit strip.
 */
export async function prepareQuizUploadImage(uri: string): Promise<string> {
  // Inline require keeps the native module off the boot path (mirrors visionPhoto).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { manipulateAsync, SaveFormat } = require('expo-image-manipulator');

  let actions: Array<{ resize: { width?: number; height?: number } }> = [];
  try {
    const { width, height } = await getImageDimensions(uri);
    if (Math.max(width, height) > QUIZ_UPLOAD_MAX_DIMENSION) {
      actions = [
        {
          resize:
            width >= height
              ? { width: QUIZ_UPLOAD_MAX_DIMENSION }
              : { height: QUIZ_UPLOAD_MAX_DIMENSION },
        },
      ];
    }
  } catch {
    // Dimension probe failed: re-encode without resizing (strip still applies).
  }

  const result = await manipulateAsync(uri, actions, {
    format: SaveFormat.JPEG,
    compress: QUIZ_UPLOAD_JPEG_QUALITY,
  });
  return result.uri as string;
}

// ---------------------------------------------------------------------------
// Upload + finalize (resumable - KTD7)
// ---------------------------------------------------------------------------

interface QuizUploadTarget {
  storage_path: string;
  upload_url: string;
  cache_control: string;
}

function interruptedOutcome(state: QuizDraftState): QuizCreationOutcome {
  return {
    status: 'interrupted',
    quizId: state.quizId,
    uploadedCount: state.picks.filter((pick) => pick.uploaded).length,
    totalCount: state.picks.length,
  };
}

/**
 * Upload the not-yet-uploaded picks via quiz signed URLs, then finalize.
 * Progress is persisted after every successful upload so resuming skips
 * completed photos (KTD7). Returns 'draft-gone' when the server draft no
 * longer exists (404 minting upload URLs or finalizing) - the caller clears
 * the local mirror and starts a fresh creation instead of retry-looping.
 */
async function uploadAndFinalize(
  state: QuizDraftState,
  onProgress: ((progress: QuizCreationProgress) => void) | undefined,
  signal: AbortSignal | undefined
): Promise<QuizCreationOutcome | 'draft-gone'> {
  const total = state.picks.length;
  const reportBuilding = () =>
    onProgress?.({
      step: 'building',
      current: state.picks.filter((pick) => pick.uploaded).length,
      total,
    });
  reportBuilding();

  const pending = state.picks.filter((pick) => !pick.uploaded);
  if (pending.length > 0) {
    let uploads: QuizUploadTarget[];
    try {
      const { data } = await api.post<{ uploads: QuizUploadTarget[] }>(
        `/quiz/${state.quizId}/upload-urls`,
        { count: pending.length }
      );
      uploads = data.uploads;
    } catch (error) {
      if (isDraftGoneError(error)) return 'draft-gone';
      return interruptedOutcome(state);
    }

    for (let index = 0; index < pending.length; index++) {
      if (signal?.aborted) {
        return { status: 'cancelled' };
      }
      const pick = pending[index];
      const target = uploads[index];
      try {
        const preparedUri = await prepareQuizUploadImage(pick.uri);
        const response = await expoFetch(target.upload_url, {
          method: 'PUT',
          headers: {
            'Content-Type': 'image/jpeg',
            // KTD5: the server-directed cacheControl MUST accompany the signed
            // upload (Supabase reads it as `cache-control: max-age=<value>`).
            'cache-control': `max-age=${target.cache_control}`,
          },
          body: new ExpoFile(preparedUri),
        });
        if (!response.ok) {
          throw new Error(`Upload failed with status ${response.status}`);
        }
        pick.uploaded = true;
        pick.storagePath = target.storage_path;
        await saveDraftState(state);
        reportBuilding();
      } catch (error) {
        console.warn(
          '[QuizCreation] Photo upload failed:',
          error instanceof Error ? error.message : error
        );
        await saveDraftState(state);
        return interruptedOutcome(state);
      }
    }
  }

  try {
    await api.post(`/quiz/${state.quizId}/finalize`, {
      photos: state.picks.map((pick) => ({
        storage_path: pick.storagePath,
        country_code: pick.countryCode,
        capture_year: pick.captureYear,
      })),
    });
  } catch (error) {
    console.warn('[QuizCreation] Finalize failed:', error instanceof Error ? error.message : error);
    if (isDraftGoneError(error)) return 'draft-gone';
    return interruptedOutcome(state);
  }

  await markAssetsUsed(state.picks.map((pick) => pick.assetId));
  await clearDraftState();
  return { status: 'created', quizId: state.quizId, photoCount: state.picks.length };
}

// ---------------------------------------------------------------------------
// Main orchestration
// ---------------------------------------------------------------------------

/**
 * Build a quiz from the photo library, end to end.
 *
 * Resumable: when a persisted draft already carries final picks, this skips
 * straight to the remaining uploads + finalize without re-uploading completed
 * photos. A persisted draft WITHOUT picks (e.g. a classifier retry) reuses
 * the server draft id so retries do not burn the draft-creation rate limit.
 */
export async function createQuizFromLibrary(
  options: CreateQuizOptions = {}
): Promise<QuizCreationOutcome> {
  return runQuizCreation(options, false);
}

/**
 * The one draft-gone path (shared by eligibility, upload-urls, and finalize
 * 404s): the persisted draft references a server draft that no longer exists
 * (e.g. the owner deleted it from My Quizzes), so resuming it can only 404
 * forever. Clear the local mirror and start ONE fresh creation; a second
 * draft-gone in the same run is a genuine server anomaly - surface retryable.
 */
async function restartAfterDraftGone(
  options: CreateQuizOptions,
  alreadyRestarted: boolean
): Promise<QuizCreationOutcome> {
  await clearDraftState();
  if (alreadyRestarted) {
    return { status: 'service-error', stage: 'classify' };
  }
  return runQuizCreation(options, true);
}

async function runQuizCreation(
  options: CreateQuizOptions,
  restartedAfterDraftGone: boolean
): Promise<QuizCreationOutcome> {
  const { onProgress, signal } = options;

  const persisted = await loadDraftState();
  if (persisted && persisted.picks.length > 0) {
    const outcome = await uploadAndFinalize(persisted, onProgress, signal);
    if (outcome === 'draft-gone') {
      return restartAfterDraftGone(options, restartedAfterDraftGone);
    }
    return outcome;
  }

  // Step 1: bring the photo cache up to date (KTD1).
  onProgress?.({ step: 'scanning' });
  let cached: CachedPhoto[];
  try {
    await refreshPhotoCache(onProgress, signal);
    if (signal?.aborted) return { status: 'cancelled' };
    cached = await getAllCachedPhotos();
  } catch {
    // A failed refresh with an existing cache degrades to stale candidates;
    // with no cache at all there is nothing to build from - retryable.
    cached = await getAllCachedPhotos().catch(() => []);
    if (cached.length === 0) {
      return { status: 'service-error', stage: 'scan' };
    }
  }
  if (signal?.aborted) return { status: 'cancelled' };

  const [countries, usedAssetIds] = await Promise.all([getAllCountries(), getUsedAssetIds()]);
  const validCodes = new Set(countries.map((country) => country.code));
  const pool = cached.map(toCandidate);

  // Step 2: select the first candidate batch (KTD2 + KTD3).
  const firstBatch = selectEligibilityBatch({
    pool,
    validCodes,
    coder: iso1A2Code,
    usedAssetIds,
    limit: FIRST_BATCH_MAX,
  });
  if (firstBatch.length === 0) {
    if (persisted) await discardDraft(persisted.quizId);
    return { status: 'thin-library', eligibleCount: 0, hasGeoCandidates: false };
  }

  // Step 3: server draft (reuse a persisted id so retries stay cheap).
  let quizId = persisted?.quizId ?? null;
  if (!quizId) {
    try {
      const { data } = await api.post<{ id: string; state: string }>('/quiz');
      quizId = data.id;
    } catch {
      return { status: 'service-error', stage: 'classify' };
    }
    await saveDraftState({ quizId, createdAt: Date.now(), picks: [] });
  }

  // Step 4: vision eligibility (R2), with one resample pass (KTD3).
  const classifiedIds = new Set<string>();
  const eligible: GeoEligibleCandidate[] = [];
  const firstResult = await classifyBatch(quizId, firstBatch, classifiedIds, eligible, onProgress);
  if (firstResult === 'unavailable') {
    return { status: 'service-error', stage: 'classify' };
  }
  if (firstResult === 'draft-gone') {
    return restartAfterDraftGone(options, restartedAfterDraftGone);
  }
  if (signal?.aborted) return { status: 'cancelled' };

  // Budget exhaustion is terminal for classification (never retryable):
  // skip the resample and build from whatever is already eligible - the
  // minimum-photos check below turns "not enough" into the guided decline.
  if (firstResult !== 'budget-exceeded' && eligible.length < QUIZ_MIN_PHOTOS) {
    const budgetRemaining = Math.min(
      firstResult.budgetRemaining,
      CLASSIFICATION_BUDGET_PER_QUIZ - classifiedIds.size
    );
    const resampleLimit = Math.min(RESAMPLE_BATCH_MAX, budgetRemaining);
    if (resampleLimit > 0) {
      const classifiedCountries = new Set(firstBatch.map((candidate) => candidate.countryCode));
      const resampleBatch = selectEligibilityBatch({
        pool,
        validCodes,
        coder: iso1A2Code,
        usedAssetIds,
        excludeIds: classifiedIds,
        deprioritizedCountries: classifiedCountries,
        limit: resampleLimit,
      });
      if (resampleBatch.length > 0) {
        const resampleResult = await classifyBatch(
          quizId,
          resampleBatch,
          classifiedIds,
          eligible,
          onProgress
        );
        if (resampleResult === 'draft-gone') {
          return restartAfterDraftGone(options, restartedAfterDraftGone);
        }
        if (resampleResult === 'unavailable' && eligible.length < QUIZ_MIN_PHOTOS) {
          return { status: 'service-error', stage: 'classify' };
        }
        // 'budget-exceeded' falls through: proceed with the eligible photos.
      }
    }
  }
  if (signal?.aborted) return { status: 'cancelled' };

  if (eligible.length < QUIZ_MIN_PHOTOS) {
    // Genuine decline (AE2): the draft is deleted, not left dangling (KTD7).
    await discardDraft(quizId);
    return { status: 'thin-library', eligibleCount: eligible.length, hasGeoCandidates: true };
  }

  // Step 5: final picks (R1 spread, KTD12 freshness) and resumable state.
  const picks = pickQuizPhotos(eligible, usedAssetIds);
  const state: QuizDraftState = {
    quizId,
    createdAt: persisted?.createdAt ?? Date.now(),
    picks: picks.map((pick) => ({
      assetId: pick.id,
      uri: pick.uri,
      countryCode: pick.countryCode,
      captureYear: pick.creationTime > 0 ? new Date(pick.creationTime).getFullYear() : null,
      storagePath: null,
      uploaded: false,
    })),
  };
  await saveDraftState(state);

  // Step 6: upload + finalize (resumable).
  const outcome = await uploadAndFinalize(state, onProgress, signal);
  if (outcome === 'draft-gone') {
    return restartAfterDraftGone(options, restartedAfterDraftGone);
  }
  return outcome;
}
