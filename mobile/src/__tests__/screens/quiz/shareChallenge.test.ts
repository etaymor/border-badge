/**
 * shareChallenge: the invitation copy and the share funnel events.
 *
 * - Settled copy: "Guess where in the world these {n} photos were taken. I got
 *   {s}/{t} - beat me.", with the score clause dropped when the surface does
 *   not know the score.
 * - iOS: the link travels in the dedicated url slot (Q10); Android appends
 *   it on its own line at the end of the message.
 * - Funnel: quiz_share_initiated on sheet open; quiz_share_completed ONLY
 *   when iOS reports sharedAction (Android resolves sharedAction the moment
 *   the sheet opens, so completion is never fired there).
 */

import { Platform } from 'react-native';

import { buildChallengeMessage, presentChallengeShare } from '@screens/quiz/shareChallenge';
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

describe('buildChallengeMessage', () => {
  it('carries the photo count and the score to beat', () => {
    expect(buildChallengeMessage({ score: SCORE, photoCount: 10 })).toBe(
      'Guess where in the world these 10 photos were taken. I got 7/10 — beat me.'
    );
  });

  it('falls back to the score total when the photo count is unknown', () => {
    expect(buildChallengeMessage({ score: SCORE })).toBe(
      'Guess where in the world these 10 photos were taken. I got 7/10 — beat me.'
    );
  });

  it('keeps a whole invitation when the score is unknown', () => {
    expect(buildChallengeMessage({ score: null, photoCount: 8 })).toBe(
      'Guess where in the world these 8 photos were taken.'
    );
  });

  it('keeps a whole invitation when neither score nor count is known', () => {
    expect(buildChallengeMessage({ score: null })).toBe(
      'Guess where in the world my travel photos were taken.'
    );
  });
});

describe('presentChallengeShare', () => {
  const originalPlatform = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'ios';
    mockedShare.mockResolvedValue({ action: 'dismissedAction' });
  });

  afterEach(() => {
    Platform.OS = originalPlatform;
  });

  it('puts the link in the dedicated url slot on iOS (Q10)', async () => {
    await presentChallengeShare(URL, { score: SCORE, photoCount: 10 });

    expect(mockedShare).toHaveBeenCalledWith({
      message: 'Guess where in the world these 10 photos were taken. I got 7/10 — beat me.',
      url: URL,
    });
  });

  it('appends the link to the message on Android (no url slot)', async () => {
    Platform.OS = 'android';

    await presentChallengeShare(URL, { score: SCORE, photoCount: 10 });

    expect(mockedShare).toHaveBeenCalledWith({
      message: `Guess where in the world these 10 photos were taken. I got 7/10 — beat me.\n${URL}`,
    });
  });

  it('fires quiz_share_initiated when the sheet opens', async () => {
    await presentChallengeShare(URL, { score: SCORE, photoCount: 10 });

    expect(Analytics.quizShareInitiated).toHaveBeenCalledTimes(1);
  });

  it('fires quiz_share_completed when iOS reports sharedAction', async () => {
    mockedShare.mockResolvedValue({ action: 'sharedAction' });

    await presentChallengeShare(URL, { score: SCORE, photoCount: 10 });

    expect(Analytics.quizShareCompleted).toHaveBeenCalledTimes(1);
  });

  it('does not fire quiz_share_completed on an iOS dismissal', async () => {
    mockedShare.mockResolvedValue({ action: 'dismissedAction' });

    await presentChallengeShare(URL, { score: SCORE, photoCount: 10 });

    expect(Analytics.quizShareCompleted).not.toHaveBeenCalled();
  });

  it('never fires quiz_share_completed on Android (resolution is unreliable)', async () => {
    Platform.OS = 'android';
    // Android resolves sharedAction as soon as the sheet opens - firing on
    // it would count every open as a completed share.
    mockedShare.mockResolvedValue({ action: 'sharedAction' });

    await presentChallengeShare(URL, { score: SCORE, photoCount: 10 });

    expect(Analytics.quizShareInitiated).toHaveBeenCalledTimes(1);
    expect(Analytics.quizShareCompleted).not.toHaveBeenCalled();
  });
});
