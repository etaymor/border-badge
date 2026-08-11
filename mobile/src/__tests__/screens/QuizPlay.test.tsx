/**
 * Tests for the U5 owner play flow: QuizPlayScreen + QuizResultsScreen.
 *
 * Covers the U5 requirements:
 * - answering all country questions surfaces the seeded score-to-beat, and the
 *   year (memory) results render only in the owner view (AE3)
 * - immediate feedback reveals the correct country on a wrong answer
 * - mid-play kill + relaunch resumes at the next ungraded question (the
 *   persisted play state carries the graded answers)
 * - a swap forces answering the new photo before share becomes available;
 *   remove rescales the displayed score to X of N
 * - after sharing, the swap and remove affordances are gone
 * - share invokes the share sheet with a URL containing the minted slug
 */

import { fireEvent, render, screen, waitFor } from '../utils/testUtils';
import { createMockNavigation } from '../utils/mockFactories';

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
import { QuizPlayScreen } from '@screens/quiz/QuizPlayScreen';
import { QuizResultsScreen } from '@screens/quiz/QuizResultsScreen';

const mockEnsurePlaySession = ensurePlaySession as jest.MockedFunction<typeof ensurePlaySession>;
const mockLoadPlayState = loadPlayState as jest.MockedFunction<typeof loadPlayState>;
const mockRecordAnswer = recordAnswer as jest.MockedFunction<typeof recordAnswer>;
const mockLoadSwapCandidates = loadSwapCandidates as jest.MockedFunction<typeof loadSwapCandidates>;
const mockUploadSwapPhoto = uploadSwapPhoto as jest.MockedFunction<typeof uploadSwapPhoto>;

const mockApiGet = api.get as jest.Mock;
const mockApiPost = api.post as jest.Mock;
const mockApiDelete = api.delete as jest.Mock;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const QUIZ_ID = 'quiz-1';
const SESSION_ID = 'session-1';
const OPTIONS = ['France', 'Spain', 'Italy', 'Portugal'];

