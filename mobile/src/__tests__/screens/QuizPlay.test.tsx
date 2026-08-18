/**
 * Tests for the U5 owner play flow: QuizPlayScreen + QuizResultsScreen.
 *
 * Covers the U5 requirements:
 * - answering all country questions surfaces the seeded score-to-beat (AE3)
 * - immediate feedback reveals the correct country on a wrong answer
 * - mid-play kill + relaunch resumes at the next ungraded question (the
 *   persisted play state carries the graded answers)
 * - a swap forces answering the new photo before share becomes available;
 *   remove rescales the displayed score to X of N
 * - after sharing, the swap and remove affordances are gone
 * - share invokes the share sheet with a URL containing the minted slug
 * - revoke (U10) confirms with the honest disclosure (cached previews may
 *   persist; photo edges expire within about a minute) before calling the
 *   revoke mutation
 */

import { within } from '@testing-library/react-native';

import { act, fireEvent, render, screen, waitFor } from '../utils/testUtils';
import { createMockNavigation } from '../utils/mockFactories';

// Access the mock Alert from global (set in jest.setup.js).
declare global {
  // eslint-disable-next-line no-var
  var __mockAlert: {
    alert: jest.Mock;
  };
}
const mockAlert = global.__mockAlert.alert;

import { Image as MockedExpoImage } from 'expo-image';
import { api } from '@services/api';
import * as ShareModule from '@utils/share';
import type { QuizDetail, QuizQuestion } from '@hooks/useQuizzes';
import type { RootStackScreenProps } from '@navigation/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// The creation orchestration drags in the photo-import stack; U5 never runs it.
jest.mock('@services/quiz/quizCreation', () => ({
  createQuizFromLibrary: jest.fn(),
  loadDraftState: jest.fn().mockResolvedValue(null),
  clearDraftState: jest.fn(),
}));

// expo-image with a spy-able static `prefetch`, so the tests can assert the
// NEXT photo is fetched while the current one is on screen.
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
jest.mock('expo-image', () => {
  const React = require('react');
  const { Image: RNImage } = require('react-native');
  const MockImage = (props: Record<string, unknown>) => React.createElement(RNImage, props);
  MockImage.prefetch = jest.fn(() => Promise.resolve(true));
  MockImage.clearMemoryCache = jest.fn(() => Promise.resolve(true));
  return { Image: MockImage };
});
/* eslint-enable @typescript-eslint/no-require-imports */

// The project reduce-motion hook, mockable per test: the inspector's fade vs.
// plain-swap branch hangs off it. Default false matches the device default.
jest.mock('@hooks/useReducedMotion', () => ({
  useReducedMotion: jest.fn(() => false),
}));

jest.mock('@services/quiz/quizPlay', () => ({
  ensurePlaySession: jest.fn(),
  loadPlayState: jest.fn(),
  savePlayState: jest.fn(),
  recordAnswer: jest.fn(),
  clearStoredAnswer: jest.fn(),
  loadSwapCandidates: jest.fn(),
  uploadSwapPhoto: jest.fn(),
}));

import {
  ensurePlaySession,
  loadPlayState,
  loadSwapCandidates,
  recordAnswer,
  uploadSwapPhoto,
  type QuizPlayState,
  type StoredQuizAnswer,
} from '@services/quiz/quizPlay';
import { getAllCountries } from '@services/countriesDb';
import { invalidateCountriesCache } from '@hooks/useCountries';
import { useReducedMotion } from '@hooks/useReducedMotion';
import { deriveOrientation, QuizPlayScreen } from '@screens/quiz/QuizPlayScreen';
import { QuizResultsScreen } from '@screens/quiz/QuizResultsScreen';

const mockEnsurePlaySession = ensurePlaySession as jest.MockedFunction<typeof ensurePlaySession>;
const mockLoadPlayState = loadPlayState as jest.MockedFunction<typeof loadPlayState>;
const mockRecordAnswer = recordAnswer as jest.MockedFunction<typeof recordAnswer>;
const mockLoadSwapCandidates = loadSwapCandidates as jest.MockedFunction<typeof loadSwapCandidates>;
const mockUploadSwapPhoto = uploadSwapPhoto as jest.MockedFunction<typeof uploadSwapPhoto>;
const mockUseReducedMotion = useReducedMotion as jest.MockedFunction<typeof useReducedMotion>;

const mockApiGet = api.get as jest.Mock;
const mockApiPost = api.post as jest.Mock;
const mockApiDelete = api.delete as jest.Mock;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const QUIZ_ID = 'quiz-1';
const SESSION_ID = 'session-1';
const OPTIONS = ['France', 'Spain', 'Italy', 'Portugal'];

function makeQuestion(n: number): QuizQuestion {
  return {
    id: `q${n}`,
    position: n,
    image_url: `https://cdn.example/quiz/q${n}.jpg`,
    options: OPTIONS,
  };
}

function makeDetail(overrides?: Partial<QuizDetail>): QuizDetail {
  return {
    id: QUIZ_ID,
    state: 'awaiting_owner_play',
    questions: [0, 1, 2, 3, 4].map((n) => makeQuestion(n)),
    score_to_beat: null,
    slug: null,
    share_url: null,
    ...overrides,
  };
}

function makeAnswer(questionId: string, overrides?: Partial<StoredQuizAnswer>): StoredQuizAnswer {
  return {
    questionId,
    selectedOptionIndex: 0,
    placeCorrect: true,
    correctOptionIndex: 0,
    correctOption: 'France',
    ...overrides,
  };
}

