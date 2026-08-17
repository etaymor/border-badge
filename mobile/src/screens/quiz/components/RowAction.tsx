/**
 * RowAction - the compact secondary action used inside Guess Where list rows.
 *
 * Row-level actions (Share, Leaderboard, Swap, Hide, Delete) were full-size
 * `Button variant="ghost"` pills, which rendered as a line of blue text links -
 * a web idiom the app does not use, and 44pt tall in a 68pt row. This is a
 * bordered chip in brand ink: clearly tappable, clearly subordinate to the
 * screen's gold CTA, and sized for a row.
 */

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';

interface RowActionProps {
  title: string;
  onPress: () => void;
  /** Destructive actions (Delete, Revoke) read in brick, not ink. */
  tone?: 'default' | 'destructive';
  loading?: boolean;
  testID?: string;
}

export function RowAction({
  title,
  onPress,
  tone = 'default',
  loading = false,
  testID,
}: RowActionProps) {
  const destructive = tone === 'destructive';

  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: loading }}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      style={({ pressed }) => [
        styles.chip,
        destructive && styles.chipDestructive,
        pressed && styles.pressed,
        loading && styles.loading,
      ]}
    >
      {loading ? (
        <View style={styles.spinner}>
          <ActivityIndicator
            size="small"
            color={destructive ? colors.adobeBrick : colors.textSecondary}
          />
        </View>
      ) : (
        <Text style={[styles.label, destructive && styles.labelDestructive]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 32,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: colors.midnightNavyBorder,
    backgroundColor: withAlpha(colors.midnightNavy, 0.04),
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipDestructive: {
    borderColor: withAlpha(colors.adobeBrick, 0.35),
    backgroundColor: withAlpha(colors.adobeBrick, 0.06),
  },
  pressed: {
    opacity: 0.6,
  },
  loading: {
    opacity: 0.7,
  },
  spinner: {
    minWidth: 40,
  },
  label: {
    fontFamily: fonts.body.semiBold,
    fontSize: 13,
    color: colors.textPrimary,
  },
  labelDestructive: {
    color: colors.adobeBrick,
  },
});
