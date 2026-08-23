/**
 * Travel photo quiz hooks.
 *
 * Follows the useTrips conventions: module-level query key, STALE_TIMES for
 * staleness, scoped invalidation targeting only the affected quiz. Unlike the
 * trip mutations, errors do NOT raise Alerts here - QuizCreationScreen owns
 * every outcome surface (decline, retry, resume) itself.
 */

import { Alert } from 'react-native';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Analytics } from '@services/analytics';
import { api } from '@services/api';
import { clearStoredAnswer, uploadSwapPhoto } from '@services/quiz/quizPlay';
import { clearDraftState, loadDraftState } from '@services/quiz/quizCreation';
import type { GeoEligibleCandidate } from '@services/quiz/candidateSelection';
import { STALE_TIMES } from '../queryClient';

// Question payload matching backend QuizQuestionPayload (no ground truth).
export interface QuizQuestion {
  id: string;
  position: number;
  image_url: string;
  options: string[];
}

export interface QuizScoreToBeat {
  correct: number;
  total: number;
}

// Quiz detail matching backend QuizDetailResponse.
export interface QuizDetail {
  id: string;
  state: string;
  questions: QuizQuestion[];
  score_to_beat?: QuizScoreToBeat | null;
  slug?: string | null;
  share_url?: string | null;
}

export const QUIZZES_QUERY_KEY = ['quizzes'];
// The management-surface list. Lives under the quizzes namespace but with its
// own segment so per-quiz invalidations (['quizzes', quizId]) never have to
// refetch the whole list, and vice versa.
export const QUIZ_LIST_QUERY_KEY = [...QUIZZES_QUERY_KEY, 'list'];

// One owned quiz in the management list; matches backend QuizSummary.
export interface QuizSummary {
  id: string;
  state: string;
  slug?: string | null;
  share_url?: string | null;
  score_to_beat?: QuizScoreToBeat | null;
  /** Public URL of the first question's photo; null while a draft has none. */
  cover_image_url?: string | null;
  question_count: number;
  created_at: string;
  revoked_at?: string | null;
}

// Every quiz the owner has, newest first (the management surface).
export function useMyQuizzes() {
  return useQuery({
    queryKey: QUIZ_LIST_QUERY_KEY,
    queryFn: async (): Promise<QuizSummary[]> => {
      const response = await api.get('/quiz');
      return response.data.quizzes;
    },
    staleTime: STALE_TIMES.USER_DATA, // 5 minutes
    gcTime: 1000 * 60 * 30, // 30 minutes
  });
}

// Fetch one quiz (owner detail view).
export function useQuiz(quizId: string | undefined) {
  return useQuery({
    queryKey: [...QUIZZES_QUERY_KEY, quizId],
    queryFn: async (): Promise<QuizDetail> => {
      const response = await api.get(`/quiz/${quizId}`);
      return response.data;
    },
    enabled: !!quizId,
    staleTime: STALE_TIMES.USER_DATA, // 5 minutes
    gcTime: 1000 * 60 * 30, // 30 minutes
  });
}

/**
 * There is deliberately NO `useCreateQuiz` here.
 *
 * A React mutation is OWNED by the component that fires it, so unmounting the
 * creation screen aborted the build — up to 90 seconds of hunting and up to
 * `CLASSIFICATION_BUDGET_PER_QUIZ` classified images, thrown away because the
 * user tapped away. Ownership now lives in the `quiz-build` library job; the
 * screen is a view onto it. Use `useQuizBuildJob`.
 */

// ---------------------------------------------------------------------------
// Owner play, pre-share editing, and share
// ---------------------------------------------------------------------------

// Matches backend QuizAnswerResponse (the ground truth revealed by grading).
export interface QuizAnswerResult {
  place_correct: boolean;
  correct_option_index: number;
  correct_option: string;
  score: number;
}

// Matches backend QuizCompleteResponse. The country score is the only score:
// there is no second, private one (AE3).
export interface QuizCompleteResult {
  correct: number;
  total: number;
  score_to_beat: QuizScoreToBeat;
  state: string;
}

// Matches backend QuizShareResponse.
export interface QuizShareResult {
  slug: string;
  share_url: string;
  state: string;
}

export interface QuizAnswerInput {
  sessionId: string;
  questionId: string;
  selectedOptionIndex: number;
}

/**
 * Grade one owner answer. The backend grades each question at most once per
 * session; the screen persists the verdict via `recordAnswer`.
 */
