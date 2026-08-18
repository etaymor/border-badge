/**
 * The title bar every Guess Where screen wears.
 *
 * The quiz screens are pushed onto the ROOT stack, above the tab navigator, in
 * a headerless blank stack - so they cover the whole app with no tab bar, no
 * system header, and (until this component) nothing naming where the user had
 * landed. Exits were a ghost "Done" or "Back" button at the bottom of a
 * scroll, different on every screen.
 *
 * This is that frame: the feature's name centred, and a close button on the
 * left, in the same place on every screen. Each screen already carries its own
 * editorial page heading ("New Challenge", "Your Challenges", "Leaderboard"),
 * so the bar names the FEATURE rather than repeating the page.
 *
 * `variant` follows what sits behind it: 'dark' over a photo hero or the navy
 * stage, 'light' over the cream sheet. Over a hero the bar is meant to be
 * absolutely positioned by the screen, so the photo runs underneath it.
 *
 * QuizPlayScreen is deliberately NOT a caller: its top bar carries the
 * question tracker, and a title there would compete with the photo.
 */

import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassBackButton } from '@components/ui/GlassBackButton';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

/** Matches GlassBackButton's `small` size, so the title stays centred. */
const BUTTON_SIZE = 36;

interface QuizTopBarProps {
  title: string;
  onClose: () => void;
  /** 'dark' over photography or the navy stage; 'light' over the cream sheet. */
  variant?: 'dark' | 'light';
  testID?: string;
}

export function QuizTopBar({ title, onClose, variant = 'dark', testID }: QuizTopBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.bar, { paddingTop: insets.top + 8 }]}
      pointerEvents="box-none"
      testID={testID}
    >
      <GlassBackButton
        onPress={onClose}
        variant={variant}
        size="small"
        icon="close"
        testID={testID ? `${testID}-close` : 'quiz-top-bar-close'}
      />
      <Text
        style={[styles.title, variant === 'light' && styles.titleLight]}
        numberOfLines={1}
        accessibilityRole="header"
      >
        {title}
      </Text>
      {/* Mirrors the close button so the title sits optically centred. */}
      <View style={styles.spacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  title: {
    flex: 1,
    fontFamily: fonts.playfair.bold,
    fontSize: 19,
    lineHeight: 24,
    color: colors.warmCream,
    textAlign: 'center',
  },
  titleLight: {
    color: colors.textPrimary,
  },
  spacer: {
    width: BUTTON_SIZE,
  },
});
