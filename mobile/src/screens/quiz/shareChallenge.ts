/**
 * Presenting a Guess Where challenge to the OS share sheet.
 *
 * Shared by the results screen (which mints the link on first share) and the
 * leaderboard (which re-shares an existing one), so the invitation reads the
 * same wherever it comes from - and the Q10 link handling stays in one place.
 * The share funnel events (initiated -> completed) also live here, so every
 * surface that shares a challenge is counted the same way.
 *
 * The invitation is a Wordle-style paste: a one-line pitch, then a
 * "Guess Where X/Y" header over a 5-wide grid of green/white squares so the
 * recipient sees which photos the owner got right before they tap the link.
 */

import { Platform } from 'react-native';

import type { QuizShareSource } from '@navigation/types';
import { Analytics } from '@services/analytics';
import { Share } from '@utils/share';

export interface ChallengeScore {
  correct: number;
  total: number;
}

/** One stored owner answer, reduced to what the share grid needs. */
export interface ShareAnswer {
  placeCorrect: boolean;
  verdictUnknown?: boolean;
}

export interface ChallengeShareDetails {
  quizId: string;
  /**
   * Which affordance opened the sheet. Required, because `quiz_shared` only
   * fires when a slug is minted - without this, a first share from the results
   * screen and a re-share off the leaderboard are indistinguishable.
   */
  source: QuizShareSource;
  /** The owner's score-to-beat; null when the surface does not know it. */
  score: ChallengeScore | null;
  /** How many photos the challenge holds; falls back to score.total. */
  photoCount?: number | null;
  /**
   * Per-photo correctness in question order. Omitted (or ignored) when it
   * does not line up with `score` - a mismatched grid would lie.
   */
  verdicts?: readonly boolean[] | null;
}

/** Wordle-width rows: 5-10 photos wrap the same way a Wordle board does. */
export const VERDICT_GRID_COLUMNS = 5;
const CORRECT_SQUARE = '🟩';
const INCORRECT_SQUARE = '⬜';

/** Green / white squares, wrapped at 5, matching the owner's photo order. */
export function buildVerdictGrid(verdicts: readonly boolean[]): string {
  const rows: string[] = [];
  for (let i = 0; i < verdicts.length; i += VERDICT_GRID_COLUMNS) {
    rows.push(
      verdicts
        .slice(i, i + VERDICT_GRID_COLUMNS)
        .map((correct) => (correct ? CORRECT_SQUARE : INCORRECT_SQUARE))
        .join('')
    );
  }
  return rows.join('\n');
}

/**
 * Question-order correctness for the share grid. Returns null when any
 * photo is unanswered / unknown, or when the pattern disagrees with the
 * seeded score (stale local play state after a swap/remove).
 */
export function verdictsForShare(
  questionIds: readonly string[],
  answers: Record<string, ShareAnswer> | undefined,
  score: ChallengeScore | null
): boolean[] | null {
  if (!answers || !score || questionIds.length === 0) return null;
  const verdicts: boolean[] = [];
  for (const questionId of questionIds) {
    const answer = answers[questionId];
    if (!answer || answer.verdictUnknown) return null;
    verdicts.push(answer.placeCorrect);
  }
  const correctCount = verdicts.filter(Boolean).length;
  if (verdicts.length !== score.total || correctCount !== score.correct) {
    return null;
  }
  return verdicts;
}

/**
 * First candidate whose length matches the official total. Server seeding
 * verdicts win over local play-state: the share grid is the score-to-beat
 * pattern, not whatever is left on disk after a replay or a failed persist.
 */
export function pickShareVerdicts(
  score: ChallengeScore | null,
  ...candidates: Array<readonly boolean[] | null | undefined>
): boolean[] | null {
  if (!score) return null;
  for (const candidate of candidates) {
    if (candidate && candidate.length === score.total) {
      return [...candidate];
    }
  }
  return null;
}

function gridForShare(details: ChallengeShareDetails): string | null {
  const verdicts = pickShareVerdicts(details.score, details.verdicts);
  return verdicts ? buildVerdictGrid(verdicts) : null;
}

export function buildChallengeMessage(details: ChallengeShareDetails): string {
  const photoCount = details.photoCount ?? details.score?.total ?? null;
  const photosPhrase =
    photoCount != null ? `${photoCount} of my travel photos` : 'my travel photos';
  // Pitch first: what the recipient is being asked to do, plus the owner's
  // score so the Wordle block below has a number to land on.
  let invitation = `Made a quiz from ${photosPhrase}. Guess the country on each one.`;
  if (!details.score) {
    return invitation;
  }
  invitation += ` I got ${details.score.correct}/${details.score.total}.`;
  const lines = [invitation, '', `Guess Where ${details.score.correct}/${details.score.total}`];
  const grid = gridForShare(details);
  if (grid) {
    lines.push(grid);
  }
  lines.push('Can you beat me?');
  return lines.join('\n');
}

export async function presentChallengeShare(
  shareUrl: string,
  details: ChallengeShareDetails
): Promise<void> {
  const message = buildChallengeMessage(details);
  // The results screen is the only surface that shares a freshly minted link;
  // every other entry is re-sharing one that already exists.
  const isReshare = details.source !== 'results';
  const photoCount = details.photoCount ?? details.score?.total ?? null;
  // Funnel: the sheet is opening (whether the user then shares or dismisses).
  Analytics.quizShareInitiated({
    quizId: details.quizId,
    source: details.source,
    isReshare,
    scoreCorrect: details.score?.correct ?? null,
    scoreTotal: details.score?.total ?? null,
    photoCount,
  });
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
      Analytics.quizShareCompleted({
        quizId: details.quizId,
        source: details.source,
        isReshare,
        photoCount,
      });
    }
  } else {
    // Android's Share.share has no url slot; the link rides on its own line at
    // the end of the message.
    await Share.share({ message: `${message}\n${shareUrl}` });
  }
}
