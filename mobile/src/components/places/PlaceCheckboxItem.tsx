/**
 * PlaceCheckboxItem - A checkbox item for selecting places in multi-place extraction.
 *
 * Displays a place with checkbox, name, address, and entry type chip.
 * Features premium styling with tinted chips and animated interactions.
 */

import { useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { Text } from '@components/ui';
import type { EntryType } from '@navigation/types';

// Entry type display configuration - Icon-only tinted pills
const ENTRY_TYPE_CONFIG: Record<
  EntryType,
  { icon: keyof typeof Ionicons.glyphMap; color: string; bgTint: string }
> = {
  place: {
    icon: 'location-outline',
    color: colors.midnightNavy,
    bgTint: 'rgba(23, 42, 58, 0.08)',
  },
  food: {
    icon: 'restaurant-outline',
    color: '#D4A373', // Latte gold
    bgTint: 'rgba(212, 163, 115, 0.15)',
  },
  stay: {
    icon: 'bed-outline',
    color: '#8D99AE', // Slate blue
    bgTint: 'rgba(141, 153, 174, 0.15)',
  },
  experience: {
    icon: 'sparkles-outline',
    color: '#6B705C', // Olive
    bgTint: 'rgba(107, 112, 92, 0.15)',
  },
};

export interface PlaceCheckboxItemProps {
  name: string;
  address: string | null;
  countryCode: string | null;
  showCountryChip: boolean; // True when places span multiple countries
  entryType: EntryType;
  isSelected: boolean;
  onToggle: () => void;
  onEdit?: () => void;
  onEntryTypeChange: (type: EntryType) => void;
  /** Show the edit button. Defaults to false until edit flow is implemented. */
  showEditButton?: boolean;
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
  showEditButton = false,
}: PlaceCheckboxItemProps) {
  const typeConfig = useMemo(() => ENTRY_TYPE_CONFIG[entryType], [entryType]);

  // Scale animations (native driver) - separate from color animations
  const checkboxScale = useRef(new Animated.Value(1)).current;
  const typeChipScale = useRef(new Animated.Value(1)).current;

  const handleToggle = () => {
    // Bounce animation
    Animated.sequence([
      Animated.spring(checkboxScale, {
        toValue: 1.15,
        friction: 3,
        tension: 200,
        useNativeDriver: true,
      }),
      Animated.spring(checkboxScale, {
        toValue: 1,
        friction: 5,
        tension: 100,
        useNativeDriver: true,
      }),
    ]).start();
    onToggle();
  };

  const handleTypeChange = () => {
    // Bounce animation on type change
    Animated.sequence([
      Animated.spring(typeChipScale, {
        toValue: 1.1,
        friction: 3,
        tension: 200,
        useNativeDriver: true,
      }),
      Animated.spring(typeChipScale, {
        toValue: 1,
        friction: 5,
        tension: 100,
        useNativeDriver: true,
      }),
    ]).start();

    // Cycle through entry types
    const types: EntryType[] = ['place', 'food', 'stay', 'experience'];
    const currentIndex = types.indexOf(entryType);
    const nextIndex = (currentIndex + 1) % types.length;
    onEntryTypeChange(types[nextIndex]);
  };

  return (
    <View style={[styles.container, isSelected && styles.containerSelected]}>
      {/* Checkbox with scale animation */}
      <Animated.View style={[styles.checkboxContainer, { transform: [{ scale: checkboxScale }] }]}>
        <Pressable
          onPress={handleToggle}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isSelected }}
        >
          <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
            {isSelected && <Ionicons name="checkmark" size={14} color={colors.white} />}
          </View>
        </Pressable>
      </Animated.View>

      {/* Place Info */}
      <Pressable style={styles.content} onPress={handleToggle}>
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

      {/* Entry Type Icon Pill with scale animation */}
      <Animated.View style={{ transform: [{ scale: typeChipScale }] }}>
        <Pressable
          style={[styles.typeChip, { backgroundColor: typeConfig.bgTint }]}
          onPress={handleTypeChange}
          accessibilityRole="button"
          accessibilityLabel={`Entry type: ${entryType}. Tap to change.`}
        >
          <Ionicons name={typeConfig.icon} size={16} color={typeConfig.color} />
        </Pressable>
      </Animated.View>

      {/* Edit Button - hidden until edit flow is implemented */}
      {showEditButton && onEdit && (
        <Pressable style={styles.editButton} onPress={onEdit} accessibilityLabel="Edit place">
          <Ionicons name="pencil-outline" size={18} color={colors.textSecondary} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: 'transparent',
  },
  containerSelected: {
    backgroundColor: 'rgba(255, 198, 54, 0.06)', // Subtle gold tint
  },
  checkboxContainer: {
    padding: 4,
    marginRight: 14,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11, // Circle
    borderWidth: 2,
    borderColor: 'rgba(23, 42, 58, 0.25)',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: colors.sunsetGold,
    borderColor: colors.sunsetGold,
  },
  content: {
    flex: 1,
    marginRight: 12,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    fontFamily: fonts.playfair.bold,
    fontSize: 16,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  countryChip: {
    backgroundColor: 'rgba(23, 42, 58, 0.08)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  countryLabel: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 10,
    color: colors.midnightNavy,
    letterSpacing: 0.5,
  },
  address: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.textSecondary,
    opacity: 0.6,
    marginTop: 2,
  },
  typeChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editButton: {
    padding: 8,
    marginLeft: 4,
  },
});
