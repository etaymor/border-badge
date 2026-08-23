/**
 * shareChallenge: the invitation copy and the share funnel events.
 *
 * - Settled copy: "Made a quiz from {n} of my travel photos. Guess the
 *   country on each one. I got {s}/{t}." plus a Wordle-style "Guess Where
 *   {s}/{t}" block. The score clause and the grid drop when the surface
 *   does not know them.
 * - iOS: the link travels in the dedicated url slot (Q10); Android appends
 *   it on its own line at the end of the message.
 * - Funnel: quiz_share_initiated on sheet open; quiz_share_completed ONLY
 *   when iOS reports sharedAction (Android resolves sharedAction the moment
 *   the sheet opens, so completion is never fired there).
 */

import { Platform } from 'react-native';

import {
  buildChallengeMessage,
  buildVerdictGrid,
  pickShareVerdicts,
  presentChallengeShare,
  verdictsForShare,
} from '@screens/quiz/shareChallenge';
import { Analytics } from '@services/analytics';
import { Share } from '@utils/share';

jest.mock('@utils/share', () => ({
  Share: { share: jest.fn() },
}));

jest.mock('@services/analytics', () => ({
  Analytics: {
    quizShareInitiated: jest.fn(),
    quizShareCompleted: jest.fn(),
  },
}));

const mockedShare = Share.share as jest.Mock;

const SCORE = { correct: 7, total: 10 };
const URL = 'https://atlasi.app/q/abc123';
const QUIZ_ID = 'quiz-abc';
/** The results screen is the only surface that shares a freshly minted link. */
const FIRST_SHARE = { quizId: QUIZ_ID, source: 'results' } as const;

/** The 6/10 pattern from the share-copy mock: two Wordle-width rows. */
const WORDLE_VERDICTS = [true, true, false, true, false, false, true, true, false, true];

const SCORED_WITHOUT_GRID = [
  'Made a quiz from 10 of my travel photos. Guess the country on each one. I got 7/10.',
  '',
  'Guess Where 7/10',
  'Can you beat me?',
].join('\n');

describe('buildVerdictGrid', () => {
  it('wraps at five squares, green for correct and white for missed', () => {
    expect(buildVerdictGrid(WORDLE_VERDICTS)).toBe('🟩🟩⬜🟩⬜\n⬜🟩🟩⬜🟩');
  });

  it('leaves a short last row when the quiz is not a multiple of five', () => {
    expect(buildVerdictGrid([true, false, true, true, false, true])).toBe('🟩⬜🟩🟩⬜\n🟩');
  });

  it('fits a five-photo quiz on a single row', () => {
    expect(buildVerdictGrid([true, false, true, false, true])).toBe('🟩⬜🟩⬜🟩');
  });
});

describe('verdictsForShare', () => {
  const ids = ['q0', 'q1', 'q2', 'q3', 'q4'];
  const answers = {
    q0: { placeCorrect: true },
    q1: { placeCorrect: false },
    q2: { placeCorrect: true },
    q3: { placeCorrect: false },
    q4: { placeCorrect: true },
  };

  it('returns question-order correctness when it matches the score', () => {
    expect(verdictsForShare(ids, answers, { correct: 3, total: 5 })).toEqual([
      true,
      false,
      true,
      false,
      true,
    ]);
  });

  it('drops the grid when a photo is unanswered', () => {
    const { q4: _missing, ...partial } = answers;
    expect(verdictsForShare(ids, partial, { correct: 3, total: 5 })).toBeNull();
  });

  it('drops the grid when a verdict was never persisted', () => {
    expect(
      verdictsForShare(
        ids,
        { ...answers, q2: { placeCorrect: true, verdictUnknown: true } },
        { correct: 3, total: 5 }
      )
    ).toBeNull();
  });

  it('drops the grid when local answers disagree with the seeded score', () => {
    expect(verdictsForShare(ids, answers, { correct: 4, total: 5 })).toBeNull();
  });
});

describe('pickShareVerdicts', () => {
  const score = { correct: 3, total: 5 };
  const server = [true, false, true, false, true];

  it('prefers the first candidate whose length matches the official total', () => {
    expect(pickShareVerdicts(score, server, [true, true, true, true, true])).toEqual(server);
  });

  it('skips a missing or short candidate and uses the next', () => {
    expect(pickShareVerdicts(score, null, [true, false], server)).toEqual(server);
  });

  it('returns null when no candidate matches the total', () => {
    expect(pickShareVerdicts(score, [true, false], null)).toBeNull();
  });
});

