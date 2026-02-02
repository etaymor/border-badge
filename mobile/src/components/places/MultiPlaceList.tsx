/**
 * MultiPlaceList - List of places with checkboxes for multi-place extraction.
 *
 * Displays detected places with selection state, allowing users to:
 * - Toggle individual places on/off
 * - Edit individual places via search
 * - Change entry types per place
 */

import { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

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
}

export function MultiPlaceList({
  selections,
  onTogglePlace,
  onEditPlace,
  onEntryTypeChange,
  showEditButtons = false,
}: MultiPlaceListProps) {
  const placeKeys = Object.keys(selections);
  const selectedCount = Object.values(selections).filter((s) => s.isSelected).length;
  const showCountryChips = useMemo(() => placesSpanMultipleCountries(selections), [selections]);

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
      <View style={styles.header}>
        <Text style={styles.headerText}>
          Found {placeKeys.length} place{placeKeys.length > 1 ? 's' : ''}
        </Text>
        <Text style={styles.selectedText}>{selectedCount} selected</Text>
      </View>

      <View style={styles.list}>
        {placeKeys.map((key) => {
          const selection = selections[key];
          return (
            <PlaceCheckboxItem
              key={key}
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
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.white,
    borderRadius: 12,
    marginBottom: 16,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.paperBeige,
    backgroundColor: colors.warmCream,
  },
  headerText: {
    fontFamily: fonts.oswald.medium,
    fontSize: 14,
    color: colors.midnightNavy,
    letterSpacing: 0.5,
  },
  selectedText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.textSecondary,
  },
  list: {
    paddingHorizontal: 12,
  },
});