export function useAnswerQuizQuestion(quizId: string) {
  return useMutation({
    mutationFn: async (input: QuizAnswerInput): Promise<QuizAnswerResult> => {
      const response = await api.post(`/quiz/${quizId}/answer`, {
        session_id: input.sessionId,
        question_id: input.questionId,
        selected_option_index: input.selectedOptionIndex,
      });
      return response.data;
    },
  });
}

/**
 * Complete the owner play-through. The first completion seeds the
 * score-to-beat server-side; the response carries the owner-only memory score.
 */
export function useCompleteQuizPlay(quizId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string): Promise<QuizCompleteResult> => {
      const response = await api.post(`/quiz/${quizId}/complete`, { session_id: sessionId });
      return response.data;
    },
    onSuccess: (results) => {
      // Funnel: the owner completed their own play-through (guest plays are
      // web-only and counted server-side, so this path is owner-scoped).
      Analytics.quizFirstRunCompleted({
        quizId,
        correct: results.correct,
        total: results.total,
      });
      // The quiz row changed (state + seeded pair): refresh the detail and
      // the management list's state label.
      queryClient.invalidateQueries({ queryKey: [...QUIZZES_QUERY_KEY, quizId] });
      queryClient.invalidateQueries({ queryKey: QUIZ_LIST_QUERY_KEY });
    },
  });
}

/**
 * Swap a question's photo pre-share (R5): upload the replacement through the
 * quiz signed-upload flow, call the swap endpoint, and drop the local stored
 * answer so play resumes at the new photo (share stays blocked until then).
 */
export function useSwapQuizQuestion(quizId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      questionId: string;
      candidate: GeoEligibleCandidate;
    }): Promise<QuizDetail> => {
      const upload = await uploadSwapPhoto(quizId, input.candidate);
      const response = await api.post(`/quiz/${quizId}/questions/${input.questionId}/swap`, {
        storage_path: upload.storagePath,
        country_code: upload.countryCode,
        // Only present when a cached eligibility verdict supplied one; the
        // server normalizes an unknown value back to null.
        landscape: upload.landscape,
      });
      await clearStoredAnswer(quizId, input.questionId);
      return response.data;
    },
    onSuccess: (detail) => {
      queryClient.setQueryData([...QUIZZES_QUERY_KEY, quizId], detail);
    },
  });
}

/** Remove a question pre-share (R5); the backend rescales the seeded pair. */
export function useRemoveQuizQuestion(quizId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (questionId: string): Promise<QuizDetail> => {
      const response = await api.delete(`/quiz/${quizId}/questions/${questionId}`);
      await clearStoredAnswer(quizId, questionId);
      return response.data;
    },
    onSuccess: (detail) => {
      queryClient.setQueryData([...QUIZZES_QUERY_KEY, quizId], detail);
    },
  });
}

/** Mint the share slug (R6). Idempotent for an already-shared quiz. */
export function useShareQuiz(quizId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<QuizShareResult> => {
      const response = await api.post(`/quiz/${quizId}/share`);
      return response.data;
    },
    onSuccess: () => {
      // Funnel: quiz shared (the link now exists in the wild).
      Analytics.quizShared({ quizId });
      // State moved to 'shared': the detail drives the edit affordances, the
      // list shows the new state, and the leaderboard (keyed under the quiz)
      // refetches with the live board.
      queryClient.invalidateQueries({ queryKey: [...QUIZZES_QUERY_KEY, quizId] });
      queryClient.invalidateQueries({ queryKey: QUIZ_LIST_QUERY_KEY });
    },
  });
}

// Matches backend QuizRevokeResponse. `objects_deleted` is true only once
// the quiz's storage prefix has been verifiably emptied server-side; false
// means revoked-but-pending (the backend retries on the next owner action).
export interface QuizRevokeResult {
  state: string;
  revoked_at: string;
  objects_deleted: boolean;
}

/**
 * The shared revoke confirmation (R15): the honest disclosure -- the link and
 * photos stop serving within about a minute (60s object TTL on the photo
 * edges), but link previews already delivered to messaging apps live in those
 * apps' caches and may persist there. `onConfirm` runs only when the owner
 * confirms.
 */
export function confirmRevokeQuiz(onConfirm: () => void): void {
  Alert.alert(
    'Revoke share link?',
    'The link stops working and your quiz photos are deleted from our servers. ' +
      'Photos already loaded elsewhere expire within about a minute, but link ' +
      'previews already delivered to messaging apps may persist in those apps.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revoke Link', style: 'destructive', onPress: onConfirm },
    ]
  );
}

