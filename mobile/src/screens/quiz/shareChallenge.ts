/**
 * Presenting a Guess Where challenge to the OS share sheet.
 *
 * Shared by the results screen (which mints the link on first share) and the
 * leaderboard (which re-shares an existing one), so the invitation reads the
 * same wherever it comes from - and the Q10 link handling stays in one place.
 */

import { Platform } from 'react-native';

import { Share } from '@utils/share';

export interface ChallengeScore {
  correct: number;
  total: number;
}

export function buildChallengeMessage(score: ChallengeScore): string {
  return (
    `I scored ${score.correct} of ${score.total} on my Guess Where ` +
    `challenge - my own travel photos. Think you know the world better? Beat my score.`
  );
}

export async function presentChallengeShare(
  shareUrl: string,
  score: ChallengeScore
): Promise<void> {
  const message = buildChallengeMessage(score);
  if (Platform.OS === 'ios') {
    // The challenge link is its own activity item (Q10): destinations unfurl
    // it into a rich preview instead of finding a raw URL glued into a
    // sentence.
    await Share.share({ message, url: shareUrl });
  } else {
    // Android's Share.share has no url slot; the link rides on its own line at
    // the end of the message.
    await Share.share({ message: `${message}\n${shareUrl}` });
  }
}
