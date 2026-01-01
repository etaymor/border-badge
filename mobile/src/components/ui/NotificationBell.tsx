import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface NotificationBellProps {
  /** Number of pending notifications to display */
  count: number;
  /** Callback when bell is pressed */
  onPress: () => void;
  /** Optional size for the bell icon (default: 24) */
  size?: number;
  /** Optional color for the bell icon (default: midnightNavy) */
  color?: string;
}

/**
 * Notification bell icon with optional badge count.
 * Used in headers to indicate pending items like trip tag invitations.
 */
export function NotificationBell({
  count,
  onPress,
  size = 24,
  color = colors.midnightNavy,
}: NotificationBellProps) {
  const displayCount = count > 99 ? '99+' : count.toString();

  return (
    <Pressable
      onPress={onPress}
      style={styles.container}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      testID="notification-bell"
    >
      <Ionicons name={count > 0 ? 'notifications' : 'notifications-outline'} size={size} color={color} />
      {count > 0 && (
        <View style={styles.badge} testID="notification-badge">
          <Text style={styles.badgeText}>{displayCount}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    padding: 4,
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: colors.adobeBrick,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: colors.warmCream,
  },
  badgeText: {
    fontFamily: fonts.openSans.bold,
    fontSize: 10,
    color: colors.cloudWhite,
    textAlign: 'center',
    includeFontPadding: false,
  },
});