describe('buildChallengeMessage', () => {
  it('carries the photo count, the score, and the Wordle grid', () => {
    expect(
      buildChallengeMessage({
        ...FIRST_SHARE,
        score: { correct: 6, total: 10 },
        photoCount: 10,
        verdicts: WORDLE_VERDICTS,
      })
    ).toBe(
      [
        'Made a quiz from 10 of my travel photos. Guess the country on each one. I got 6/10.',
        '',
        'Guess Where 6/10',
        '🟩🟩⬜🟩⬜',
        '⬜🟩🟩⬜🟩',
        'Can you beat me?',
      ].join('\n')
    );
  });

  it('falls back to the score total when the photo count is unknown', () => {
    expect(buildChallengeMessage({ ...FIRST_SHARE, score: SCORE })).toBe(SCORED_WITHOUT_GRID);
  });

  it('omits the grid when verdicts do not match the score', () => {
    expect(
      buildChallengeMessage({
        ...FIRST_SHARE,
        score: SCORE,
        photoCount: 10,
        verdicts: [true, true, true],
      })
    ).toBe(SCORED_WITHOUT_GRID);
  });

  it('keeps a whole invitation when the score is unknown', () => {
    expect(buildChallengeMessage({ ...FIRST_SHARE, score: null, photoCount: 8 })).toBe(
      'Made a quiz from 8 of my travel photos. Guess the country on each one.'
    );
  });

  it('keeps a whole invitation when neither score nor count is known', () => {
    expect(buildChallengeMessage({ ...FIRST_SHARE, score: null })).toBe(
      'Made a quiz from my travel photos. Guess the country on each one.'
    );
  });
});

describe('presentChallengeShare', () => {
  const originalPlatform = Platform.OS;
  const scoredDetails = { ...FIRST_SHARE, score: SCORE, photoCount: 10 };

  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'ios';
    mockedShare.mockResolvedValue({ action: 'dismissedAction' });
  });

  afterEach(() => {
    Platform.OS = originalPlatform;
  });

  it('puts the link in the dedicated url slot on iOS (Q10)', async () => {
    await presentChallengeShare(URL, scoredDetails);

    expect(mockedShare).toHaveBeenCalledWith({
      message: SCORED_WITHOUT_GRID,
      url: URL,
    });
  });

  it('appends the link to the message on Android (no url slot)', async () => {
    Platform.OS = 'android';

    await presentChallengeShare(URL, scoredDetails);

    expect(mockedShare).toHaveBeenCalledWith({
      message: `${SCORED_WITHOUT_GRID}\n${URL}`,
    });
  });

  it('fires quiz_share_initiated when the sheet opens', async () => {
    await presentChallengeShare(URL, scoredDetails);

    expect(Analytics.quizShareInitiated).toHaveBeenCalledTimes(1);
    expect(Analytics.quizShareInitiated).toHaveBeenCalledWith({
      quizId: QUIZ_ID,
      source: 'results',
      isReshare: false,
      scoreCorrect: 7,
      scoreTotal: 10,
      photoCount: 10,
    });
  });

  it('marks a leaderboard share as a re-share', async () => {
    await presentChallengeShare(URL, {
      quizId: QUIZ_ID,
      source: 'leaderboard_top_bar',
      score: SCORE,
      photoCount: 10,
    });

    expect(Analytics.quizShareInitiated).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'leaderboard_top_bar', isReshare: true })
    );
  });

  it('falls back to the score total when the photo count is unknown', async () => {
    await presentChallengeShare(URL, { ...FIRST_SHARE, score: SCORE });

    expect(Analytics.quizShareInitiated).toHaveBeenCalledWith(
      expect.objectContaining({ photoCount: 10 })
    );
  });

  it('fires quiz_share_completed when iOS reports sharedAction', async () => {
    mockedShare.mockResolvedValue({ action: 'sharedAction' });

    await presentChallengeShare(URL, scoredDetails);

    expect(Analytics.quizShareCompleted).toHaveBeenCalledTimes(1);
    expect(Analytics.quizShareCompleted).toHaveBeenCalledWith({
      quizId: QUIZ_ID,
      source: 'results',
      isReshare: false,
      photoCount: 10,
    });
  });

  it('does not fire quiz_share_completed on an iOS dismissal', async () => {
    mockedShare.mockResolvedValue({ action: 'dismissedAction' });

    await presentChallengeShare(URL, scoredDetails);

    expect(Analytics.quizShareCompleted).not.toHaveBeenCalled();
  });

  it('never fires quiz_share_completed on Android (resolution is unreliable)', async () => {
    Platform.OS = 'android';
    // Android resolves sharedAction as soon as the sheet opens - firing on
    // it would count every open as a completed share.
    mockedShare.mockResolvedValue({ action: 'sharedAction' });

    await presentChallengeShare(URL, scoredDetails);

    expect(Analytics.quizShareInitiated).toHaveBeenCalledTimes(1);
    expect(Analytics.quizShareCompleted).not.toHaveBeenCalled();
  });
});
