/**
 * MultiPlaceList - List of places with checkboxes for multi-place extraction.
 *
 * Displays detected places as individual cards with selection state, allowing users to:
 * - Toggle individual places on/off
 * - Edit individual places via search
 * - Change entry types per place
 */

import { useCallback, useMemo } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { Text } from '@components/ui';
import type { EntryType } from '@navigation/types';
import { placesSpanMultipleCountries } from '@screens/share/shareCaptureUtils';

import { PlaceCheckboxItem } from './PlaceCheckboxItem';

// Selection state for a place
export interface PlaceSelection {
  isSelected: boolean;
  entryType: EntryType;
  // Original detected data
  google_place_id: string | null;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  country: string | null;
  country_code: string | null;
  google_photo_url: string | null;
}

export interface MultiPlaceListProps {
  // Selection state keyed by place name (unique identifier)
  selections: Record<string, PlaceSelection>;
  onTogglePlace: (placeKey: string) => void;
  /** Optional - edit flow not yet implemented */
  onEditPlace?: (placeKey: string) => void;
  onEntryTypeChange: (placeKey: string, entryType: EntryType) => void;
  /** Show edit buttons on place items. Defaults to false until edit flow is implemented. */
  showEditButtons?: boolean;
  /** Callback to select all places */
  onSelectAll?: () => void;
  /** Callback to clear all selections */
  onClearAll?: () => void;
}

export function MultiPlaceList({
  selections,
  onTogglePlace,
  onEditPlace,
  onEntryTypeChange,
  showEditButtons = false,
  onSelectAll,
  onClearAll,
}: MultiPlaceListProps) {
  const placeKeys = Object.keys(selections);
  const selectedCount = Object.values(selections).filter((s) => s.isSelected).length;
  const showCountryChips = useMemo(() => placesSpanMultipleCountries(selections), [selections]);
  const allSelected = selectedCount === placeKeys.length;

  const handleToggle = useCallback(
    (key: string) => {
      onTogglePlace(key);
    },
    [onTogglePlace]
  );

  const handleEdit = useCallback(
    (key: string) => {
      onEditPlace?.(key);
    },
    [onEditPlace]
  );

  const handleEntryTypeChange = useCallback(
    (key: string, entryType: EntryType) => {
      onEntryTypeChange(key, entryType);
    },
    [onEntryTypeChange]
  );

  if (placeKeys.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      {/* Section Header */}
      <View style={styles.header}>
        <Text style={styles.sectionLabel}>SELECT PLACES</Text>
        {(onSelectAll || onClearAll) && (
          <Pressable
            onPress={allSelected ? onClearAll : onSelectAll}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.actionText}>{allSelected ? 'Clear all' : 'Select all'}</Text>
          </Pressable>
        )}
      </View>

      {/* Glass Card Container */}
      <BlurView intensity={25} tint="light" style={styles.glassContainer}>
        <View style={styles.glassInner}>
          {placeKeys.map((key, index) => {
            const selection = selections[key];
            const isLast = index === placeKeys.length - 1;
            return (
              <View key={key}>
                <PlaceCheckboxItem
                  name={selection.name}
                  address={selection.address}
                  countryCode={selection.country_code}
                  showCountryChip={showCountryChips}
                  entryType={selection.entryType}
                  isSelected={selection.isSelected}
                  onToggle={() => handleToggle(key)}
                  onEdit={() => handleEdit(key)}
                  onEntryTypeChange={(type) => handleEntryTypeChange(key, type)}
                  showEditButton={showEditButtons}
                />
                {!isLast && <View style={styles.separator} />}
              </View>
            );
          })}
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
    marginBottom: 12,
  },
  sectionLabel: {
    fontFamily: fonts.oswald.medium,
    fontSize: 12,
    color: colors.textSecondary,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  actionText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 13,
    color: colors.sunsetGold,
  },
  glassContainer: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.8)',
    ...Platform.select({
      ios: {
        shadowColor: colors.midnightNavy,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  glassInner: {
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  separator: {
    height: 1,
    backgroundColor: 'rgba(23, 42, 58, 0.06)',
    marginHorizontal: 16,
  },
});
