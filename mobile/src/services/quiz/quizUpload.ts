/**
 * Upload + finalize for a built quiz (KTD5/KTD7).
 *
 * Resumable by construction: the draft is persisted after every successful
 * upload, so an interruption anywhere in the loop resumes without re-sending a
 * single photo. Only the caller decides what an interruption means to the UI -
 * this returns the outcome and never throws.
 */

import { File as ExpoFile } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';

import { api } from '@services/api';

import { clearDraftState, markAssetsUsed, saveDraftState } from './quizDraftStore';
import { isDraftGoneError } from './quizHttpErrors';
import { prepareQuizUploadImageForPick } from './quizImagePrep';
import { recordQuizAssets } from './quizAssets';

import type {
  QuizCreationOutcome,
  QuizCreationProgress,
  QuizDraftState,
} from './quizCreationTypes';

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
export async function uploadAndFinalize(
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
        const preparedUri = await prepareQuizUploadImageForPick(pick);
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
        landscape: pick.landscape ?? null,
      })),
    });
  } catch (error) {
    console.warn('[QuizCreation] Finalize failed:', error instanceof Error ? error.message : error);
    if (isDraftGoneError(error)) return 'draft-gone';
    return interruptedOutcome(state);
  }

  await markAssetsUsed(state.picks.map((pick) => pick.assetId));
  // Remember which assets THIS quiz uses - the server never returns asset
  // ids, and the swap picker needs them to exclude the quiz's own photos.
  await recordQuizAssets(
    state.quizId,
    state.picks.map((pick) => pick.assetId)
  );
  await clearDraftState();
  return { status: 'created', quizId: state.quizId, photoCount: state.picks.length };
}
