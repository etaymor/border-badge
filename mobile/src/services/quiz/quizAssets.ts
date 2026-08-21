/**
 * Per-quiz asset-id record (BUG-2).
 *
 * The server never returns library asset ids for a finalized quiz, so the
 * mapping quiz -> asset ids only exists client-side. It is written at finalize
 * (all picks) and appended on every swap, and read by the swap picker to keep
 * a quiz's own photos - and their near-duplicates - out of the candidates.
 *
 * Ids are only ever appended: a swapped-out photo stays recorded, which is
 * intentional (it was part of this quiz once and should not be re-offered).
 */

import { getMetadata, setMetadata } from '@services/photoImport/photoCacheDb';

const QUIZ_ASSETS_KEY_PREFIX = 'quiz_assets:';

function quizAssetsKey(quizId: string): string {
  return `${QUIZ_ASSETS_KEY_PREFIX}${quizId}`;
}

export async function getQuizAssetIds(quizId: string): Promise<Set<string>> {
  try {
    const raw = await getMetadata(quizAssetsKey(quizId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

export async function recordQuizAssets(quizId: string, assetIds: string[]): Promise<void> {
  const existing = await getQuizAssetIds(quizId);
  for (const id of assetIds) existing.add(id);
  await setMetadata(quizAssetsKey(quizId), JSON.stringify([...existing]));
}