function makePlayState(answeredIds: string[]): QuizPlayState {
  return {
    quizId: QUIZ_ID,
    sessionId: SESSION_ID,
    answers: Object.fromEntries(answeredIds.map((id) => [id, makeAnswer(id)])),
  };
}

const COMPLETE_RESULTS = {
  correct: 3,
  total: 5,
  score_to_beat: { correct: 3, total: 5 },
  state: 'playable',
};

function mockQuizDetail(detail: QuizDetail) {
  mockApiGet.mockImplementation((url: string) =>
    url === `/quiz/${QUIZ_ID}`
      ? Promise.resolve({ data: detail })
      : Promise.reject(new Error(`Unexpected GET ${url}`))
  );
}

function mockPostRoutes(routes: Record<string, unknown | ((body: unknown) => unknown)>) {
  mockApiPost.mockImplementation((url: string, body?: unknown) => {
    if (url in routes) {
      const value = routes[url];
      return Promise.resolve({ data: typeof value === 'function' ? value(body) : value });
    }
    return Promise.reject(new Error(`Unexpected POST ${url}`));
  });
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function renderPlayScreen() {
  const navigation =
    createMockNavigation() as unknown as RootStackScreenProps<'QuizPlay'>['navigation'];
  const route = {
    key: 'test-play',
    name: 'QuizPlay',
    params: { quizId: QUIZ_ID },
  } as RootStackScreenProps<'QuizPlay'>['route'];
  render(<QuizPlayScreen navigation={navigation} route={route} />);
  return { navigation };
}

function renderResultsScreen(results: typeof COMPLETE_RESULTS | 'none' = COMPLETE_RESULTS) {
  const navigation =
    createMockNavigation() as unknown as RootStackScreenProps<'QuizResults'>['navigation'];
  const route = {
    key: 'test-results',
    name: 'QuizResults',
    params: results === 'none' ? { quizId: QUIZ_ID } : { quizId: QUIZ_ID, results },
  } as RootStackScreenProps<'QuizResults'>['route'];
  render(<QuizResultsScreen navigation={navigation} route={route} />);
  return { navigation };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  // mockReturnValue survives clearAllMocks; reset hard so one test's reduce
  // motion never leaks into the next.
  mockUseReducedMotion.mockReset();
  mockUseReducedMotion.mockReturnValue(false);
  mockRecordAnswer.mockImplementation(async (state, answer) => ({
    ...state,
    answers: { ...state.answers, [answer.questionId]: answer },
  }));
  mockLoadSwapCandidates.mockResolvedValue([]);
});

describe('QuizPlayScreen photo loading', () => {
  // Every photo is fetched cold at the moment its question mounts, so the wait
  // after answering is a full download + decode of a 2048px JPEG. Warming the
  // NEXT photo while the player is still looking at the current one moves that
  // cost off the transition. It is also what keeps only a bounded number of
  // full-size bitmaps alive - the play session was being killed part-way
  // through a 10-photo game.
  const ExpoImage = MockedExpoImage as unknown as { prefetch: jest.Mock };

  it('warms the next photo while the current question is on screen', async () => {
    mockQuizDetail(makeDetail());
    mockEnsurePlaySession.mockResolvedValue(makePlayState([]));

    renderPlayScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-play-photo')).toBeTruthy());
    await waitFor(() =>
      expect(ExpoImage.prefetch).toHaveBeenCalledWith(
        expect.arrayContaining(['https://cdn.example/quiz/q1.jpg'])
      )
    );
    // Only the next one - not the whole game, which is what fills memory.
    const warmed = ExpoImage.prefetch.mock.calls.flatMap(([urls]: [string[]]) => urls);
    expect(warmed).not.toContain('https://cdn.example/quiz/q4.jpg');
  });

  it('keeps warming one photo ahead as the game advances', async () => {
    mockQuizDetail(makeDetail());
    mockEnsurePlaySession.mockResolvedValue(makePlayState(['q0']));

    renderPlayScreen();

    await waitFor(() => expect(screen.getByText('2 OF 5')).toBeTruthy());
    await waitFor(() =>
      expect(ExpoImage.prefetch).toHaveBeenCalledWith(
        expect.arrayContaining(['https://cdn.example/quiz/q2.jpg'])
      )
    );
  });

  it('does not warm anything past the last photo', async () => {
    mockQuizDetail(makeDetail());
    mockEnsurePlaySession.mockResolvedValue(makePlayState(['q0', 'q1', 'q2', 'q3']));

    renderPlayScreen();

    await waitFor(() => expect(screen.getByText('5 OF 5')).toBeTruthy());
    const warmed = ExpoImage.prefetch.mock.calls.flatMap(([urls]: [string[]]) => urls);
    expect(warmed).toEqual([]);
  });
});

