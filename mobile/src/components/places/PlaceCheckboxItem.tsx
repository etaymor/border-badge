/**
 * PlaceCheckboxItem - A checkbox item for selecting places in multi-place extraction.
 *
 * Displays a place with checkbox, name, address, and entry type chip.
 * Supports edit action to replace the place via search.
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { Text } from '@components/ui';
import type { EntryType } from '@navigation/types';

// Entry type display configuration
const ENTRY_TYPE_CONFIG: Record<EntryType, { label: string; color: string }> = {
  place: { label: 'Place', color: colors.mossGreen },
  food: { label: 'Food', color: colors.dustyCoral },
  stay: { label: 'Stay', color: '#5B8A72' },
  experience: { label: 'Experience', color: colors.adobeBrick },
};

export interface PlaceCheckboxItemProps {
  name: string;
  address: string | null;
  countryCode: string | null;
  showCountryChip: boolean; // True when places span multiple countries
  entryType: EntryType;
  isSelected: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onEntryTypeChange: (type: EntryType) => void;
}

export function PlaceCheckboxItem({
  name,
  address,
  countryCode,
  showCountryChip,
  entryType,
  isSelected,
  onToggle,
  onEdit,
  onEntryTypeChange,
}: PlaceCheckboxItemProps) {
  const typeConfig = useMemo(() => ENTRY_TYPE_CONFIG[entryType], [entryType]);

  return (
    <View style={styles.container}>
      {/* Checkbox */}
      <Pressable
        style={styles.checkboxContainer}
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: isSelected }}
      >
        <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
          {isSelected && <Ionicons name="checkmark" size={16} color={colors.white} />}
        </View>
      </Pressable>

      {/* Place Info */}
      <Pressable style={styles.content} onPress={onToggle}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          {showCountryChip && countryCode && (
            <View style={styles.countryChip}>
              <Text style={styles.countryLabel}>{countryCode}</Text>
            </View>
          )}
        </View>
        {address && (
          <Text style={styles.address} numberOfLines={1}>
            {address}
          </Text>
        )}
      </Pressable>

      {/* Entry Type Chip */}
      <Pressable
        style={[styles.typeChip, { backgroundColor: typeConfig.color }]}
        onPress={() => {
          // Cycle through entry types
          const types: EntryType[] = ['place', 'food', 'stay', 'experience'];
          const currentIndex = types.indexOf(entryType);
          const nextIndex = (currentIndex + 1) % types.length;
          onEntryTypeChange(types[nextIndex]);
        }}
      >
        <Text style={styles.typeLabel}>{typeConfig.label}</Text>
      </Pressable>

      {/* Edit Button */}
      <Pressable style={styles.editButton} onPress={onEdit} accessibilityLabel="Edit place">
        <Ionicons name="pencil-outline" size={18} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.paperBeige,
  },
  checkboxContainer: {
    padding: 4,
    marginRight: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: colors.mossGreen,
    borderColor: colors.mossGreen,
  },
  content: {
    flex: 1,
    marginRight: 8,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 15,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  countryChip: {
    backgroundColor: colors.midnightNavy,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  countryLabel: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 10,
    color: colors.white,
    letterSpacing: 0.5,
  },
  address: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.textSecondary,
  },
  typeChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 8,
  },
  typeLabel: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 11,
    color: colors.white,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  editButton: {
    padding: 8,
  },
});
