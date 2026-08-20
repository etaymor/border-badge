/**
 * PassportEntryCard - the shared frame for the single entry-point card that
 * sits between the stats grid and the country search on the passport home.
 *
 * GuessWhereCard and PhotoSyncCard both wrap this. They swap in the same slot
 * depending on whether the camera roll has been scanned, and the home surface
 * must not shift when they do - so the frame lives here rather than being
 * duplicated and kept in sync by hand.
 */

import * as Haptics from 'expo-haptics';
import {
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';

import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useAnimatedPress } from '@hooks/useAnimatedPress';
import { useStableCallback } from '@hooks/useStableCallback';

interface PassportEntryCardProps {
  /** The 64pt mark in the leading slot. */
  illustration: ImageSourcePropType;
  title: string;
  /** One line by contract: it must not push the card taller. */
  subtitle: string;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  testID?: string;
}

export function PassportEntryCard({
  illustration,
  title,
  subtitle,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: PassportEntryCardProps) {
  const { scaleValue, pressHandlers } = useAnimatedPress({ pressedScale: 0.97 });

  const handlePress = useStableCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  });

  return (
    <Animated.View style={[styles.wrapper, { transform: [{ scale: scaleValue }] }]}>
      <Pressable
        onPress={handlePress}
        {...pressHandlers}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        style={styles.card}
        testID={testID}
      >
        <Image source={illustration} style={styles.illustration} />
        <View style={styles.body}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <Text style={styles.chevron}>{'→'}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: 16,
    marginTop: 16,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.backgroundCard,
    borderRadius: 20,
    padding: 14,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  illustration: {
    width: 64,
    height: 64,
    resizeMode: 'contain',
  },
  body: {
    flex: 1,
    gap: 1,
  },
  title: {
    fontFamily: fonts.playfair.bold,
    fontSize: 18,
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: fonts.body.regular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  chevron: {
    fontFamily: fonts.body.semiBold,
    fontSize: 18,
    color: withAlpha(colors.midnightNavy, 0.5),
    paddingHorizontal: 2,
  },
});
