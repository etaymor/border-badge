/**
 * The title bar every Guess Where screen wears.
 *
 * The quiz screens are pushed onto the ROOT stack, above the tab navigator, in
 * a headerless blank stack - so they cover the whole app with no tab bar, no
 * system header, and (until this component) nothing naming where the user had
 * landed. Exits were a ghost "Done" or "Back" button at the bottom of a
 * scroll, different on every screen.
 *
 * This is that frame: the feature's name centred, a dismiss button on the
 * left, and optional actions on the right, in the same place on every screen.
 *
 * `title` is optional: screens that already name the feature in their own
 * artwork (QuizCreationScreen's gold hero eyebrow) pass none rather than
 * stack "Guess Where" twice on one screen. `icon` picks the dismiss
 * affordance - 'back' where the screen is a step the user came through,
 * 'close' where it is a surface they are leaving.
 *
 * It deliberately matches PassportHeader, the app's other top bar: the same
 * GlassIconButton at its 44pt default size, the same 16pt gutter, and the
 * Playfair 24 that the rest of the app's screen headers use. The close glyph
 * comes from GlassIconButton (a vector icon, optically centred in its circle)
 * rather than GlassBackButton's text "x", whose line-box metrics left it
 * sitting visibly off-centre.
 *
 * The title is absolutely centred rather than flexed between the controls, so
 * it stays on the screen's centre line no matter how many actions sit on the
 * right.
 *
 * `variant` follows what sits behind it: 'dark' over a photo hero or the navy
 * stage, 'light' over the cream sheet. Over a hero the bar is meant to be
 * absolutely positioned by the screen, so the photo runs underneath it.
 *
 * QuizPlayScreen is deliberately NOT a caller: its top bar carries the
 * question tracker, and a title there would compete with the photo.
 */

import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassIconButton } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

/** GlassIconButton's default size - the same control PassportHeader uses. */
const BUTTON_SIZE = 44;

interface QuizTopBarProps {
  /** Omit where the screen already names the feature in its own artwork. */
  title?: string;
  onClose: () => void;
  /** 'back' for a step in a flow, 'close' for a surface being dismissed. */
  icon?: 'close' | 'back';
  /** 'dark' over photography or the navy stage; 'light' over the cream sheet. */
  variant?: 'dark' | 'light';
  /**
   * Optional controls for the trailing edge (e.g. new challenge, how it
   * works). The title stays centred regardless of how many are passed.
   */
  rightActions?: ReactNode;
  testID?: string;
}

export function QuizTopBar({
  title,
  onClose,
  icon = 'close',
  variant = 'dark',
  rightActions,
  testID,
}: QuizTopBarProps) {
  const isBack = icon === 'back';
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.bar, { paddingTop: insets.top + 8 }]}
      pointerEvents="box-none"
      testID={testID}
    >
      <View style={styles.row} pointerEvents="box-none">
        {/* Behind the controls so a long title can never eat their taps. */}
        {title ? (
          <View style={styles.titleWrap} pointerEvents="none">
            <Text
              style={[styles.title, variant === 'light' && styles.titleLight]}
              numberOfLines={1}
              accessibilityRole="header"
            >
              {title}
            </Text>
          </View>
        ) : null}

        {/* testID keeps the -close suffix whichever glyph it wears: it is the
            one dismiss control, and screens/tests address it by that name. */}
        <GlassIconButton
          icon={isBack ? 'arrow-back' : 'close'}
          onPress={onClose}
          variant={variant}
          accessibilityLabel={isBack ? 'Go back' : 'Close'}
          testID={testID ? `${testID}-close` : 'quiz-top-bar-close'}
        />

        <View style={styles.flex} pointerEvents="none" />

        {rightActions ? (
          <View style={styles.actions}>{rightActions}</View>
        ) : (
          /* Mirrors the close button so the row keeps its shape. */
          <View style={styles.spacer} pointerEvents="none" />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: BUTTON_SIZE,
  },
  titleWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    // Keeps a long title clear of the controls on either side.
    paddingHorizontal: BUTTON_SIZE * 2,
  },
  title: {
    fontFamily: fonts.playfair.bold,
    fontSize: 24,
    lineHeight: 30,
    color: colors.warmCream,
    textAlign: 'center',
  },
  titleLight: {
    color: colors.textPrimary,
  },
  flex: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  spacer: {
    width: BUTTON_SIZE,
  },
});
