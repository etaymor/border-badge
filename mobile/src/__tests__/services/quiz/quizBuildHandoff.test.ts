/**
 * The hand-off between a finished challenge and the trip by-product.
 *
 * The reported bug: the wizard sat at "10 of 10" long after the challenge was
 * built - the server row was already `awaiting_owner_play` - and the finished
 * challenge only appeared once the user backed out and came in again. Nothing
 * had failed. `advanceQuizBuild`'s `trips` stage runs
 * `runQuizTripContinuation`, which re-segments the WHOLE cached library in one
 * synchronous call, and it started in the same JS turn as the outcome. React
 * could not paint the navigation it had already been handed, so the thread
 * was pinned for as long as segmentation took.
 *
 * The stage must therefore wait for the UI to finish what it already has in
 * flight before it starts.
 */

jest.mock('@services/quiz/quizTripContinuation', () => ({
  runQuizTripContinuation: jest.fn().mockResolvedValue({ status: 'skipped' }),
}));

import { InteractionManager } from 'react-native';

import { advanceQuizBuild } from '@services/quiz/quizBuildSteps';
import { initialQuizCheckpoint } from '@services/quiz/quizCheckpoint';
import { runQuizTripContinuation } from '@services/quiz/quizTripContinuation';
import type { QuizBuildCheckpoint } from '@services/quiz/quizCheckpoint';

const mockContinuation = runQuizTripContinuation as jest.Mock;

function tripsCheckpoint(): QuizBuildCheckpoint {
  return { ...initialQuizCheckpoint(300), stage: 'trips', quizId: 'quiz-1' };
}

describe('quiz build - trips stage hand-off', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    mockContinuation.mockClear();
  });

  it('does not start segmentation until the UI has finished its work', async () => {
    let released: (() => void) | null = null;
    jest
      .spyOn(InteractionManager, 'runAfterInteractions')
      .mockImplementation((callback?: (() => void) | { gen: unknown }) => {
        released = () => (callback as () => void)?.();
        return { then: () => undefined, done: () => undefined, cancel: () => undefined } as never;
      });

    const advancing = advanceQuizBuild({}, tripsCheckpoint());

    // The navigation is still in flight: the thread must be free.
    await Promise.resolve();
    expect(mockContinuation).not.toHaveBeenCalled();

    released!();
    const next = await advancing;

    expect(mockContinuation).toHaveBeenCalledTimes(1);
    expect(next.stage).toBe('done');
  });

  it('segments anyway when nothing ever reports the UI settling', async () => {
    // A headless run (the iOS background task) has no interactions and no UI,
    // so the callback never fires. The timeout is the normal path there, not a
    // safety net - without it the by-product would simply never run.
    jest.useFakeTimers();
    jest
      .spyOn(InteractionManager, 'runAfterInteractions')
      .mockImplementation(
        () => ({ then: () => undefined, done: () => undefined, cancel: () => undefined }) as never
      );

    const advancing = advanceQuizBuild({}, tripsCheckpoint());
    await Promise.resolve();
    expect(mockContinuation).not.toHaveBeenCalled();

    jest.advanceTimersByTime(3_000);
    const next = await advancing;

    expect(mockContinuation).toHaveBeenCalledTimes(1);
    expect(next.stage).toBe('done');
    jest.useRealTimers();
  });
});
