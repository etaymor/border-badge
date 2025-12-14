/**
 * Pill-shaped badge component for displaying milestone achievements.
 */

import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@components/ui';
import { colors, withAlpha } from '@constants/colors';
import type { Milestone } from '@utils/milestones';

interface MilestoneBadgeProps {
  milestone: Milestone;
}

function MilestoneBadgeComponent({ milestone }: MilestoneBadgeProps) {
  return (
    <View style={[styles.badge, { backgroundColor: withAlpha(milestone.color, 0.9) }]}>
      <Ionicons name={milestone.icon} size={16} color={colors.white} style={styles.icon} />
      <Text style={styles.label}>{milestone.label}</Text>
    </View>
  );
}

export const MilestoneBadge = memo(MilestoneBadgeComponent);

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginVertical: 4,
  },
  icon: {
    marginRight: 8,
  },
  label: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
});
