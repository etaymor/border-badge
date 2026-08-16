/**
 * Tests for the quiz challenge share card (Travel Photo Quiz U6).
 *
 * Covers:
 * - QuizChallengeVariant renders the score-to-beat as the dominant element
 *   plus owner attribution at the fixed card dimensions, without overflow at
 *   the longest display name (50 chars)
 * - the X-of-N framing tracks the quiz size (5-photo quiz renders "of 5")
 * - the card never renders quiz photos (public share artifact)
 * - QuizResultsScreen share captures the card with the established view-shot
 *   options and hands the result to the Share wrapper alongside the
 *   challenge-framed message
 */

import { StyleSheet } from 'react-native';

import { fireEvent, render, screen, waitFor } from '../utils/testUtils';
import { createMockNavigation } from '../utils/mockFactories';

import { api } from '@services/api';
import * as ShareModule from '@utils/share';
import { OnboardingShareCard } from '@components/share/OnboardingShareCard';
import { QuizChallengeVariant } from '@components/share/variants/QuizChallengeVariant';
import { CARD_HEIGHT, CARD_WIDTH } from '@components/share/constants';
import type { QuizChallengeContext } from '@components/share/types';
import type { QuizDetail, QuizQuestion } from '@hooks/useQuizzes';
import type { RootStackScreenProps } from '@navigation/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// The creation orchestration drags in the photo-import stack; U6 never runs it.
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

// Mock ViewShot recording the options it was mounted with (the established
// capture options are part of the contract under test).
const mockCapture = jest.fn().mockResolvedValue('file:///tmp/quiz-challenge-card.png');
const viewShotOptions: unknown[] = [];
jest.mock('react-native-view-shot', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const MockViewShot = React.forwardRef(
    (
      { children, options }: { children: React.ReactNode; options?: unknown },
      ref: React.Ref<unknown>
    ) => {
      viewShotOptions.push(options);
      React.useImperativeHandle(ref, () => ({ capture: mockCapture }));
      return <>{children}</>;
    }
  );
  MockViewShot.displayName = 'MockViewShot';
  return { __esModule: true, default: MockViewShot };
});

import { loadPlayState, type QuizPlayState } from '@services/quiz/quizPlay';
import { QuizResultsScreen } from '@screens/quiz/QuizResultsScreen';

const mockLoadPlayState = loadPlayState as jest.MockedFunction<typeof loadPlayState>;
const mockApiGet = api.get as jest.Mock;
const mockApiPost = api.post as jest.Mock;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const QUIZ_ID = 'quiz-1';
const LONGEST_NAME = 'Maximiliana Wilhelmina von Hohenberg-Strassburger'.padEnd(50, 'x');

function makeContext(overrides?: Partial<QuizChallengeContext>): QuizChallengeContext {
  return {
    ownerDisplayName: 'Emerson',
    scoreToBeat: { correct: 3, total: 5 },
    ...overrides,
  };
}

function makeQuestion(n: number): QuizQuestion {
  return {
    id: `q${n}`,
    position: n,
    image_url: `https://cdn.example/quiz/q${n}.jpg`,
    options: ['France', 'Spain', 'Italy', 'Portugal'],
    year_options: null,
  };
}

function makeDetail(overrides?: Partial<QuizDetail>): QuizDetail {
  return {
    id: QUIZ_ID,
    state: 'playable',
    questions: [0, 1, 2, 3, 4].map((n) => makeQuestion(n)),
    score_to_beat: { correct: 3, total: 5 },
    slug: null,
    share_url: null,
    ...overrides,
  };
}

function makePlayState(): QuizPlayState {
  return {
    quizId: QUIZ_ID,
    sessionId: 'session-1',
    answers: Object.fromEntries(
      ['q0', 'q1', 'q2', 'q3', 'q4'].map((id) => [
        id,
        {
          questionId: id,
          selectedOptionIndex: 0,
          selectedYear: null,
          placeCorrect: true,
          yearCorrect: null,
          correctOptionIndex: 0,
          correctOption: 'France',
          correctYear: null,
        },
      ])
    ),
  };
}

const RESULTS = {
  correct: 3,
  total: 5,
  memory_correct: 0,
  memory_total: 0,
  score_to_beat: { correct: 3, total: 5 },
  state: 'playable',
};

function renderResultsScreen() {
  const navigation =
    createMockNavigation() as unknown as RootStackScreenProps<'QuizResults'>['navigation'];
  const route = {
    key: 'test-results',
    name: 'QuizResults',
    params: { quizId: QUIZ_ID, results: RESULTS },
  } as RootStackScreenProps<'QuizResults'>['route'];
  render(<QuizResultsScreen navigation={navigation} route={route} />);
  return { navigation };
}

beforeEach(() => {
  jest.clearAllMocks();
  viewShotOptions.length = 0;
  mockCapture.mockResolvedValue('file:///tmp/quiz-challenge-card.png');
});

