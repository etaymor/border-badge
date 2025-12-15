import { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface CountryActionBarProps {
  isVisited: boolean;
  isDream: boolean;
  onMarkVisited: () => void;
  onToggleDream: () => void;
}

function CountryActionBarComponent({
  isVisited,
  isDream,
  onMarkVisited,
  onToggleDream,
}: CountryActionBarProps) {
  // Only show action bar if NOT visited
  if (isVisited) {
    return null;
  }

  return (
    <View style={styles.actionBar}>
      {/* Left: Visited Toggle */}
      <TouchableOpacity
        style={[styles.actionButton, isVisited ? styles.visitedButtonActive : styles.visitedButton]}
        onPress={onMarkVisited}
        activeOpacity={0.8}
      >
        <Ionicons
          name={isVisited ? 'checkmark-circle' : 'add-circle-outline'}
          size={24}
          color={isVisited ? colors.white : colors.mossGreen}
        />
        <Text
          style={[
            styles.actionButtonText,
            isVisited ? { color: colors.white } : { color: colors.mossGreen },
          ]}
        >
          {isVisited ? 'Visited' : "I've Been Here"}
        </Text>
      </TouchableOpacity>

      {/* Middle: Dream Toggle */}
      <TouchableOpacity
        style={[styles.actionButton, isDream ? styles.dreamButtonActive : styles.dreamButton]}
        onPress={onToggleDream}
        activeOpacity={0.8}
      >
        <Ionicons
          name={isDream ? 'heart' : 'heart-outline'}
          size={24}
          color={isDream ? colors.white : colors.adobeBrick}
        />
        <Text
          style={[
            styles.actionButtonText,
            isDream ? { color: colors.white } : { color: colors.adobeBrick },
          ]}
        >
          Dream to Go
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export const CountryActionBar = memo(CountryActionBarComponent);

const styles = StyleSheet.create({
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 16,
    minHeight: 48,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
    flex: 1,
    justifyContent: 'center',
  },
  visitedButton: {
    borderColor: colors.mossGreen,
    backgroundColor: 'rgba(84, 122, 95, 0.1)',
  },
  visitedButtonActive: {
    backgroundColor: colors.mossGreen,
    borderColor: colors.mossGreen,
  },
  dreamButton: {
    borderColor: colors.adobeBrick,
    backgroundColor: 'rgba(193, 84, 62, 0.1)',
  },
  dreamButtonActive: {
    backgroundColor: colors.adobeBrick,
    borderColor: colors.adobeBrick,
  },
  actionButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
  },
});