/**
 * Revoke a shared quiz (R15). The share link, public API, and card image
 * stop serving the moment the call commits; photo deletion at the origin is
 * verified server-side. Calling revoke again on an already-revoked quiz is
 * the explicit retry for a pending photo sweep.
 */
export function useRevokeQuiz(quizId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<QuizRevokeResult> => {
      const response = await api.post(`/quiz/${quizId}/revoke`);
      return response.data;
    },
    onSuccess: () => {
      // Funnel: quiz revoked (the loop closed early for this link).
      Analytics.quizRevoked({ quizId });
      // State moved to 'revoked': the detail drives the share affordances,
      // and the list + leaderboard (both under the quizzes namespace) follow.
      queryClient.invalidateQueries({ queryKey: [...QUIZZES_QUERY_KEY, quizId] });
      queryClient.invalidateQueries({ queryKey: QUIZ_LIST_QUERY_KEY });
    },
  });
}

// Delete a quiz draft (used when the owner explicitly discards a creation).
export function useDeleteQuiz() {
  const queryClient = useQueryClient();

  return useMutation({
    // The lifecycle state rides along purely so the event can carry it; the
    // caller always has it, and reading it back off the cache after the row is
    // gone would be a race.
    mutationFn: async ({ quizId }: { quizId: string; state: string }): Promise<string> => {
      await api.delete(`/quiz/${quizId}`);
      // If the deleted quiz IS the locally persisted creation draft, drop
      // that mirror too - otherwise the next creation would resume a
      // server-deleted draft and 404 on every call.
      const draft = await loadDraftState();
      if (draft?.quizId === quizId) {
        await clearDraftState();
      }
      return quizId;
    },
    onSuccess: (quizId, variables) => {
      // Counterpart to quizRevoked: without this, the two ways a challenge
      // leaves the list are counted asymmetrically.
      Analytics.quizDeleted({ quizId, state: variables.state });
      queryClient.invalidateQueries({ queryKey: [...QUIZZES_QUERY_KEY, quizId] });
      queryClient.invalidateQueries({ queryKey: QUIZ_LIST_QUERY_KEY });
    },
  });
}

// ---------------------------------------------------------------------------
// Owner leaderboard (R14)
// ---------------------------------------------------------------------------

// Matches backend QuizOwnerLeaderboardEntry: one aggregated row per name
// (AE4), with the sessions behind it so the owner can hide the lot.
export interface QuizOwnerLeaderboardEntry {
  display_name: string;
  best_score: number;
  attempts: number;
  /** True when the entry no longer surfaces on the public leaderboard. */
  hidden: boolean;
  session_ids: string[];
}

// Matches backend QuizOwnerLeaderboardResponse.
export interface QuizOwnerLeaderboard {
  score_to_beat?: QuizScoreToBeat | null;
  leaderboard: QuizOwnerLeaderboardEntry[];
}

/**
 * The owner's view of a quiz's leaderboard, hidden entries included (marked).
 * Keyed under ['quizzes', quizId], so the share/revoke invalidations above
 * refresh it automatically.
 */
export function useQuizLeaderboard(quizId: string | undefined) {
  return useQuery({
    queryKey: [...QUIZZES_QUERY_KEY, quizId, 'leaderboard'],
    queryFn: async (): Promise<QuizOwnerLeaderboard> => {
      const response = await api.get(`/quiz/${quizId}/leaderboard`);
      return response.data;
    },
    enabled: !!quizId,
    // Always refetch on mount: a just-hidden entry or fresh plays must show.
    staleTime: 0,
    gcTime: 1000 * 60 * 30, // 30 minutes
  });
}

/**
 * Hide a leaderboard entry (owner moderation): the backend hide endpoint is
 * per-session, so hiding an entry means hiding every session folded into it.
 * Hidden sessions stay visible to the owner, marked.
 */
export function useHideQuizSessions(quizId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionIds: string[]): Promise<void> => {
      // Idempotent, order-independent flag writes: hide them all in parallel.
      await Promise.all(
        sessionIds.map((sessionId) => api.post(`/quiz/${quizId}/sessions/${sessionId}/hide`))
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [...QUIZZES_QUERY_KEY, quizId, 'leaderboard'],
      });
    },
  });
}
