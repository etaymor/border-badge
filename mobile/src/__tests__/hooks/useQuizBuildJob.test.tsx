/**
 * useQuizBuildJob - handing a finished build to exactly one screen.
 *
 * This hook replaced a `useCreateQuiz` mutation, and the difference is the
 * point: a mutation is owned by the component that fires it, so unmounting the
 * creation screen destroyed the build. This hook owns nothing. It subscribes to
 * the job's store slice and delivers the outcome once — which is where the
 * two behaviors below live now that the mutation is gone.
 */

jest.mock('@services/quiz/quizBuildJob', () => ({
  startQuizBuild: jest.fn(),
  cancelQuizBuild: jest.fn(),
  consumeQuizOutcome: jest.fn(),
  hasQuizOutcome: jest.fn(),
}));

jest.mock('@services/analytics', () => ({
  Analytics: { quizCreated: jest.fn() },
}));

const mockIsFocused = jest.fn(() => true);
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockIsFocused(),
}));

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useQuizBuildJob } from '@hooks/useQuizBuildJob';
import { Analytics } from '@services/analytics';
import { consumeQuizOutcome, hasQuizOutcome } from '@services/quiz/quizBuildJob';
import { patchJobSlice, resetLibraryJobStore } from '@stores/libraryJobStore';
import type { QuizCreationOutcome } from '@services/quiz/quizCreationTypes';

import { createTestQueryClient } from '../utils/testUtils';

const mockConsume = consumeQuizOutcome as jest.Mock;
const mockHasOutcome = hasQuizOutcome as jest.Mock;

const CREATED: QuizCreationOutcome = { status: 'created', quizId: 'quiz-1', photoCount: 8 };

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

let queryClient: QueryClient;

beforeEach(() => {
  jest.clearAllMocks();
  resetLibraryJobStore();
  queryClient = createTestQueryClient();
  mockIsFocused.mockReturnValue(true);
  mockHasOutcome.mockReturnValue(true);
  mockConsume.mockReturnValue(CREATED);
});

describe('useQuizBuildJob', () => {
  it('invalidates only the created quiz and the list it now appears on', async () => {
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    const onOutcome = jest.fn();

    renderHook(() => useQuizBuildJob({ onOutcome }), { wrapper: wrapper(queryClient) });
    patchJobSlice('quiz-build', { phase: 'completed', hasResult: true });

    await waitFor(() => expect(onOutcome).toHaveBeenCalledWith(CREATED));
    // Scoped, not a blanket invalidation: nothing else on screen is stale.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['quizzes', 'quiz-1'] });
    expect(Analytics.quizCreated).toHaveBeenCalledWith({ quizId: 'quiz-1', photoCount: 8 });
  });

  it('delivers a build that finished while no screen was mounted', async () => {
    // The build completed in the background of the user's attention; the
    // screen re-mounts afterwards and must still receive it.
    patchJobSlice('quiz-build', { phase: 'completed', hasResult: true });
    const onOutcome = jest.fn();

    renderHook(() => useQuizBuildJob({ onOutcome }), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(onOutcome).toHaveBeenCalledWith(CREATED));
  });

  it('does not consume the outcome while unfocused, so two screens cannot both act', async () => {
    mockIsFocused.mockReturnValue(false);
    const onOutcome = jest.fn();

    renderHook(() => useQuizBuildJob({ onOutcome }), { wrapper: wrapper(queryClient) });
    patchJobSlice('quiz-build', { phase: 'completed', hasResult: true });

    await waitFor(() => expect(mockConsume).not.toHaveBeenCalled());
    expect(onOutcome).not.toHaveBeenCalled();
  });

  it('reports the queued state so the screen can explain the wait', async () => {
    // A build asked for while a trip scan holds the cache QUEUES rather than
    // preempting, and the wizard has to say so or the wait reads as a hang.
    mockHasOutcome.mockReturnValue(false);
    patchJobSlice('quiz-build', { phase: 'waiting' });

    const { result } = renderHook(() => useQuizBuildJob({ onOutcome: jest.fn() }), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isWaiting).toBe(true));
    expect(result.current.isActive).toBe(true);
  });
});
