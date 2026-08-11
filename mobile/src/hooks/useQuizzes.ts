/**
 * Quiz hooks (Travel Photo Quiz U4).
 *
 * Follows the useTrips conventions: module-level query key, STALE_TIMES for
 * staleness, scoped invalidation targeting only the affected quiz. Unlike the
 * trip mutations, errors do NOT raise Alerts here - QuizCreationScreen owns
 * every outcome surface (decline, retry, resume) itself.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@services/api';
import {
  createQuizFromLibrary,
  type CreateQuizOptions,
  type QuizCreationOutcome,
} from '@services/quiz/quizCreation';
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