describe('QuizPlayScreen adaptive layout', () => {
  // The play payload carries NO orientation field, so the layout is derived
  // from each photo's decoded dimensions (expo-image onLoad). Until they
  // arrive the contained treatment holds so the frame never jumps.
  describe('deriveOrientation', () => {
    it('classifies wider-than-tall as landscape', () => {
      expect(deriveOrientation(4032, 3024)).toBe('landscape');
    });

    it('classifies taller-than-wide and square as portrait (immersive)', () => {
      expect(deriveOrientation(3024, 4032)).toBe('portrait');
      expect(deriveOrientation(2048, 2048)).toBe('portrait');
    });

    it('returns null (keep the contained fallback) without real dimensions', () => {
      expect(deriveOrientation(undefined, undefined)).toBeNull();
      expect(deriveOrientation(0, 100)).toBeNull();
      expect(deriveOrientation(100, 0)).toBeNull();
      expect(deriveOrientation(Number.NaN, 100)).toBeNull();
    });
  });

  it('goes immersive full-bleed once a portrait photo reports its dimensions', async () => {
    mockQuizDetail(makeDetail());
    mockEnsurePlaySession.mockResolvedValue(makePlayState([]));

    renderPlayScreen();

    // Before dimensions arrive: contained treatment over the scrim sheet.
    await waitFor(() => expect(screen.getByTestId('quiz-play-photo')).toBeTruthy());
    expect(screen.getByTestId('quiz-play-photo').props.contentFit).toBe('contain');
    expect(screen.getByTestId('quiz-answer-scrim')).toBeTruthy();

    fireEvent(screen.getByTestId('quiz-play-photo'), 'load', {
      source: { width: 3024, height: 4032 },
    });

    // Portrait: the sharp photo extends full-screen behind the scrim sheet.
    await waitFor(() =>
      expect(screen.getByTestId('quiz-play-photo').props.contentFit).toBe('cover')
    );
    expect(screen.getByTestId('quiz-answer-scrim')).toBeTruthy();
    expect(screen.queryByTestId('quiz-answer-solid')).toBeNull();
  });

  it('drops to a solid answer area once a landscape photo reports its dimensions', async () => {
    mockQuizDetail(makeDetail());
    mockEnsurePlaySession.mockResolvedValue(makePlayState([]));

    renderPlayScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-play-photo')).toBeTruthy());
    fireEvent(screen.getByTestId('quiz-play-photo'), 'load', {
      source: { width: 4032, height: 3024 },
    });

    // Landscape: photo stays uncropped, answers sit below on the stage color.
    await waitFor(() => expect(screen.getByTestId('quiz-answer-solid')).toBeTruthy());
    expect(screen.getByTestId('quiz-play-photo').props.contentFit).toBe('contain');
    expect(screen.queryByTestId('quiz-answer-scrim')).toBeNull();
    // The answer surfaces still work from the solid area.
    expect(screen.getByTestId('quiz-option-0')).toBeTruthy();
  });
});

describe('QuizPlayScreen stall recovery', () => {
  // The tapped option keeps its gold ring - and every option stays disabled -
  // for as long as `pendingAnswerKey` is set, and only advancing clears it. Any
  // path that sets it without reaching the next question freezes the game with
  // the tapped option still lit and no way out but killing the app. Nothing may
  // hold that lock indefinitely.
  it('recovers into the retryable error state when an answer never settles', async () => {
    // Fake ONLY the clock the watchdog needs. React's scheduler drives render
    // continuations through setImmediate in this environment; mounting the
    // screen while setImmediate is faked strands the scheduler's pending
    // flush when useRealTimers() discards the fake queue, after which every
    // outside-act update IN THE WHOLE FILE (the ACK-hold advances) renders
    // but never commits. Node 20 fails on this; newer Nodes happen to mask it.
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'clearImmediate'] });
    try {
      mockQuizDetail(makeDetail({ questions: [makeQuestion(0)] }));
      mockEnsurePlaySession.mockResolvedValue(makePlayState([]));
      // The request goes out and never comes back: no success, no error.
      mockApiPost.mockImplementation(() => new Promise(() => {}));

      renderPlayScreen();

      await waitFor(() => expect(screen.getByTestId('quiz-option-0')).toBeTruthy());
      fireEvent.press(screen.getByTestId('quiz-option-0'));

      // Frozen: the option is lit and every option is disabled.
      await waitFor(() => expect(screen.getByTestId('quiz-option-0').props.accessibilityState));

      // act-wrapped so the watchdog's state update flushes while the fake
      // clock is still installed, not after useRealTimers() discards it.
      act(() => {
        jest.advanceTimersByTime(20_000);
      });

      await waitFor(() => expect(screen.getByTestId('quiz-play-error')).toBeTruthy());
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not strand the highlight when the answer cannot be submitted', async () => {
    mockQuizDetail(makeDetail({ questions: [makeQuestion(0)] }));
    mockEnsurePlaySession.mockResolvedValue(makePlayState([]));
    mockPostRoutes({
      [`/quiz/${QUIZ_ID}/answer`]: () => {
        throw Object.assign(new Error('boom'), { response: { status: 500 } });
      },
    });

    renderPlayScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-option-0')).toBeTruthy());
    fireEvent.press(screen.getByTestId('quiz-option-0'));

    // A hard failure surfaces the error screen rather than a dead highlight.
    await waitFor(() => expect(screen.getByTestId('quiz-play-error')).toBeTruthy());
  });
});

