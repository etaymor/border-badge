/**
 * Tests for the U11 owner management surface: MyQuizzesScreen +
 * QuizLeaderboardScreen.
 *
 * Covers the U11 requirements:
 * - every quiz renders its lifecycle state with the right actions
 *   (draft -> resume/delete; ready to play -> play/delete; ready to share ->
 *   share; shared -> view leaderboard/revoke; revoked -> no public actions)
 * - a second quiz appears alongside the first with independent data (R17),
 *   plus the create-another entry point
 * - the owner leaderboard (R14/AE4) shows best score per name with attempt
 *   counts, the score-to-beat pinned on top, and hidden entries marked
 * - hiding an entry confirms, calls the hide endpoint for every session
 *   behind the entry, and refreshes the board
 * - the leaderboard query is invalidated (refetched) after the owner shares
 *   or revokes
 */

import { fireEvent, render, screen, waitFor, within } from '../utils/testUtils';
import { createMockNavigation } from '../utils/mockFactories';

// Access the mock Alert from global (set in jest.setup.js).
declare global {
  // eslint-disable-next-line no-var
  var __mockAlert: {
    alert: jest.Mock;
  };
}
const mockAlert = global.__mockAlert.alert;

import { api } from '@services/api';
import type { QuizOwnerLeaderboard, QuizSummary } from '@hooks/useQuizzes';
import type { RootStackScreenProps } from '@navigation/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// The creation orchestration drags in the photo-import stack; U11 never runs it.
jest.mock('@services/quiz/quizCreation', () => ({
  createQuizFromLibrary: jest.fn(),
  loadDraftState: jest.fn().mockResolvedValue(null),
  clearDraftState: jest.fn(),
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

import { loadPlayState } from '@services/quiz/quizPlay';
import { MyQuizzesScreen } from '@screens/quiz/MyQuizzesScreen';
import { QuizLeaderboardScreen } from '@screens/quiz/QuizLeaderboardScreen';
import { QuizResultsScreen } from '@screens/quiz/QuizResultsScreen';
import * as ShareModule from '@utils/share';

const mockLoadPlayState = loadPlayState as jest.MockedFunction<typeof loadPlayState>;

const mockApiGet = api.get as jest.Mock;
const mockApiPost = api.post as jest.Mock;
const mockApiDelete = api.delete as jest.Mock;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSummary(overrides?: Partial<QuizSummary>): QuizSummary {
  return {
    id: 'quiz-1',
    state: 'building',
    slug: null,
    share_url: null,
    score_to_beat: null,
    question_count: 0,
    created_at: '2026-08-01T00:00:00+00:00',
    revoked_at: null,
    ...overrides,
  };
}

function makeBoard(overrides?: Partial<QuizOwnerLeaderboard>): QuizOwnerLeaderboard {
  return {
    score_to_beat: { correct: 3, total: 5 },
    leaderboard: [
      // AE4: one row per name -- best score with the attempt count behind it.
      { display_name: 'Troll', best_score: 5, attempts: 1, hidden: true, session_ids: ['s4'] },
      {
        display_name: 'Maya',
        best_score: 4,
        attempts: 2,
        hidden: false,
        session_ids: ['s1', 's2'],
      },
      { display_name: 'Sam', best_score: 3, attempts: 1, hidden: false, session_ids: ['s3'] },
    ],
    ...overrides,
  };
}

function mockGetRoutes(routes: Record<string, unknown | (() => unknown)>) {
  mockApiGet.mockImplementation((url: string) => {
    if (url in routes) {
      const value = routes[url];
      return Promise.resolve({
        data: typeof value === 'function' ? (value as () => unknown)() : value,
      });
    }
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
}

function mockPostRoutes(routes: Record<string, unknown>) {
  mockApiPost.mockImplementation((url: string) =>
    url in routes
      ? Promise.resolve({ data: routes[url] })
      : Promise.reject(new Error(`Unexpected POST ${url}`))
  );
}

function confirmDestructiveAlert() {
  expect(mockAlert).toHaveBeenCalled();
  const buttons = mockAlert.mock.calls[mockAlert.mock.calls.length - 1][2] as {
    text: string;
    style?: string;
    onPress?: () => void;
  }[];
  const confirm = buttons.find((b) => b.style === 'destructive');
  expect(confirm).toBeTruthy();
  confirm?.onPress?.();
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function renderList() {
  const navigation =
    createMockNavigation() as unknown as RootStackScreenProps<'MyQuizzes'>['navigation'];
  const route = {
    key: 'test-my-quizzes',
    name: 'MyQuizzes',
  } as RootStackScreenProps<'MyQuizzes'>['route'];
  const result = render(<MyQuizzesScreen navigation={navigation} route={route} />);
  return { navigation, queryClient: result.queryClient };
}

function leaderboardProps(quizId: string) {
  const navigation =
    createMockNavigation() as unknown as RootStackScreenProps<'QuizLeaderboard'>['navigation'];
  const route = {
    key: 'test-leaderboard',
    name: 'QuizLeaderboard',
    params: { quizId },
  } as RootStackScreenProps<'QuizLeaderboard'>['route'];
  return { navigation, route };
}

function renderLeaderboard(quizId = 'quiz-1') {
  const props = leaderboardProps(quizId);
  render(<QuizLeaderboardScreen {...props} />);
  return props;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

describe('MyQuizzesScreen', () => {
  it('renders every lifecycle state with its correct actions', async () => {
    mockGetRoutes({
      '/quiz': {
        quizzes: [
          makeSummary({ id: 'q-draft', state: 'building' }),
          makeSummary({ id: 'q-await', state: 'awaiting_owner_play', question_count: 5 }),
          makeSummary({
            id: 'q-play',
            state: 'playable',
            question_count: 5,
            score_to_beat: { correct: 3, total: 5 },
          }),
          makeSummary({
            id: 'q-shared',
            state: 'shared',
            question_count: 5,
            score_to_beat: { correct: 4, total: 5 },
            slug: 'slug-1',
            share_url: 'https://borderbadge.app/q/slug-1',
          }),
          makeSummary({
            id: 'q-revoked',
            state: 'revoked',
            question_count: 5,
            revoked_at: '2026-08-10T00:00:00+00:00',
          }),
        ],
      },
    });

    renderList();

    await waitFor(() => expect(screen.getByTestId('quiz-row-q-draft')).toBeTruthy());
    // State labels.
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(screen.getByText('Ready to play')).toBeTruthy();
    expect(screen.getByText('Ready to share')).toBeTruthy();
    expect(screen.getByText('Shared')).toBeTruthy();
    expect(screen.getByText('Revoked')).toBeTruthy();

    // Draft: resume + delete.
    expect(screen.getByTestId('quiz-resume-q-draft')).toBeTruthy();
    expect(screen.getByTestId('quiz-delete-q-draft')).toBeTruthy();
    // Awaiting owner play: play + delete (still a pre-play, resumable state).
    expect(screen.getByTestId('quiz-play-q-await')).toBeTruthy();
    expect(screen.getByTestId('quiz-delete-q-await')).toBeTruthy();
    // Playable: share only.
    expect(screen.getByTestId('quiz-share-q-play')).toBeTruthy();
    expect(screen.queryByTestId('quiz-delete-q-play')).toBeNull();
    // Shared: leaderboard + revoke.
    expect(screen.getByTestId('quiz-leaderboard-q-shared')).toBeTruthy();
    expect(screen.getByTestId('quiz-revoke-q-shared')).toBeTruthy();
    // Revoked: no public actions at all.
    for (const action of ['resume', 'play', 'share', 'leaderboard', 'revoke', 'delete']) {
      expect(screen.queryByTestId(`quiz-${action}-q-revoked`)).toBeNull();
    }
  });

  it('routes each action to its screen', async () => {
    mockGetRoutes({
      '/quiz': {
        quizzes: [
          makeSummary({ id: 'q-draft', state: 'building' }),
          makeSummary({ id: 'q-await', state: 'awaiting_owner_play' }),
          makeSummary({
            id: 'q-play',
            state: 'playable',
            score_to_beat: { correct: 3, total: 5 },
          }),
          makeSummary({
            id: 'q-shared',
            state: 'shared',
            score_to_beat: { correct: 4, total: 5 },
          }),
        ],
      },
    });

    const { navigation } = renderList();

    await waitFor(() => expect(screen.getByTestId('quiz-resume-q-draft')).toBeTruthy());
    fireEvent.press(screen.getByTestId('quiz-resume-q-draft'));
    expect(navigation.navigate).toHaveBeenLastCalledWith('QuizCreation');

    fireEvent.press(screen.getByTestId('quiz-play-q-await'));
    expect(navigation.navigate).toHaveBeenLastCalledWith('QuizPlay', { quizId: 'q-await' });

    fireEvent.press(screen.getByTestId('quiz-share-q-play'));
    expect(navigation.navigate).toHaveBeenLastCalledWith('QuizResults', { quizId: 'q-play' });

    fireEvent.press(screen.getByTestId('quiz-leaderboard-q-shared'));
    expect(navigation.navigate).toHaveBeenLastCalledWith('QuizLeaderboard', {
      quizId: 'q-shared',
    });
  });

  it('shows a retryable error state when the quiz list fails to load', async () => {
    let attempt = 0;
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/quiz') {
        attempt += 1;
        // Fail first, then succeed so the retry action proves recoverable.
        if (attempt === 1) return Promise.reject(new Error('network down'));
        return Promise.resolve({ data: { quizzes: [] } });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    renderList();

    await waitFor(() => expect(screen.getByTestId('quiz-list-error')).toBeTruthy());
    // The empty branch must not have rendered in place of the error.
    expect(screen.queryByTestId('quiz-list-empty')).toBeNull();

    fireEvent.press(within(screen.getByTestId('quiz-list-error')).getByText('Try Again'));

    await waitFor(() => expect(screen.getByTestId('quiz-list-empty')).toBeTruthy());
    expect(screen.queryByTestId('quiz-list-error')).toBeNull();
  });

  it('shows a second quiz alongside the first with independent data (R17)', async () => {
    mockGetRoutes({
      '/quiz': {
        quizzes: [
          makeSummary({
            id: 'q-second',
            state: 'awaiting_owner_play',
            question_count: 7,
            created_at: '2026-08-05T00:00:00+00:00',
          }),
          makeSummary({
            id: 'q-first',
            state: 'shared',
            question_count: 5,
            score_to_beat: { correct: 4, total: 5 },
            created_at: '2026-08-01T00:00:00+00:00',
          }),
        ],
      },
    });

    const { navigation } = renderList();

    await waitFor(() => expect(screen.getByTestId('quiz-row-q-second')).toBeTruthy());
    expect(screen.getByTestId('quiz-row-q-first')).toBeTruthy();
    expect(screen.getByText(/7 photos/)).toBeTruthy();
    expect(screen.getByText(/5 photos/)).toBeTruthy();
    // Each row keeps its own actions: sharing one never blocks the other.
    expect(screen.getByTestId('quiz-play-q-second')).toBeTruthy();
    expect(screen.getByTestId('quiz-leaderboard-q-first')).toBeTruthy();

    // The create-another entry point (R17).
    fireEvent.press(screen.getByTestId('quiz-create-new'));
    expect(navigation.navigate).toHaveBeenLastCalledWith('QuizCreation');
  });

  it('deletes a draft after confirmation and refreshes the list', async () => {
    let deleted = false;
    mockGetRoutes({
      '/quiz': () => ({
        quizzes: deleted ? [] : [makeSummary({ id: 'q-draft', state: 'building' })],
      }),
    });
    mockApiDelete.mockImplementation((url: string) => {
      if (url === '/quiz/q-draft') {
        deleted = true;
        return Promise.resolve({ data: undefined });
      }
      return Promise.reject(new Error(`Unexpected DELETE ${url}`));
    });

    renderList();

    await waitFor(() => expect(screen.getByTestId('quiz-delete-q-draft')).toBeTruthy());
    fireEvent.press(screen.getByTestId('quiz-delete-q-draft'));

    // Nothing is deleted before the confirmation.
    expect(mockApiDelete).not.toHaveBeenCalled();
    confirmDestructiveAlert();

    await waitFor(() => expect(mockApiDelete).toHaveBeenCalledWith('/quiz/q-draft'));
    // The list invalidation removes the row.
    await waitFor(() => expect(screen.queryByTestId('quiz-row-q-draft')).toBeNull());
  });

  it('revoking from the list refetches the leaderboard query', async () => {
    let leaderboardGets = 0;
    mockGetRoutes({
      '/quiz': {
        quizzes: [
          makeSummary({
            id: 'q-shared',
            state: 'shared',
            score_to_beat: { correct: 3, total: 5 },
          }),
        ],
      },
      '/quiz/q-shared/leaderboard': () => {
        leaderboardGets += 1;
        return makeBoard();
      },
    });
    mockPostRoutes({
      '/quiz/q-shared/revoke': {
        state: 'revoked',
        revoked_at: '2026-08-11T00:00:00+00:00',
        objects_deleted: true,
      },
    });

    // The list and the (mounted) leaderboard share one query cache, exactly
    // as they do behind the real navigator.
    const listNav =
      createMockNavigation() as unknown as RootStackScreenProps<'MyQuizzes'>['navigation'];
    const listRoute = {
      key: 'test-my-quizzes',
      name: 'MyQuizzes',
    } as RootStackScreenProps<'MyQuizzes'>['route'];
    const boardProps = leaderboardProps('q-shared');
    render(
      <>
        <MyQuizzesScreen navigation={listNav} route={listRoute} />
        <QuizLeaderboardScreen {...boardProps} />
      </>
    );

    await waitFor(() => expect(leaderboardGets).toBe(1));
    await waitFor(() => expect(screen.getByTestId('quiz-revoke-q-shared')).toBeTruthy());
    fireEvent.press(screen.getByTestId('quiz-revoke-q-shared'));
    confirmDestructiveAlert();

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/quiz/q-shared/revoke'));
    await waitFor(() => expect(leaderboardGets).toBe(2));
  });

  it('sharing from the results screen refetches the leaderboard query', async () => {
    const shareSpy = jest
      .spyOn(ShareModule.Share, 'share')
      .mockResolvedValue({ action: 'sharedAction' } as never);
    let leaderboardGets = 0;
    mockGetRoutes({
      '/quiz/q-play': {
        id: 'q-play',
        state: 'playable',
        questions: [],
        score_to_beat: { correct: 3, total: 5 },
        slug: null,
        share_url: null,
      },
      '/quiz/q-play/leaderboard': () => {
        leaderboardGets += 1;
        return makeBoard({ leaderboard: [] });
      },
    });
    mockPostRoutes({
      '/quiz/q-play/share': {
        slug: 'slug-9',
        share_url: 'https://borderbadge.app/q/slug-9',
        state: 'shared',
      },
    });
    mockLoadPlayState.mockResolvedValue({ quizId: 'q-play', sessionId: 's-1', answers: {} });

    const resultsNav =
      createMockNavigation() as unknown as RootStackScreenProps<'QuizResults'>['navigation'];
    const resultsRoute = {
      key: 'test-results',
      name: 'QuizResults',
      params: { quizId: 'q-play' },
    } as RootStackScreenProps<'QuizResults'>['route'];
    const boardProps = leaderboardProps('q-play');
    render(
      <>
        <QuizResultsScreen navigation={resultsNav} route={resultsRoute} />
        <QuizLeaderboardScreen {...boardProps} />
      </>
    );

    await waitFor(() => expect(leaderboardGets).toBe(1));
    await waitFor(() => expect(screen.getByTestId('quiz-share')).toBeTruthy());
    fireEvent.press(screen.getByTestId('quiz-share'));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/quiz/q-play/share'));
    await waitFor(() => expect(leaderboardGets).toBe(2));
    shareSpy.mockRestore();
  });
});

describe('QuizLeaderboardScreen', () => {
  it('shows best score per name with attempt counts under the pinned score-to-beat (AE4)', async () => {
    mockGetRoutes({ '/quiz/quiz-1/leaderboard': makeBoard() });

    renderLeaderboard();

    await waitFor(() => expect(screen.getByTestId('leaderboard-score-to-beat')).toBeTruthy());
    const pinned = screen.getByTestId('leaderboard-score-to-beat');
    expect(within(pinned).getByText('3')).toBeTruthy();
    expect(within(pinned).getByText('/5')).toBeTruthy();

    // One row per name: best score, attempt count.
    const maya = screen.getByTestId('leaderboard-entry-1');
    expect(within(maya).getByText('Maya')).toBeTruthy();
    expect(within(maya).getByText('4 of 5')).toBeTruthy();
    expect(within(maya).getByText('2 tries')).toBeTruthy();
    const sam = screen.getByTestId('leaderboard-entry-2');
    expect(within(sam).getByText('Sam')).toBeTruthy();
    expect(within(sam).getByText('3 of 5')).toBeTruthy();
    expect(within(sam).getByText('1 try')).toBeTruthy();
  });

  it('marks hidden entries instead of removing them from the owner view', async () => {
    mockGetRoutes({ '/quiz/quiz-1/leaderboard': makeBoard() });

    renderLeaderboard();

    // Fixture order: Troll (hidden) first.
    await waitFor(() => expect(screen.getByTestId('leaderboard-hidden-0')).toBeTruthy());
    expect(screen.getByText('Troll')).toBeTruthy();
    // A hidden entry offers no further hide action; visible ones do.
    expect(screen.queryByTestId('leaderboard-hide-0')).toBeNull();
    expect(screen.getByTestId('leaderboard-hide-1')).toBeTruthy();
    expect(screen.getByTestId('leaderboard-hide-2')).toBeTruthy();
  });

  it('hides an entry after confirmation, calling the hide endpoint per session', async () => {
    let boardGets = 0;
    mockGetRoutes({
      '/quiz/quiz-1/leaderboard': () => {
        boardGets += 1;
        return makeBoard();
      },
    });
    mockPostRoutes({
      '/quiz/quiz-1/sessions/s1/hide': { session_id: 's1', hidden: true },
      '/quiz/quiz-1/sessions/s2/hide': { session_id: 's2', hidden: true },
    });

    renderLeaderboard();

    // Maya is index 1 in the fixture and has two sessions behind her entry.
    await waitFor(() => expect(screen.getByTestId('leaderboard-hide-1')).toBeTruthy());
    fireEvent.press(screen.getByTestId('leaderboard-hide-1'));

    expect(mockApiPost).not.toHaveBeenCalled();
    confirmDestructiveAlert();

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/quiz/quiz-1/sessions/s1/hide'));
    expect(mockApiPost).toHaveBeenCalledWith('/quiz/quiz-1/sessions/s2/hide');
    // The board refetches so the entry shows up marked hidden.
    await waitFor(() => expect(boardGets).toBe(2));
  });

  it('shows the empty state when nobody has played yet', async () => {
    mockGetRoutes({
      '/quiz/quiz-1/leaderboard': makeBoard({ leaderboard: [] }),
    });

    renderLeaderboard();

    await waitFor(() => expect(screen.getByTestId('leaderboard-empty')).toBeTruthy());
  });

  it('shows a retryable error state when the leaderboard fails to load', async () => {
    let attempt = 0;
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/quiz/quiz-1/leaderboard') {
        attempt += 1;
        if (attempt === 1) return Promise.reject(new Error('network down'));
        return Promise.resolve({ data: makeBoard({ leaderboard: [] }) });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    renderLeaderboard();

    await waitFor(() => expect(screen.getByTestId('leaderboard-error')).toBeTruthy());
    // The "no one has played yet" empty branch must not stand in for the error.
    expect(screen.queryByTestId('leaderboard-empty')).toBeNull();

    fireEvent.press(within(screen.getByTestId('leaderboard-error')).getByText('Try Again'));

    await waitFor(() => expect(screen.getByTestId('leaderboard-empty')).toBeTruthy());
    expect(screen.queryByTestId('leaderboard-error')).toBeNull();
  });
});
