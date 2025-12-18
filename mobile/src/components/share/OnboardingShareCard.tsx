/**
 * Share card component for onboarding completion.
 * Three variants: stamps, stats, and vibe - all optimized for 9:16 social sharing.
 */

import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors } from '@constants/colors';

import { CARD_HEIGHT, CARD_WIDTH } from './constants';
import type { OnboardingShareContext, OnboardingShareVariant } from './types';
import { MapVariant } from './variants/MapVariant';
import { StampsVariant } from './variants/StampsVariant';
import { StatsVariant } from './variants/StatsVariant';

export * from './types';
export {
  CARD_HEIGHT as ONBOARDING_SHARE_CARD_HEIGHT,
  CARD_WIDTH as ONBOARDING_SHARE_CARD_WIDTH,
} from './constants';

interface OnboardingShareCardProps {
  variant: OnboardingShareVariant;
  context: OnboardingShareContext;
}

function OnboardingShareCardComponent({ variant, context }: OnboardingShareCardProps) {
  const VariantComponent = useMemo(() => {
    switch (variant) {
      case 'stamps':
        return StampsVariant;
      case 'stats':
        return StatsVariant;
      case 'vibe':
        return MapVariant;
    }
  }, [variant]);

  return (
    <View style={styles.card} collapsable={false}>
      <VariantComponent context={context} />
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
