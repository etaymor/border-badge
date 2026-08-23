/**
 * useQuizBuildJob - A view onto the durable quiz-build job.
 *
 * Replaces `useCreateQuiz`. The distinction matters: a mutation is OWNED by
 * the component that fires it, so unmounting cancelled the build. This hook
 * owns nothing — it subscribes to the job's store slice and hands the finished
 * outcome over exactly once. Leaving the screen now leaves the build running.
 *
 * The outcome is consumed under a focus gate, mirroring `usePhotoScan`: two
 * simultaneously-mounted creation screens must not both act on one build.
 */

import { useCallback, useEffect, useRef } from 'react';

import { useIsFocused } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';

import { Analytics } from '@services/analytics';
import {
  cancelQuizBuild,
  consumeQuizOutcome,
  hasQuizOutcome,
  startQuizBuild,
  type QuizBuildOptions,
} from '@services/quiz/quizBuildJob';
import type { QuizCreationOutcome } from '@services/quiz/quizCreationTypes';
import type { JobPhase } from '@services/jobs/jobTypes';
import {
  selectQuizDetail,
  selectQuizPhase,
  selectQuizProgress,
  useLibraryJobStore,
  type QuizBuildDetail,
} from '@stores/libraryJobStore';

import { QUIZZES_QUERY_KEY, QUIZ_LIST_QUERY_KEY } from './useQuizzes';

export interface UseQuizBuildJobOptions {
  /** Called once when a build finishes, with the outcome. */
  onOutcome: (outcome: QuizCreationOutcome) => void;
}

export interface UseQuizBuildJobResult {
  phase: JobPhase;
  /** Percentage across the whole build, or null before the first emission. */
  percentage: number | null;
  detail: QuizBuildDetail;
  /** True when the job is running or queued behind a trip scan. */
  isActive: boolean;
  /** True while queued behind another library job. */
  isWaiting: boolean;
  start: (options?: QuizBuildOptions) => void;
  cancel: () => void;
}

export function useQuizBuildJob({ onOutcome }: UseQuizBuildJobOptions): UseQuizBuildJobResult {
  const queryClient = useQueryClient();
  const phase = useLibraryJobStore(selectQuizPhase);
  const progress = useLibraryJobStore(selectQuizProgress);
  const detail = useLibraryJobStore(selectQuizDetail);

  const isFocused = useIsFocused();
  const onOutcomeRef = useRef(onOutcome);
  // Synced in an effect, never during render: the React Compiler may memoize
  // around a render-time ref write and hand back a stale closure.
  useEffect(() => {
    onOutcomeRef.current = onOutcome;
  }, [onOutcome]);

  const deliver = useCallback(
    (outcome: QuizCreationOutcome) => {
      if (outcome.status === 'created') {
        // Funnel: quiz created (the top of the viral loop). Kept here rather
        // than in the job so the event fires once, on delivery to a screen.
        Analytics.quizCreated({ quizId: outcome.quizId, photoCount: outcome.photoCount });
        queryClient.invalidateQueries({ queryKey: [...QUIZZES_QUERY_KEY, outcome.quizId] });
        queryClient.invalidateQueries({ queryKey: QUIZ_LIST_QUERY_KEY });
      }
      onOutcomeRef.current(outcome);
    },
    [queryClient]
  );

  // Deliver a finished build, whether it completed while this screen was
  // mounted or before it re-mounted. Gated on focus so only one screen wins.
  useEffect(() => {
    if (!isFocused) return;
    if (phase !== 'completed') return;
    if (!hasQuizOutcome()) return;
    const outcome = consumeQuizOutcome();
    if (outcome) deliver(outcome);
  }, [isFocused, phase, deliver]);

  const start = useCallback((options: QuizBuildOptions = {}) => {
    void startQuizBuild(options);
  }, []);

  const cancel = useCallback(() => {
    cancelQuizBuild();
  }, []);

  return {
    phase,
    percentage: progress?.percentage ?? null,
    detail,
    isActive: phase === 'running' || phase === 'waiting',
    isWaiting: phase === 'waiting',
    start,
    cancel,
  };
}