function makeQuestion(n: number, yearOptions: number[] | null = null): QuizQuestion {
  return {
    id: `q${n}`,
    position: n,
    image_url: `https://cdn.example/quiz/q${n}.jpg`,
    options: OPTIONS,
    year_options: yearOptions,
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
    selectedYear: null,
    placeCorrect: true,
    yearCorrect: null,
    correctOptionIndex: 0,
    correctOption: 'France',
    correctYear: null,
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
  memory_correct: 2,
  memory_total: 4,
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

function renderResultsScreen(results = COMPLETE_RESULTS) {
  const navigation =
    createMockNavigation() as unknown as RootStackScreenProps<'QuizResults'>['navigation'];
  const route = {
    key: 'test-results',
    name: 'QuizResults',
    params: { quizId: QUIZ_ID, results },
  } as RootStackScreenProps<'QuizResults'>['route'];
  render(<QuizResultsScreen navigation={navigation} route={route} />);
  return { navigation };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockRecordAnswer.mockImplementation(async (state, answer) => ({
    ...state,
    answers: { ...state.answers, [answer.questionId]: answer },
  }));
  mockLoadSwapCandidates.mockResolvedValue([]);
});

describe('QuizPlayScreen', () => {
  it('resumes at the next ungraded question after a mid-play kill', async () => {
    // Two answers already graded in the persisted session: resume at photo 3.
    mockQuizDetail(makeDetail());
    mockEnsurePlaySession.mockResolvedValue(makePlayState(['q0', 'q1']));

    renderPlayScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-play-progress')).toBeTruthy());
    expect(screen.getByText('Photo 3 of 5')).toBeTruthy();
    expect(screen.getByTestId('quiz-play-photo').props.source.uri).toBe(
      'https://cdn.example/quiz/q2.jpg'
    );
    // Resuming never starts a fresh grading pass on already-answered questions.
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('shows the correct country immediately on a wrong answer', async () => {
    mockQuizDetail(makeDetail());
    mockEnsurePlaySession.mockResolvedValue(makePlayState([]));
    mockPostRoutes({
      [`/quiz/${QUIZ_ID}/answer`]: {
        place_correct: false,
        year_correct: null,
        correct_option_index: 0,
        correct_option: 'France',
        correct_year: null,
        score: 0,
      },
    });

    renderPlayScreen();

    await waitFor(() => expect(screen.getByText('Spain')).toBeTruthy());
    fireEvent.press(screen.getByText('Spain'));

    await waitFor(() => expect(screen.getByTestId('quiz-feedback')).toBeTruthy());
    expect(screen.getByText(/France/)).toBeTruthy();
    expect(mockApiPost).toHaveBeenCalledWith(
      `/quiz/${QUIZ_ID}/answer`,
      expect.objectContaining({
        session_id: SESSION_ID,
        question_id: 'q0',
        selected_option_index: 1,
        selected_year: null,
      })
    );
  });

  it('asks the year question for the same photo and grades both in one call', async () => {
    mockQuizDetail(
      makeDetail({
        questions: [
          makeQuestion(0, [2018, 2019, 2020, 2021]),
          ...[1, 2, 3, 4].map((n) => makeQuestion(n)),
        ],
      })
    );
    mockEnsurePlaySession.mockResolvedValue(makePlayState([]));
    mockPostRoutes({
      [`/quiz/${QUIZ_ID}/answer`]: {
        place_correct: true,
        year_correct: true,
        correct_option_index: 1,
        correct_option: 'Spain',
        correct_year: 2019,
        score: 1,
      },
    });

    renderPlayScreen();

    await waitFor(() => expect(screen.getByText('Spain')).toBeTruthy());
    fireEvent.press(screen.getByText('Spain'));

    // The year memory question comes BEFORE any grading round-trip.
    await waitFor(() => expect(screen.getByTestId('quiz-year-prompt')).toBeTruthy());
    expect(mockApiPost).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('2019'));
    await waitFor(() => expect(screen.getByTestId('quiz-feedback')).toBeTruthy());
    expect(mockApiPost).toHaveBeenCalledWith(
      `/quiz/${QUIZ_ID}/answer`,
      expect.objectContaining({ selected_option_index: 1, selected_year: 2019 })
    );
  });

  it('completes after the last answer and hands the seeded score-to-beat to results', async () => {
    mockQuizDetail(makeDetail());
    mockEnsurePlaySession.mockResolvedValue(makePlayState(['q0', 'q1', 'q2', 'q3']));
    mockPostRoutes({
      [`/quiz/${QUIZ_ID}/answer`]: {
        place_correct: true,
        year_correct: null,
        correct_option_index: 0,
        correct_option: 'France',
        correct_year: null,
        score: 3,
      },
      [`/quiz/${QUIZ_ID}/complete`]: COMPLETE_RESULTS,
    });

    const { navigation } = renderPlayScreen();

    await waitFor(() => expect(screen.getByText('Photo 5 of 5')).toBeTruthy());
    fireEvent.press(screen.getByText('France'));

    await waitFor(() => expect(screen.getByTestId('quiz-feedback')).toBeTruthy());
    fireEvent.press(screen.getByText('See Results'));

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

describe('QuizResultsScreen', () => {
  it('shows the seeded score-to-beat and the owner-only memory score (AE3)', async () => {
    mockQuizDetail(makeDetail({ state: 'playable', score_to_beat: { correct: 3, total: 5 } }));
    mockLoadPlayState.mockResolvedValue(makePlayState(['q0', 'q1', 'q2', 'q3', 'q4']));

    renderResultsScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-score-to-beat')).toBeTruthy());
    expect(screen.getByText('3 of 5')).toBeTruthy();
    const memory = screen.getByTestId('quiz-memory-score');
    expect(memory).toBeTruthy();
    expect(screen.getByText(/2 of 4/)).toBeTruthy();
    expect(screen.getByText(/Only you/)).toBeTruthy();
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
      captureYear: 2021,
    });
    mockPostRoutes({
      [`/quiz/${QUIZ_ID}/questions/q2/swap`]: makeDetail({
        state: 'playable',
        score_to_beat: { correct: 3, total: 5 },
      }),
    });

    const { navigation } = renderResultsScreen();

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
      capture_year: 2021,
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

    await waitFor(() => expect(screen.getByText('5 of 6')).toBeTruthy());
    fireEvent.press(screen.getByTestId('quiz-remove-5'));

    await waitFor(() => expect(screen.getByText('4 of 5')).toBeTruthy());
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
    expect(screen.queryByTestId('quiz-swap-0')).toBeNull();
    expect(screen.queryByTestId('quiz-remove-0')).toBeNull();
    // Re-sharing an already-shared quiz stays possible (idempotent slug).
    expect(screen.getByTestId('quiz-share')).toBeTruthy();
  });

  it('share invokes the share sheet with a URL containing the minted slug', async () => {
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
    fireEvent.press(screen.getByTestId('quiz-share'));

    await waitFor(() => expect(shareSpy).toHaveBeenCalled());
    const content = shareSpy.mock.calls[0][0] as { message?: string };
    expect(content.message).toContain('https://borderbadge.app/q/abc123slug');
    // Challenge framing carries the score to beat.
    expect(content.message).toMatch(/3 of 5/);
    shareSpy.mockRestore();
  });
});
