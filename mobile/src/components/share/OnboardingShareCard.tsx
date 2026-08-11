/**
 * Share card component for onboarding completion and the travel photo quiz.
 * Variants: stamps, stats, vibe (onboarding trio) and quizChallenge - all
 * optimized for 9:16 social sharing.
 */

import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors } from '@constants/colors';

import { CARD_HEIGHT, CARD_WIDTH } from './constants';
import type { OnboardingPagerVariant, OnboardingShareContext, QuizChallengeContext } from './types';
import { MapVariant } from './variants/MapVariant';
import { QuizChallengeVariant } from './variants/QuizChallengeVariant';
import { StampsVariant } from './variants/StampsVariant';
import StatsVariant from './variants/StatsVariant';

export * from './types';
export {
  CARD_HEIGHT as ONBOARDING_SHARE_CARD_HEIGHT,
  CARD_WIDTH as ONBOARDING_SHARE_CARD_WIDTH,
} from './constants';

// Discriminated on `variant`: the quiz challenge card renders from quiz data,
// not the onboarding context, so each branch demands its matching context.
type OnboardingShareCardProps =
  | { variant: OnboardingPagerVariant; context: OnboardingShareContext }
  | { variant: 'quizChallenge'; context: QuizChallengeContext };

function OnboardingShareCardComponent(props: OnboardingShareCardProps) {
  let variantNode;
  switch (props.variant) {
    case 'stamps':
      variantNode = <StampsVariant context={props.context} />;
      break;
    case 'stats':
      variantNode = <StatsVariant context={props.context} />;
      break;
    case 'vibe':
      variantNode = <MapVariant context={props.context} />;
      break;
    case 'quizChallenge':
      variantNode = <QuizChallengeVariant context={props.context} />;
      break;
  }

  return (
    <View style={styles.card} collapsable={false}>
      {variantNode}
    </View>
  );
}

export const OnboardingShareCard = memo(OnboardingShareCardComponent);

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    overflow: 'hidden',
    backgroundColor: colors.warmCream,
  },
});
