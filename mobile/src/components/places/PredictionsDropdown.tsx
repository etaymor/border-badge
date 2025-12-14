/**
 * Predictions dropdown component for places autocomplete.
 * Displays search results and allows selection or manual entry.
 */

import { memo, useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { Prediction } from '@services/placesApi';

interface PredictionItemProps {
  prediction: Prediction;
  onSelect: (prediction: Prediction) => void;
}

const PredictionItem = memo(function PredictionItem({ prediction, onSelect }: PredictionItemProps) {
  const handlePress = useCallback(() => {
    onSelect(prediction);
  }, [prediction, onSelect]);

  return (
    <Pressable style={styles.predictionItem} onPress={handlePress}>
      <Ionicons
        name="location-outline"
        size={20}
        color={colors.adobeBrick}
        style={styles.predictionIcon}
      />
      <View style={styles.predictionText}>
        <Text style={styles.predictionMain} numberOfLines={1}>
          {prediction.structured_formatting.main_text}
        </Text>
        <Text style={styles.predictionSecondary} numberOfLines={1}>
          {prediction.structured_formatting.secondary_text}
        </Text>
      </View>
    </Pressable>
  );
});

interface PredictionsDropdownProps {
  predictions: Prediction[];
  onSelectPrediction: (prediction: Prediction) => void;
  onManualEntry: () => void;
  testID?: string;
}

export const PredictionsDropdown = memo(function PredictionsDropdown({
  predictions,
  onSelectPrediction,
  onManualEntry,
  testID = 'places-search',
}: PredictionsDropdownProps) {
  return (
    <View style={styles.dropdown} testID={`${testID}-dropdown`}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        style={styles.predictionsList}
      >
        {predictions.map((item) => (
          <PredictionItem key={item.place_id} prediction={item} onSelect={onSelectPrediction} />
        ))}
      </ScrollView>
      <Pressable
        style={styles.manualEntryButton}
        testID="manual-entry-button"
        onPress={onManualEntry}
      >
        <Ionicons name="create-outline" size={18} color={colors.adobeBrick} />
        <Text style={styles.manualEntryText}>Enter manually instead</Text>
      </Pressable>
    </View>
  );
});

interface NoResultsDropdownProps {
  onManualEntry: () => void;
}

export const NoResultsDropdown = memo(function NoResultsDropdown({
  onManualEntry,
}: NoResultsDropdownProps) {
  return (
    <View style={styles.dropdown}>
      <View style={styles.noResults}>
        <Text style={styles.noResultsText}>No places found</Text>
      </View>
      <Pressable
        style={styles.manualEntryButton}
        testID="manual-entry-button"
        onPress={onManualEntry}
      >
        <Ionicons name="create-outline" size={18} color={colors.adobeBrick} />
        <Text style={styles.manualEntryText}>Enter manually</Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  dropdown: {
    position: 'absolute',
    top: 56, // Input height (48) + margin (8)
    left: 0,
    right: 0,
    zIndex: 9999, // Super high z-index
    backgroundColor: '#fff',
    borderRadius: 12,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    maxHeight: 300,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  predictionsList: {
    maxHeight: 250,
  },
  predictionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  predictionIcon: {
    marginRight: 12,
  },
  predictionText: {
    flex: 1,
  },
  predictionMain: {
    fontSize: 15,
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
  },
  predictionSecondary: {
    fontSize: 13,
    fontFamily: fonts.openSans.regular,
    color: colors.textSecondary,
    marginTop: 2,
  },
  manualEntryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
    gap: 6,
  },
  manualEntryText: {
    fontSize: 14,
    color: colors.adobeBrick,
    fontFamily: fonts.openSans.semiBold,
  },
  noResults: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  noResultsText: {
    fontSize: 14,
    fontFamily: fonts.openSans.regular,
    color: colors.textSecondary,
  },
});