// ---------------------------------------------------------------------------
// QuizChallengeVariant (the card itself)
// ---------------------------------------------------------------------------

describe('QuizChallengeVariant', () => {
  it('renders the score-to-beat as the dominant element with owner attribution', () => {
    render(<QuizChallengeVariant context={makeContext()} />);

    // 5-photo quiz: X-of-5 framing.
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('of 5')).toBeTruthy();
    expect(screen.getByText(/Emerson/)).toBeTruthy();
  });

  it('renders at the fixed card dimensions', () => {
    render(<QuizChallengeVariant context={makeContext()} />);

    const card = screen.getByTestId('quiz-challenge-card');
    const style = StyleSheet.flatten(card.props.style);
    expect(style.width).toBe(CARD_WIDTH);
    expect(style.height).toBe(CARD_HEIGHT);
  });

  it('guards the longest display name (50 chars) against overflow', () => {
    expect(LONGEST_NAME).toHaveLength(50);

    render(<QuizChallengeVariant context={makeContext({ ownerDisplayName: LONGEST_NAME })} />);

    const attribution = screen.getByTestId('quiz-challenge-attribution');
    expect(attribution.props.children).toContain(LONGEST_NAME);
    // The name line is bounded: it wraps at most twice and shrinks to fit
    // rather than overflowing the fixed-size card.
    expect(attribution.props.numberOfLines).toBe(2);
    expect(attribution.props.adjustsFontSizeToFit).toBe(true);
  });

  it('falls back to generic attribution when the profile has no display name', () => {
    render(<QuizChallengeVariant context={makeContext({ ownerDisplayName: null })} />);

    expect(screen.getByTestId('quiz-challenge-attribution')).toBeTruthy();
    expect(screen.queryByText(/Emerson/)).toBeNull();
  });

  it('tracks the quiz size in the X-of-N framing', () => {
    render(
      <QuizChallengeVariant context={makeContext({ scoreToBeat: { correct: 5, total: 6 } })} />
    );

    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('of 6')).toBeTruthy();
  });

  it('never renders quiz photos (always the public share artifact)', () => {
    const { toJSON } = render(<QuizChallengeVariant context={makeContext()} />);

    // The only Image on the card is the bundled logo; no remote uri sources.
    const serialized = JSON.stringify(toJSON());
    expect(serialized).not.toContain('https://');
    expect(serialized).not.toContain('file://');
  });

  it('is reachable through the OnboardingShareCard variant switch', () => {
    render(<OnboardingShareCard variant="quizChallenge" context={makeContext()} />);

    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('of 5')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// QuizResultsScreen share wiring (Q10: link as its own activity item)
// ---------------------------------------------------------------------------

describe('QuizResultsScreen share wiring (Q10)', () => {
  function mockRoutes() {
    mockApiGet.mockImplementation((url: string) => {
      if (url === `/quiz/${QUIZ_ID}`) return Promise.resolve({ data: makeDetail() });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    mockApiPost.mockImplementation((url: string) => {
      if (url === `/quiz/${QUIZ_ID}/share`) {
        return Promise.resolve({
          data: {
            slug: 'abc123slug',
            share_url: 'https://borderbadge.app/q/abc123slug',
            state: 'shared',
          },
        });
      }
      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });
    mockLoadPlayState.mockResolvedValue(makePlayState());
  }

  it('no longer mounts a card-capture host: the link is the shared artifact', async () => {
    mockRoutes();

    renderResultsScreen();
    await waitFor(() => expect(screen.getByTestId('quiz-share')).toBeTruthy());

    // Q10 resolved the payload conflict in favor of the link: the results
    // screen ships no ViewShot host, and the unfurl card on the destination
    // page carries the visual.
    expect(viewShotOptions).toHaveLength(0);
    expect(screen.queryByTestId('quiz-challenge-card')).toBeNull();
  });

  it('shares the challenge link in the url slot with a link-free message (iOS)', async () => {
    const shareSpy = jest
      .spyOn(ShareModule.Share, 'share')
      .mockResolvedValue({ action: 'sharedAction' } as never);
    mockRoutes();

    renderResultsScreen();
    await waitFor(() => expect(screen.getByTestId('quiz-share')).toBeTruthy());

    fireEvent.press(screen.getByTestId('quiz-share'));

    await waitFor(() => expect(shareSpy).toHaveBeenCalled());
    expect(mockCapture).not.toHaveBeenCalled();
    const content = shareSpy.mock.calls[0][0] as { message?: string; url?: string };
    expect(content.url).toBe('https://borderbadge.app/q/abc123slug');
    expect(content.message).not.toContain('https://');
    expect(content.message).toMatch(/3 of 5/);
    shareSpy.mockRestore();
  });
});
