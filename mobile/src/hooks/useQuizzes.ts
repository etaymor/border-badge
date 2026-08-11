/**
 * Travel photo quiz hooks.
 *
 * Follows the useTrips conventions: module-level query key, STALE_TIMES for
 * staleness, scoped invalidation targeting only the affected quiz. Unlike the
 * trip mutations, errors do NOT raise Alerts here - QuizCreationScreen owns
 * every outcome surface (decline, retry, resume) itself.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@services/api';
import { clearStoredAnswer, uploadSwapPhoto } from '@services/quiz/quizPlay';
import {
  createQuizFromLibrary,
  type CreateQuizOptions,
  type QuizCreationOutcome,
} from '@services/quiz/quizCreation';
import type { GeoEligibleCandidate } from '@services/quiz/candidateSelection';
import { STALE_TIMES } from '../queryClient';

// Question payload matching backend QuizQuestionPayload (no ground truth).
export interface QuizQuestion {
  id: string;
  position: number;
  image_url: string;
  options: string[];
  year_options?: number[] | null;
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

const QUIZZES_QUERY_KEY = ['quizzes'];

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
 * Build a quiz from the photo library (draft -> eligibility -> upload ->
 * finalize). The mutation resolves with a QuizCreationOutcome for every
 * business result (created / thin-library / interrupted / ...); it only
 * rejects on unexpected errors.
 */
export function useCreateQuiz() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (options?: CreateQuizOptions): Promise<QuizCreationOutcome> =>
      createQuizFromLibrary(options),
    onSuccess: (outcome) => {
      if (outcome.status === 'created') {
        // Scoped invalidation: only the newly created quiz's detail query.
        queryClient.invalidateQueries({ queryKey: [...QUIZZES_QUERY_KEY, outcome.quizId] });
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Owner play, pre-share editing, and share
// ---------------------------------------------------------------------------

// Matches backend QuizAnswerResponse (the ground truth revealed by grading).
export interface QuizAnswerResult {
  place_correct: boolean;
  year_correct?: boolean | null;
  correct_option_index: number;
  correct_option: string;
  correct_year?: number | null;
  score: number;
}

// Matches backend QuizCompleteResponse. The memory (year) score exists ONLY
// in this owner-facing payload - it is never stored nor served publicly (AE3).
export interface QuizCompleteResult {
  correct: number;
  total: number;
  memory_correct: number;
  memory_total: number;
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
  /** null when the question has no year sub-question or none was picked. */
  selectedYear: number | null;
}

/**
 * Grade one owner answer (country + year in a SINGLE call - the backend
 * grades each question at most once per session, so both picks travel
 * together). The screen persists the verdict via `recordAnswer`.
 */
export function useAnswerQuizQuestion(quizId: string) {
  return useMutation({
    mutationFn: async (input: QuizAnswerInput): Promise<QuizAnswerResult> => {
      const response = await api.post(`/quiz/${quizId}/answer`, {
        session_id: input.sessionId,
        question_id: input.questionId,
        selected_option_index: input.selectedOptionIndex,
        selected_year: input.selectedYear,
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
    onSuccess: () => {
      // The quiz row changed (state + seeded pair): refresh the detail.
      queryClient.invalidateQueries({ queryKey: [...QUIZZES_QUERY_KEY, quizId] });
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
        capture_year: upload.captureYear,
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
      // State moved to 'shared': the detail drives the edit affordances.
      queryClient.invalidateQueries({ queryKey: [...QUIZZES_QUERY_KEY, quizId] });
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
      // State moved to 'revoked': the detail drives the share affordances.
      queryClient.invalidateQueries({ queryKey: [...QUIZZES_QUERY_KEY, quizId] });
    },
  });
}

// Delete a quiz draft (used when the owner explicitly discards a creation).
export function useDeleteQuiz() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (quizId: string): Promise<string> => {
      await api.delete(`/quiz/${quizId}`);
      return quizId;
    },
    onSuccess: (quizId) => {
      queryClient.invalidateQueries({ queryKey: [...QUIZZES_QUERY_KEY, quizId] });
    },
  });
}
