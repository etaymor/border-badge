import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { UserAvatar } from '@components/friends/UserAvatar';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

export type CompanionStatus = 'pending' | 'approved' | 'declined';

interface CompanionChipProps {
  user: {
    id: string;
    username: string;
    avatar_url: string | null;
  };
  status?: CompanionStatus;
  onRemove?: () => void;
}

export function CompanionChip({ user, status, onRemove }: CompanionChipProps) {
  return (
    <View style={styles.chip}>
      <UserAvatar avatarUrl={user.avatar_url} username={user.username} size={24} />
      <Text style={styles.username} numberOfLines={1}>
        @{user.username}
      </Text>
      {status && <StatusBadge status={status} />}
      {onRemove && (
        <TouchableOpacity
          onPress={onRemove}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.removeButton}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${user.username}`}
        >
          <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      )}
    </View>
  );
}

function StatusBadge({ status }: { status: CompanionStatus }) {
  const config = {
    pending: { color: colors.sunsetGold, label: 'Pending' },
    approved: { color: colors.mossGreen, label: 'Approved' },
    declined: { color: colors.textSecondary, label: 'Declined' },
  }[status];

  return (
    <View style={[styles.badge, { backgroundColor: config.color }]}>
      <Text style={styles.badgeText}>{config.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    gap: 6,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  username: {
    fontSize: 14,
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
    maxWidth: 100,
  },
  removeButton: {
    marginLeft: 2,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 4,
  },
  badgeText: {
    fontSize: 10,
    fontFamily: fonts.oswald.medium,
    color: colors.cloudWhite,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
