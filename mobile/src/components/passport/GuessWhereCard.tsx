/**
 * GuessWhereCard - the persistent home for Guess Where on the passport
 * screen (Q1/Q3). The feature is built out of the user's own travel photos,
 * so its entry point leads with the Guess Where compass mark.
 *
 * The card names the feature and says what the game is, in one line each -
 * it is an entry point on a crowded home screen, not a status readout. Where
 * it LEADS is still state-aware:
 * - no challenge yet: the playable intro (Q7)
 * - has challenges: My Challenges
 *
 * The frame is PassportEntryCard, shared with PhotoSyncCard so the two can
 * swap in the same slot without shifting the home surface.
 */

import { useMyQuizzes } from '@hooks/useQuizzes';
import { useStableCallback } from '@hooks/useStableCallback';
import { guessWhereMark } from '@screens/quiz/sampleAssets';

import { PassportEntryCard } from './PassportEntryCard';

interface GuessWhereCardProps {
  onOpenIntro: () => void;
  onOpenChallenges: () => void;
}

export function GuessWhereCard({ onOpenIntro, onOpenChallenges }: GuessWhereCardProps) {
  const { data: quizzes } = useMyQuizzes();

  const hasQuizzes = !!quizzes && quizzes.length > 0;

  const handlePress = useStableCallback(() => {
    if (hasQuizzes) {
      onOpenChallenges();
    } else {
      onOpenIntro();
    }
  });

  return (
    <PassportEntryCard
      illustration={guessWhereMark}
      title="Guess Where"
      subtitle="A photo game for your friends"
      onPress={handlePress}
      accessibilityLabel="Guess Where"
      testID="guess-where-card"
    />
  );
}
