/**
 * Local persistence for the Guess Where creation draft (KTD7/KTD12).
 *
 * Two records, both kept in the photo-cache metadata table (the same store the
 * play state uses):
 * - the resumable draft: which photos were picked and which already uploaded,
 *   so an interrupted creation resumes without re-uploading anything
 * - the used-asset ledger: asset ids already spent on a quiz, so repeat
 *   creations prefer photos the owner has not challenged anyone with yet
 */

import { api } from '@services/api';
import { getMetadata, setMetadata } from '@services/photoImport/photoCacheDb';

import type { QuizDraftState } from './quizCreationTypes';

const DRAFT_STATE_KEY = 'quiz_draft_state';
const USED_ASSET_IDS_KEY = 'quiz_used_asset_ids';

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

export async function saveDraftState(state: QuizDraftState): Promise<void> {
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
