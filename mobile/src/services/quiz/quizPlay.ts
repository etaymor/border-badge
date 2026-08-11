/**
 * Owner play-session persistence and swap machinery (Travel Photo Quiz U5).
 *
 * Resume (R4): the backend grades each answer server-side but exposes no
 * endpoint to read a session's recorded answers back, so the owner's play
 * session (session id + every graded verdict) is persisted locally alongside
 * the photo-cache metadata - the same store the U4 draft state uses. Killing
 * the app mid-play resumes from the last graded question by replaying this
 * state, not by re-grading anything.
 *
 * Swap (R5): a pre-share swap uploads the replacement photo through the quiz
 * signed-upload flow (EXIF-stripped via the same re-encode as creation), calls
 * the swap endpoint, and drops the swapped question's stored answer so the
 * owner is forced back through play for that photo before sharing.
 */

import { File as ExpoFile } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';

import { api } from '@services/api';
import { getAllCountries } from '@services/countriesDb';
import { iso1A2Code } from '@services/photoImport/countryCoder';
import { getAllCachedPhotos, getMetadata, setMetadata } from '@services/photoImport/photoCacheDb';
import type { CachedPhoto } from '@services/photoImport/types';

import { selectEligibilityBatch, type GeoEligibleCandidate } from './candidateSelection';
import { getUsedAssetIds, markAssetsUsed, prepareQuizUploadImage } from './quizCreation';

// ---------------------------------------------------------------------------
// Persisted play state
// ---------------------------------------------------------------------------

const PLAY_STATE_KEY = 'quiz_play_state';

/** One graded verdict, as revealed by POST /quiz/{id}/answer. */
export interface StoredQuizAnswer {
  questionId: string;
  selectedOptionIndex: number;
  selectedYear: number | null;
  placeCorrect: boolean;
  yearCorrect: boolean | null;
  correctOptionIndex: number;
  correctOption: string;
  correctYear: number | null;
}

export interface QuizPlayState {
  quizId: string;
  sessionId: string;
  /** Keyed by question id. Presence = graded server-side already. */
  answers: Record<string, StoredQuizAnswer>;
}

export async function loadPlayState(quizId: string): Promise<QuizPlayState | null> {
  try {
    const raw = await getMetadata(PLAY_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as QuizPlayState;
    if (
      parsed?.quizId !== quizId ||
      !parsed.sessionId ||
      typeof parsed.answers !== 'object' ||
      parsed.answers === null
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function savePlayState(state: QuizPlayState): Promise<void> {
  await setMetadata(PLAY_STATE_KEY, JSON.stringify(state));
}

/**
 * Return the persisted session for this quiz, or start a fresh owner session
 * via POST /quiz/{id}/play. The FIRST session is the one that seeds the
 * score-to-beat and receives post-swap answers, so it must survive restarts.
 */
export async function ensurePlaySession(quizId: string): Promise<QuizPlayState> {
  const existing = await loadPlayState(quizId);
  if (existing) return existing;
  const { data } = await api.post<{ session_id: string }>(`/quiz/${quizId}/play`);
  const state: QuizPlayState = { quizId, sessionId: data.session_id, answers: {} };
  await savePlayState(state);
  return state;
}

/** Persist one graded verdict; returns the new state (input is not mutated). */
export async function recordAnswer(
  state: QuizPlayState,
  answer: StoredQuizAnswer
): Promise<QuizPlayState> {
  const next: QuizPlayState = {
    ...state,
    answers: { ...state.answers, [answer.questionId]: answer },
  };
  await savePlayState(next);
  return next;
}

/**
 * Drop a question's stored answer after a swap or remove - the server deleted
 * its quiz_answer rows, so the local mirror must forget the verdict too.
 */
export async function clearStoredAnswer(quizId: string, questionId: string): Promise<void> {
  const state = await loadPlayState(quizId);
  if (!state || !(questionId in state.answers)) return;
  const answers = { ...state.answers };
  delete answers[questionId];
  await savePlayState({ ...state, answers });
}

// ---------------------------------------------------------------------------
// Swap candidates + upload (R5)
// ---------------------------------------------------------------------------

/** Picker size cap: plenty of choice without walking the whole library. */
export const SWAP_CANDIDATE_LIMIT = 30;

function toCandidate(cached: CachedPhoto) {
  return {
    id: cached.id,
    uri: cached.uri,
    creationTime: cached.creationTime,
    latitude: cached.latitude,
    longitude: cached.longitude,
    countryCode: cached.countryCode,
  };
}

/**
 * Geo-eligible swap candidates from the photo cache, reusing the U4 selection
 * machinery: country spread, border-ambiguity exclusion, and used-photo
 * deprioritization (already-used assets sort strictly after fresh ones -
 * which also pushes this quiz's own photos to the back of the picker).
 *
 * Note: these candidates have passed the geo gate only - the vision
 * eligibility budget belongs to the 'building' state and is not re-spent on
 * swaps.
 */
export async function loadSwapCandidates(): Promise<GeoEligibleCandidate[]> {
  const [cached, countries, usedAssetIds] = await Promise.all([
    getAllCachedPhotos(),
    getAllCountries(),
    getUsedAssetIds(),
  ]);
  const validCodes = new Set(countries.map((country) => country.code));
  return selectEligibilityBatch({
    pool: cached.map(toCandidate),
    validCodes,
    coder: iso1A2Code,
    usedAssetIds,
    limit: SWAP_CANDIDATE_LIMIT,
  });
}

export interface SwapUploadResult {
  storagePath: string;
  countryCode: string;
  captureYear: number | null;
}

/**
 * Upload a replacement photo for a swap: mint one signed quiz upload slot,
 * re-encode the image (EXIF GPS strip - same pipeline as creation), PUT it,
 * and mark the asset used (KTD12). The caller sends the returned ground truth
 * to POST /quiz/{id}/questions/{qid}/swap.
 */
export async function uploadSwapPhoto(
  quizId: string,
  candidate: GeoEligibleCandidate
): Promise<SwapUploadResult> {
  const { data } = await api.post<{
    uploads: Array<{ storage_path: string; upload_url: string; cache_control: string }>;
  }>(`/quiz/${quizId}/upload-urls`, { count: 1 });
  const target = data.uploads[0];
  if (!target) {
    throw new Error('No upload slot returned for swap');
  }

  const preparedUri = await prepareQuizUploadImage(candidate.uri);
  const response = await expoFetch(target.upload_url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'image/jpeg',
      'cache-control': `max-age=${target.cache_control}`,
    },
    body: new ExpoFile(preparedUri),
  });
  if (!response.ok) {
    throw new Error(`Swap upload failed with status ${response.status}`);
  }

  await markAssetsUsed([candidate.id]);
  return {
    storagePath: target.storage_path,
    countryCode: candidate.countryCode,
    captureYear: candidate.creationTime > 0 ? new Date(candidate.creationTime).getFullYear() : null,
  };
}
