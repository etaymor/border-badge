/**
 * CategorySelector - Handles entry type category selection.
 * Shows either a grid of category buttons or the selected category display.
 */

import { StyleSheet, Text, View } from 'react-native';

import type { EntryType } from '@navigation/types';
import { ENTRY_TYPES, getEntryTypeConfig } from '@constants/entryTypes';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

import { CategoryButton } from './CategoryButton';
import { SelectedCategoryDisplay } from './SelectedCategoryDisplay';

export interface CategorySelectorProps {
  /** Currently selected entry type */
  entryType: EntryType | null;
  /** Whether a type has been selected and confirmed */
  hasSelectedType: boolean;
  /** Called when a category button is pressed */
  onTypeSelect: (type: EntryType) => void;
  /** Called when the "Change" button is pressed on selected display */
  onChangeType: () => void;
}

export function CategorySelector({
  entryType,
  hasSelectedType,
  onTypeSelect,
  onChangeType,
}: CategorySelectorProps) {
  const selectedTypeConfig = entryType ? getEntryTypeConfig(entryType) : null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>CATEGORY</Text>
      {hasSelectedType && selectedTypeConfig ? (
        <SelectedCategoryDisplay typeConfig={selectedTypeConfig} onChangeType={onChangeType} />
      ) : (
        <View style={styles.categoryGrid}>
          {ENTRY_TYPES.map((item, index) => (
            <CategoryButton
              key={item.type}
              item={item}
              isSelected={entryType === item.type}
              onPress={() => onTypeSelect(item.type)}
              index={index}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontFamily: fonts.oswald.medium,
    fontSize: 12,
    color: colors.midnightNavy,
    marginBottom: 12,
    letterSpacing: 1.5,
    opacity: 0.7,
    textTransform: 'uppercase',
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
});
