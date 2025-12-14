/**
 * SelectedCategoryDisplay - Shows the currently selected entry type category
 * with an option to change it.
 */

import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, withAlpha } from '@constants/colors';
import type { EntryTypeConfig } from '@constants/entryTypes';
import { fonts } from '@constants/typography';

export interface SelectedCategoryDisplayProps {
  typeConfig: EntryTypeConfig;
  onChangeType: () => void;
}

export function SelectedCategoryDisplay({
  typeConfig,
  onChangeType,
}: SelectedCategoryDisplayProps) {
  return (
    <View style={styles.selectedCategoryOuter}>
      <BlurView intensity={40} tint="light" style={styles.selectedCategoryInner}>
        <View style={styles.selectedCategoryContent}>
          <View
            style={[
              styles.selectedCategoryIconContainer,
              { backgroundColor: withAlpha(typeConfig.color, 0.13) },
            ]}
          >
            <Ionicons name={typeConfig.icon} size={24} color={typeConfig.color} />
          </View>
          <Text style={[styles.selectedCategoryLabel, { color: typeConfig.color }]}>
            {typeConfig.label}
          </Text>
        </View>
        <Pressable style={styles.changeButton} onPress={onChangeType}>
          <Ionicons name="swap-horizontal" size={16} color={colors.midnightNavy} />
          <Text style={styles.changeButtonText}>Change</Text>
        </Pressable>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  selectedCategoryOuter: {
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  selectedCategoryInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  selectedCategoryContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  selectedCategoryIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectedCategoryLabel: {
    fontSize: 18,
    fontFamily: fonts.openSans.semiBold,
  },
  changeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(244, 194, 78, 0.15)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(244, 194, 78, 0.3)',
  },
  changeButtonText: {
    fontSize: 14,
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
  },
});