describe('QuizPlayScreen', () => {
  it('resumes at the next ungraded question after a mid-play kill', async () => {
    // Two answers already graded in the persisted session: resume at photo 3.
    mockQuizDetail(makeDetail());
    mockEnsurePlaySession.mockResolvedValue(makePlayState(['q0', 'q1']));

    renderPlayScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-play-progress')).toBeTruthy());
    expect(screen.getByText('3 OF 5')).toBeTruthy();
    expect(screen.getByTestId('quiz-play-photo').props.source.uri).toBe(
      'https://cdn.example/quiz/q2.jpg'
    );
    // Resuming never starts a fresh grading pass on already-answered questions.
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('acknowledges an answer without revealing the verdict and advances (Q8)', async () => {
    mockQuizDetail(makeDetail());
    mockEnsurePlaySession.mockResolvedValue(makePlayState([]));
    mockPostRoutes({
      [`/quiz/${QUIZ_ID}/answer`]: {
        place_correct: false,
        correct_option_index: 0,
        correct_option: 'France',
        score: 0,
      },
    });

    renderPlayScreen();

    await waitFor(() => expect(screen.getByText('Spain')).toBeTruthy());
    fireEvent.press(screen.getByText('Spain'));

    // No per-question verdict: play moves straight to the next photo.
    await waitFor(() => expect(screen.getByText('2 OF 5')).toBeTruthy());
    expect(screen.queryByText(/Correct!/)).toBeNull();
    expect(screen.queryByText(/Not quite/)).toBeNull();
    expect(mockApiPost).toHaveBeenCalledWith(
      `/quiz/${QUIZ_ID}/answer`,
      expect.objectContaining({
        session_id: SESSION_ID,
        question_id: 'q0',
        selected_option_index: 1,
      })
    );
  });

  it('grades a country pick in a single call, with no second sub-question', async () => {
    mockQuizDetail(makeDetail());
    mockEnsurePlaySession.mockResolvedValue(makePlayState([]));
    mockPostRoutes({
      [`/quiz/${QUIZ_ID}/answer`]: {
        place_correct: true,
        correct_option_index: 1,
        correct_option: 'Spain',
        score: 1,
      },
    });

    renderPlayScreen();

    await waitFor(() => expect(screen.getByText('Spain')).toBeTruthy());
    fireEvent.press(screen.getByText('Spain'));

    // One tap per photo: the country pick goes straight to grading and the
    // game advances. Nothing asks about the year.
    await waitFor(() => expect(screen.getByText('2 OF 5')).toBeTruthy());
    expect(screen.queryByTestId('quiz-year-prompt')).toBeNull();
    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(mockApiPost).toHaveBeenCalledWith(
      `/quiz/${QUIZ_ID}/answer`,
      expect.not.objectContaining({ selected_year: expect.anything() })
    );
  });

  it('completes after the last answer and hands the seeded score-to-beat to results', async () => {
    mockQuizDetail(makeDetail());
    mockEnsurePlaySession.mockResolvedValue(makePlayState(['q0', 'q1', 'q2', 'q3']));
    mockPostRoutes({
      [`/quiz/${QUIZ_ID}/answer`]: {
        place_correct: true,
        correct_option_index: 0,
        correct_option: 'France',
        score: 3,
      },
      [`/quiz/${QUIZ_ID}/complete`]: COMPLETE_RESULTS,
    });

    const { navigation } = renderPlayScreen();

    await waitFor(() => expect(screen.getByText('5 OF 5')).toBeTruthy());
    fireEvent.press(screen.getByText('France'));

    // The reveal happens once, at the end: the last answer flows straight
    // into completion and the results hand-off.
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith('QuizResults', {
        quizId: QUIZ_ID,
        results: expect.objectContaining({ score_to_beat: { correct: 3, total: 5 } }),
      })
    );
    expect(mockApiPost).toHaveBeenCalledWith(`/quiz/${QUIZ_ID}/complete`, {
      session_id: SESSION_ID,
    });
  });
});

describe('QuizPlayScreen resilience (BUG-1)', () => {
  const ANSWER_RESULT = {
    place_correct: true,
    correct_option_index: 0,
    correct_option: 'France',
    score: 1,
  };

  it('still advances when persisting the graded answer fails', async () => {
    // The answer POST succeeded - the server graded it - but the local SQLite
    // write rejected (e.g. the DB is busy right after foregrounding). The
    // verdict must not be lost: the screen advances with in-memory state.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockQuizDetail(makeDetail());
    mockEnsurePlaySession.mockResolvedValue(makePlayState([]));
    mockPostRoutes({ [`/quiz/${QUIZ_ID}/answer`]: ANSWER_RESULT });
    mockRecordAnswer.mockRejectedValue(new Error('database is locked'));

    renderPlayScreen();

    await waitFor(() => expect(screen.getByText('France')).toBeTruthy());
    fireEvent.press(screen.getByText('France'));

    await waitFor(() => expect(screen.getByText('2 OF 5')).toBeTruthy());

    warnSpy.mockRestore();
  });

  it('treats a 409 already-answered response as answered and moves on', async () => {
    // The server graded this question in an earlier run whose verdict never
    // persisted locally. Re-submitting 409s - that must not dead-end in the
    // error phase; the question is marked answered and play continues.
    mockQuizDetail(makeDetail());
    mockEnsurePlaySession.mockResolvedValue(makePlayState([]));
    mockApiPost.mockImplementation((url: string) =>
      url === `/quiz/${QUIZ_ID}/answer`
        ? Promise.reject(
            Object.assign(new Error('Request failed with status code 409'), {
              response: {
                status: 409,
                data: { detail: 'This question has already been answered in this session.' },
              },
            })
          )
        : Promise.reject(new Error(`Unexpected POST ${url}`))
    );

    renderPlayScreen();

    await waitFor(() => expect(screen.getByText('France')).toBeTruthy());
    fireEvent.press(screen.getByText('France'));

    await waitFor(() => expect(screen.getByText('2 OF 5')).toBeTruthy());
    expect(screen.queryByTestId('quiz-play-error')).toBeNull();
  });

  it('renders the error state instead of crashing when route params are missing', async () => {
    // A restored navigation state can produce a param-less route; that must
    // land on the handled error state, not throw during render.
    mockQuizDetail(makeDetail());
    mockEnsurePlaySession.mockResolvedValue(makePlayState([]));
    const navigation =
      createMockNavigation() as unknown as RootStackScreenProps<'QuizPlay'>['navigation'];
    const route = {
      key: 'test-play',
      name: 'QuizPlay',
      params: undefined,
    } as unknown as RootStackScreenProps<'QuizPlay'>['route'];

    render(<QuizPlayScreen navigation={navigation} route={route} />);

    await waitFor(() => expect(screen.getByTestId('quiz-play-error')).toBeTruthy());
  });
});

describe('QuizPlayScreen photo inspector (Unit 1.2)', () => {
  // Tapping the photo hides the interface behind a full-screen navy inspector
  // with the photo aspect-fit and pinch-to-zoom; closing restores the play
  // interface exactly as it was. The inspector is purely visual: it must never
  // touch selection state, the answer lock, or the watchdog.

  it('opens the inspector from a tap on the photo region and hides the interface', async () => {
    mockQuizDetail(makeDetail());
    mockEnsurePlaySession.mockResolvedValue(makePlayState([]));

    renderPlayScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-photo-inspect')).toBeTruthy());
    expect(screen.queryByTestId('quiz-photo-inspector')).toBeNull();

    fireEvent.press(screen.getByTestId('quiz-photo-inspect'));

    // The inspector shows THIS question's full photo, aspect-fit.
    expect(screen.getByTestId('quiz-photo-inspector')).toBeTruthy();
    const image = screen.getByTestId('quiz-photo-inspector-image');
    expect(image.props.source.uri).toBe('https://cdn.example/quiz/q0.jpg');
    expect(image.props.contentFit).toBe('contain');

    // The play interface underneath is hidden from assistive tech while the
    // opaque overlay covers it (nothing is unmounted, so state survives).
    // includeHiddenElements: RNTL's default queries exclude exactly what this
    // asserts - that the controls are now accessibility-hidden.
    const controls = screen.getByTestId('quiz-play-controls', { includeHiddenElements: true });
    expect(controls.props.accessibilityElementsHidden).toBe(true);
    expect(controls.props.importantForAccessibility).toBe('no-hide-descendants');
    // And the default query no longer surfaces the interface at all.
    expect(screen.queryByTestId('quiz-country-prompt')).toBeNull();
  });

  it('closing restores the interface exactly as it was, without touching the game', async () => {
    mockQuizDetail(makeDetail());
    mockEnsurePlaySession.mockResolvedValue(makePlayState([]));

    renderPlayScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-photo-inspect')).toBeTruthy());
    fireEvent.press(screen.getByTestId('quiz-photo-inspect'));
    expect(screen.getByTestId('quiz-photo-inspector')).toBeTruthy();

    fireEvent.press(screen.getByTestId('quiz-photo-inspector-close'));

    expect(screen.queryByTestId('quiz-photo-inspector')).toBeNull();
    const controls = screen.getByTestId('quiz-play-controls');
    expect(controls.props.accessibilityElementsHidden).toBe(false);
    // Same question, same progress, and no grading traffic from inspecting.
    expect(screen.getByText('1 OF 5')).toBeTruthy();
    expect(screen.getByTestId('quiz-country-prompt')).toBeTruthy();
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('tapping the photo inside the inspector closes it too', async () => {
    mockQuizDetail(makeDetail());
    mockEnsurePlaySession.mockResolvedValue(makePlayState([]));

    renderPlayScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-photo-inspect')).toBeTruthy());
    fireEvent.press(screen.getByTestId('quiz-photo-inspect'));
    fireEvent.press(screen.getByTestId('quiz-photo-inspector-surface'));

    expect(screen.queryByTestId('quiz-photo-inspector')).toBeNull();
  });

  it('an open/close round-trip never disturbs a held answer lock', async () => {
    mockQuizDetail(makeDetail());
    mockEnsurePlaySession.mockResolvedValue(makePlayState([]));
    // The answer is in flight and never settles: the lock stays held.
    mockApiPost.mockImplementation(() => new Promise(() => {}));

    renderPlayScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-option-0')).toBeTruthy());
    fireEvent.press(screen.getByTestId('quiz-option-0'));

    // Locked: the tapped option is acknowledged, every option disabled.
    expect(screen.getByTestId('quiz-option-0').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('quiz-option-1').props.accessibilityState.disabled).toBe(true);

    fireEvent.press(screen.getByTestId('quiz-photo-inspect'));
    expect(screen.getByTestId('quiz-photo-inspector')).toBeTruthy();
    fireEvent.press(screen.getByTestId('quiz-photo-inspector-close'));

    // The lock is exactly as it was: still acknowledged, still disabled.
    expect(screen.getByTestId('quiz-option-0').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('quiz-option-1').props.accessibilityState.disabled).toBe(true);
  });

  it('a pending country pick survives an inspect round-trip', async () => {
    mockQuizDetail(makeDetail());
    mockEnsurePlaySession.mockResolvedValue(makePlayState([]));
    // The grading call never settles, so the pick stays pending across the
    // inspector open/close - which is exactly what must not be disturbed.
    mockApiPost.mockImplementation(() => new Promise(() => {}));

    renderPlayScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-option-1')).toBeTruthy());
    fireEvent.press(screen.getByTestId('quiz-option-1'));
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(1));

    fireEvent.press(screen.getByTestId('quiz-photo-inspect'));
    fireEvent.press(screen.getByTestId('quiz-photo-inspector-close'));

    // Same photo, same pending pick, same lock: nothing underneath unmounted.
    expect(screen.getByTestId('quiz-option-1').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('quiz-option-0').props.accessibilityState.disabled).toBe(true);
    expect(mockApiPost).toHaveBeenCalledTimes(1);
  });

  it('closes an inspector opened during the acknowledgment hold once the question advances', async () => {
    mockQuizDetail(makeDetail());
    mockEnsurePlaySession.mockResolvedValue(makePlayState([]));
    mockPostRoutes({
      [`/quiz/${QUIZ_ID}/answer`]: {
        place_correct: true,
        correct_option_index: 0,
        correct_option: 'France',
        score: 1,
      },
    });

    renderPlayScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-option-0')).toBeTruthy());
    fireEvent.press(screen.getByTestId('quiz-option-0'));

    // The tapped option holds its acknowledgment while the advance is pending;
    // the photo tap region is still live, so the inspector can open mid-hold.
    expect(screen.getByTestId('quiz-option-0').props.accessibilityState.selected).toBe(true);
    fireEvent.press(screen.getByTestId('quiz-photo-inspect'));
    expect(screen.getByTestId('quiz-photo-inspector')).toBeTruthy();

    // The hold elapses and the next question mounts: the inspector must not
    // survive the handover and silently show the next photo.
    await waitFor(() => expect(screen.getByText('2 OF 5')).toBeTruthy(), { timeout: 3000 });
    expect(screen.queryByTestId('quiz-photo-inspector')).toBeNull();
  });

  it('still opens and closes under reduce motion (plain swap)', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    mockQuizDetail(makeDetail());
    mockEnsurePlaySession.mockResolvedValue(makePlayState([]));

    renderPlayScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-photo-inspect')).toBeTruthy());
    fireEvent.press(screen.getByTestId('quiz-photo-inspect'));
    expect(screen.getByTestId('quiz-photo-inspector')).toBeTruthy();
    fireEvent.press(screen.getByTestId('quiz-photo-inspector-close'));
    expect(screen.queryByTestId('quiz-photo-inspector')).toBeNull();
  });
});

describe('QuizResultsScreen', () => {
  it('reveals the photo hero with the serif score and no second, private score', async () => {
    mockQuizDetail(makeDetail({ state: 'playable', score_to_beat: { correct: 3, total: 5 } }));
    mockLoadPlayState.mockResolvedValue(makePlayState(['q0', 'q1', 'q2', 'q3', 'q4']));

    renderResultsScreen();

    // The hero is photo-first: the first challenge photo under the eyebrow,
    // the title, and the serif score lockup. No stamp plate, no trophy.
    await waitFor(() => expect(screen.getByTestId('quiz-results-hero')).toBeTruthy());
    expect(screen.getByText('Score to beat')).toBeTruthy();
    const lockup = screen.getByTestId('quiz-score-to-beat');
    expect(within(lockup).getByText('3')).toBeTruthy();
    expect(within(lockup).getByText('5')).toBeTruthy();

    // The country score is the ONLY score: the private memory module is gone.
    expect(screen.queryByTestId('quiz-memory-score')).toBeNull();
    expect(screen.queryByText('Memory')).toBeNull();
    expect(screen.queryByText('Only you see this.')).toBeNull();
  });

  it('keeps country names out of the recap until Review Answers is opened', async () => {
    mockQuizDetail(makeDetail({ state: 'playable', score_to_beat: { correct: 3, total: 5 } }));
    mockLoadPlayState.mockResolvedValue(makePlayState(['q0', 'q1', 'q2', 'q3', 'q4']));

    renderResultsScreen();

    // The recap thumbnails carry corner verdict marks - but no reveal text.
    await waitFor(() =>
      expect(screen.getByTestId('quiz-recap-thumb-0-verdict-correct')).toBeTruthy()
    );
    expect(screen.queryByText(/France/)).toBeNull();

    fireEvent.press(screen.getByTestId('quiz-review-toggle'));

    // Opening the review reveals the serif country lines for every photo.
    expect(screen.getAllByText('Right: France')).toHaveLength(5);
  });

  it('names the correct country and the owner pick on a miss once answers are open', async () => {
    mockQuizDetail(makeDetail({ state: 'playable', score_to_beat: { correct: 3, total: 5 } }));
    const playState = makePlayState(['q0', 'q1', 'q2', 'q3', 'q4']);
    playState.answers.q1 = makeAnswer('q1', { placeCorrect: false, selectedOptionIndex: 1 });
    mockLoadPlayState.mockResolvedValue(playState);

    renderResultsScreen();

    await waitFor(() =>
      expect(screen.getByTestId('quiz-recap-thumb-1-verdict-incorrect')).toBeTruthy()
    );
    fireEvent.press(screen.getByTestId('quiz-review-toggle'));

    expect(screen.getByText('It was France — you picked Spain')).toBeTruthy();
  });

  it('stamps reviewed rows with country artwork when the country is known', async () => {
    // The screen reads countries through useCountries' module-level cache;
    // reset it so this test's one-off mock is what the mount reads.
    invalidateCountriesCache();
    (getAllCountries as jest.Mock).mockResolvedValueOnce([
      { code: 'FR', name: 'France', region: 'Europe', subregion: null, recognition: null },
    ]);
    mockQuizDetail(makeDetail({ state: 'playable', score_to_beat: { correct: 3, total: 5 } }));
    mockLoadPlayState.mockResolvedValue(makePlayState(['q0', 'q1', 'q2', 'q3', 'q4']));

    renderResultsScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-review-toggle')).toBeTruthy());
    fireEvent.press(screen.getByTestId('quiz-review-toggle'));

    // The stamp accent is post-answer only, inside the opened review rows.
    await waitFor(() => expect(screen.getByTestId('quiz-review-stamp-0')).toBeTruthy());

    // Drop the France entry from the shared cache so later mounts see the
    // default empty countries again, as they did before this test ran.
    invalidateCountriesCache();
  });

  it('forces answering a swapped-in photo before share is available', async () => {
    mockQuizDetail(makeDetail({ state: 'playable', score_to_beat: { correct: 3, total: 5 } }));
    // q2 was swapped: its stored answer is gone.
    mockLoadPlayState.mockResolvedValue(makePlayState(['q0', 'q1', 'q3', 'q4']));

    const { navigation } = renderResultsScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-answer-new')).toBeTruthy());
    expect(screen.queryByTestId('quiz-share')).toBeNull();

    fireEvent.press(screen.getByTestId('quiz-answer-new'));
    expect(navigation.navigate).toHaveBeenCalledWith('QuizPlay', { quizId: QUIZ_ID });
  });

  it('swaps a photo through the picker and sends the owner back to answer it', async () => {
    mockQuizDetail(makeDetail({ state: 'playable', score_to_beat: { correct: 3, total: 5 } }));
    mockLoadPlayState.mockResolvedValue(makePlayState(['q0', 'q1', 'q2', 'q3', 'q4']));
    const candidate = {
      id: 'asset-9',
      uri: 'file:///photos/asset-9.jpg',
      creationTime: new Date('2021-06-01').getTime(),
      latitude: 48.85,
      longitude: 2.35,
      countryCode: 'FR',
    };
    mockLoadSwapCandidates.mockResolvedValue([candidate]);
    mockUploadSwapPhoto.mockResolvedValue({
      storagePath: `quiz/${QUIZ_ID}/new-object.jpg`,
      countryCode: 'FR',
      landscape: null,
    });
    mockPostRoutes({
      [`/quiz/${QUIZ_ID}/questions/q2/swap`]: makeDetail({
        state: 'playable',
        score_to_beat: { correct: 3, total: 5 },
      }),
    });

    const { navigation } = renderResultsScreen();

    // Swap chips live inside the opened Review Answers rows (pre-share only).
    await waitFor(() => expect(screen.getByTestId('quiz-review-toggle')).toBeTruthy());
    fireEvent.press(screen.getByTestId('quiz-review-toggle'));

    await waitFor(() => expect(screen.getByTestId('quiz-swap-2')).toBeTruthy());
    fireEvent.press(screen.getByTestId('quiz-swap-2'));

    await waitFor(() => expect(screen.getByTestId('quiz-swap-candidate-0')).toBeTruthy());
    fireEvent.press(screen.getByTestId('quiz-swap-candidate-0'));

    await waitFor(() =>
      expect(navigation.navigate).toHaveBeenCalledWith('QuizPlay', { quizId: QUIZ_ID })
    );
    expect(mockUploadSwapPhoto).toHaveBeenCalledWith(QUIZ_ID, candidate);
    expect(mockApiPost).toHaveBeenCalledWith(`/quiz/${QUIZ_ID}/questions/q2/swap`, {
      storage_path: `quiz/${QUIZ_ID}/new-object.jpg`,
      country_code: 'FR',
      landscape: null,
    });
  });

  it('remove rescales the displayed score to X of N', async () => {
    const sixQuestions = [0, 1, 2, 3, 4, 5].map((n) => makeQuestion(n));
    mockQuizDetail(
      makeDetail({
        state: 'playable',
        questions: sixQuestions,
        score_to_beat: { correct: 5, total: 6 },
      })
    );
    mockLoadPlayState.mockResolvedValue(makePlayState(['q0', 'q1', 'q2', 'q3', 'q4', 'q5']));
    mockApiDelete.mockResolvedValue({
      data: makeDetail({ state: 'playable', score_to_beat: { correct: 4, total: 5 } }),
    });

    renderResultsScreen({
      ...COMPLETE_RESULTS,
      correct: 5,
      total: 6,
      score_to_beat: { correct: 5, total: 6 },
    });

    await waitFor(() =>
      expect(within(screen.getByTestId('quiz-score-to-beat')).getByText('6')).toBeTruthy()
    );
    fireEvent.press(screen.getByTestId('quiz-review-toggle'));
    await waitFor(() => expect(screen.getByTestId('quiz-remove-5')).toBeTruthy());
    fireEvent.press(screen.getByTestId('quiz-remove-5'));

    // 5 of 6 rescales to 4 of 5: the '4' numeral only exists post-remove.
    await waitFor(() =>
      expect(within(screen.getByTestId('quiz-score-to-beat')).getByText('4')).toBeTruthy()
    );
    expect(within(screen.getByTestId('quiz-score-to-beat')).getByText('5')).toBeTruthy();
    expect(within(screen.getByTestId('quiz-score-to-beat')).queryByText('6')).toBeNull();
    expect(mockApiDelete).toHaveBeenCalledWith(`/quiz/${QUIZ_ID}/questions/q5`);
  });

  it('hides swap and remove once the quiz is shared', async () => {
    mockQuizDetail(
      makeDetail({
        state: 'shared',
        score_to_beat: { correct: 3, total: 5 },
        slug: 'abc123slug',
        share_url: 'https://borderbadge.app/q/abc123slug',
      })
    );
    mockLoadPlayState.mockResolvedValue(makePlayState(['q0', 'q1', 'q2', 'q3', 'q4']));

    renderResultsScreen({ ...COMPLETE_RESULTS, state: 'shared' });

    await waitFor(() => expect(screen.getByTestId('quiz-score-to-beat')).toBeTruthy());
    // Even inside the opened review, the pre-share-only chips are gone.
    fireEvent.press(screen.getByTestId('quiz-review-toggle'));
    await waitFor(() => expect(screen.getByTestId('quiz-review-0')).toBeTruthy());
    expect(screen.queryByTestId('quiz-swap-0')).toBeNull();
    expect(screen.queryByTestId('quiz-remove-0')).toBeNull();
    // Re-sharing an already-shared quiz stays possible (idempotent slug).
    expect(screen.getByTestId('quiz-share')).toBeTruthy();
  });

  it('share sends the challenge link as its own url item, not buried in text (Q10)', async () => {
    const shareSpy = jest
      .spyOn(ShareModule.Share, 'share')
      .mockResolvedValue({ action: 'sharedAction' } as never);
    mockQuizDetail(makeDetail({ state: 'playable', score_to_beat: { correct: 3, total: 5 } }));
    mockLoadPlayState.mockResolvedValue(makePlayState(['q0', 'q1', 'q2', 'q3', 'q4']));
    mockPostRoutes({
      [`/quiz/${QUIZ_ID}/share`]: {
        slug: 'abc123slug',
        share_url: 'https://borderbadge.app/q/abc123slug',
        state: 'shared',
      },
    });

    renderResultsScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-share')).toBeTruthy());
    // The primary action carries the challenge framing from the mockup.
    expect(screen.getByText('Challenge Your Friends')).toBeTruthy();
    fireEvent.press(screen.getByTestId('quiz-share'));

    await waitFor(() => expect(shareSpy).toHaveBeenCalled());
    const content = shareSpy.mock.calls[0][0] as { message?: string; url?: string };
    // iOS: the link travels in the url slot so destinations unfurl it.
    expect(content.url).toBe('https://borderbadge.app/q/abc123slug');
    expect(content.message).not.toContain('https://borderbadge.app/q/abc123slug');
    // Challenge framing carries the photo count and the score to beat.
    expect(content.message).toBe(
      'Guess where in the world these 5 photos were taken. I got 3/5 — beat me.'
    );
    shareSpy.mockRestore();
  });

  it('surfaces a share rejection with an alert carrying the server message', async () => {
    // e.g. the backend 409s with QUIZ_OWNER_ANSWERS_INCOMPLETE after a swap:
    // the failure must be visible, not swallowed into a console.warn.
    mockQuizDetail(makeDetail({ state: 'playable', score_to_beat: { correct: 3, total: 5 } }));
    mockLoadPlayState.mockResolvedValue(makePlayState(['q0', 'q1', 'q2', 'q3', 'q4']));
    mockApiPost.mockImplementation((url: string) =>
      url === `/quiz/${QUIZ_ID}/share`
        ? Promise.reject(
            Object.assign(new Error('Request failed with status code 409'), {
              response: {
                status: 409,
                data: {
                  detail: {
                    code: 'QUIZ_OWNER_ANSWERS_INCOMPLETE',
                    message: 'Answer every question (including swapped photos) before sharing.',
                  },
                },
              },
            })
          )
        : Promise.reject(new Error(`Unexpected POST ${url}`))
    );

    renderResultsScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-share')).toBeTruthy());
    fireEvent.press(screen.getByTestId('quiz-share'));

    await waitFor(() => expect(mockAlert).toHaveBeenCalledTimes(1));
    expect(mockAlert).toHaveBeenCalledWith(
      'Error',
      expect.stringContaining('Answer every question')
    );
  });

  it('revoke confirms with the disclosure, then calls the revoke mutation', async () => {
    mockQuizDetail(
      makeDetail({
        state: 'shared',
        score_to_beat: { correct: 3, total: 5 },
        slug: 'abc123slug',
        share_url: 'https://borderbadge.app/q/abc123slug',
      })
    );
    mockLoadPlayState.mockResolvedValue(makePlayState(['q0', 'q1', 'q2', 'q3', 'q4']));
    mockPostRoutes({
      [`/quiz/${QUIZ_ID}/revoke`]: {
        state: 'revoked',
        revoked_at: '2026-08-11T00:00:00+00:00',
        objects_deleted: true,
      },
    });

    renderResultsScreen({ ...COMPLETE_RESULTS, state: 'shared' });

    await waitFor(() => expect(screen.getByTestId('quiz-revoke')).toBeTruthy());
    fireEvent.press(screen.getByTestId('quiz-revoke'));

    // The confirmation dialog carries the honest disclosure: already-delivered
    // previews cached by messaging apps may persist, and the photo edges only
    // expire within about a minute. Nothing is revoked yet.
    expect(mockAlert).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = mockAlert.mock.calls[0];
    expect(title).toMatch(/revoke/i);
    expect(message).toMatch(/previews already delivered/i);
    expect(message).toMatch(/may persist/i);
    expect(message).toMatch(/about a minute/i);
    expect(mockApiPost).not.toHaveBeenCalled();

    // Cancel stays put; the destructive confirm fires the mutation.
    const confirm = (buttons as { text: string; style?: string; onPress?: () => void }[]).find(
      (b) => b.style === 'destructive'
    );
    expect(confirm).toBeTruthy();
    confirm?.onPress?.();

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(`/quiz/${QUIZ_ID}/revoke`));
  });

  it('shows the revoked note (no share, no revoke) once the quiz is revoked', async () => {
    mockQuizDetail(makeDetail({ state: 'revoked', score_to_beat: { correct: 3, total: 5 } }));
    mockLoadPlayState.mockResolvedValue(makePlayState(['q0', 'q1', 'q2', 'q3', 'q4']));

    renderResultsScreen({ ...COMPLETE_RESULTS, state: 'revoked' });

    await waitFor(() => expect(screen.getByTestId('quiz-revoked-note')).toBeTruthy());
    expect(screen.queryByTestId('quiz-share')).toBeNull();
    expect(screen.queryByTestId('quiz-revoke')).toBeNull();
  });
});
