import type { ReactNode } from 'react';
import {
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, withAlpha } from '@constants/colors';

/** Screen-edge inset so the card width stays `windowWidth - 48` on every door. */
export const STAGE_CARD_HORIZONTAL_INSET = 48;
export const STAGE_CARD_ASPECT_RATIO = 4 / 5;

interface StageCardProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The framed card shared by the permission beats and the live scan.
 * Size never changes between beats; only the children do.
 */
export function StageCard({ children, style, testID = 'stage-card' }: StageCardProps) {
  const { width: windowWidth } = useWindowDimensions();

  return (
    <View
      testID={testID}
      style={[styles.card, { width: windowWidth - STAGE_CARD_HORIZONTAL_INSET }, style]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    aspectRatio: STAGE_CARD_ASPECT_RATIO,
    borderRadius: 24,
    backgroundColor: colors.warmCream,
    borderWidth: 1,
    borderColor: withAlpha(colors.midnightNavy, 0.06),
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
});

export default StageCard;
