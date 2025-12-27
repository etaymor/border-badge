import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { UserAvatar } from '@components/friends/UserAvatar';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface SelectableUserItemProps {
  user: {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
  };
  isSelected: boolean;
  onToggle: () => void;
}

export const SelectableUserItem = memo(
  function SelectableUserItem({ user, isSelected, onToggle }: SelectableUserItemProps) {
    return (
      <TouchableOpacity
        style={[styles.item, isSelected && styles.itemSelected]}
        onPress={onToggle}
        activeOpacity={0.7}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: isSelected }}
        accessibilityLabel={`${user.display_name} (@${user.username})`}
      >
        <UserAvatar avatarUrl={user.avatar_url} username={user.username} size={40} />
        <View style={styles.textContainer}>
          <Text style={styles.displayName} numberOfLines={1}>
            {user.display_name}
          </Text>
          <Text style={styles.username} numberOfLines={1}>
            @{user.username}
          </Text>
        </View>
        <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
          {isSelected && <Ionicons name="checkmark" size={14} color={colors.cloudWhite} />}
        </View>
      </TouchableOpacity>
    );
  },
  (prev, next) => prev.user.id === next.user.id && prev.isSelected === next.isSelected
);

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.04)',
    gap: 12,
  },
  itemSelected: {
    backgroundColor: 'rgba(84, 122, 95, 0.06)',
  },
  textContainer: {
    flex: 1,
    minWidth: 0,
  },
  displayName: {
    fontSize: 15,
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
  },
  username: {
    fontSize: 13,
    fontFamily: fonts.openSans.regular,
    color: colors.textSecondary,
    marginTop: 1,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: colors.mossGreen,
    borderColor: colors.mossGreen,
  },
});
