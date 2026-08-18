/**
 * Presenting a Guess Where challenge to the OS share sheet.
 *
 * Shared by the results screen (which mints the link on first share) and the
 * leaderboard (which re-shares an existing one), so the invitation reads the
 * same wherever it comes from - and the Q10 link handling stays in one place.
 * The share funnel events (initiated -> completed) also live here, so every
 * surface that shares a challenge is counted the same way.
 */

import { Platform } from 'react-native';

import { Analytics } from '@services/analytics';
import { Share } from '@utils/share';

export interface ChallengeScore {
  correct: number;
  total: number;
}

export interface ChallengeShareDetails {
  /** The owner's score-to-beat; null when the surface does not know it. */
  score: ChallengeScore | null;
  /** How many photos the challenge holds; falls back to score.total. */
  photoCount?: number | null;
}

export function buildChallengeMessage(details: ChallengeShareDetails): string {
  const photoCount = details.photoCount ?? details.score?.total ?? null;
  const photosPhrase = photoCount != null ? `these ${photoCount} photos` : 'my travel photos';
  // Lead with the game, not with the fact that a thing was made: the recipient
  // reads this in a message list next to an unfurled link, so the first clause
  // has to say what they are being asked to do.
  const invitation = `Guess where in the world ${photosPhrase} were taken.`;
  if (details.score) {
    return `${invitation} I got ${details.score.correct}/${details.score.total} — beat me.`;
  }
  // Score unknown (a surface without the seeded pair): keep the invitation
  // whole without inventing numbers.
  return invitation;
}

export async function presentChallengeShare(
  shareUrl: string,
  details: ChallengeShareDetails
): Promise<void> {
  const message = buildChallengeMessage(details);
  // Funnel: the sheet is opening (whether the user then shares or dismisses).
  Analytics.quizShareInitiated();
  if (Platform.OS === 'ios') {
    // The challenge link is its own activity item (Q10): destinations unfurl
    // it into a rich preview instead of finding a raw URL glued into a
    // sentence.
    const result = await Share.share({ message, url: shareUrl });
    // Only iOS reports the sheet's outcome faithfully (Android resolves
    // sharedAction the moment the sheet opens), so completion fires only
    // when this platform genuinely reports a completed share. The literal is
    // RN's Share.sharedAction constant (undefined under jest-expo, hence the
    // string).
    if (result.action === 'sharedAction') {
      Analytics.quizShareCompleted();
    }
  } else {
    // Android's Share.share has no url slot; the link rides on its own line at
    // the end of the message.
    await Share.share({ message: `${message}\n${shareUrl}` });
  }
}
