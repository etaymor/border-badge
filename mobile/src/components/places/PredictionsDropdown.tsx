/**
 * Predictions dropdown component for places autocomplete.
 * Displays search results and allows selection or manual entry.
 */

import { memo, useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { liquidGlass, GLASS_CONFIG } from '@constants/glass';
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
    <View style={styles.dropdownContainer} testID={`${testID}-dropdown`}>
      <BlurView
        intensity={GLASS_CONFIG.intensity.high}
        tint={GLASS_CONFIG.tint}
        style={styles.dropdownBlur}
      >
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
      </BlurView>
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
    <View style={styles.dropdownContainer}>
      <BlurView
        intensity={GLASS_CONFIG.intensity.high}
        tint={GLASS_CONFIG.tint}
        style={styles.dropdownBlur}
      >
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
      </BlurView>
    </View>
  );
});

const styles = StyleSheet.create({
  dropdownContainer: {
    position: 'absolute',
    top: 56, // Input height (48) + margin (8)
    left: 0,
    right: 0,
    zIndex: 9999, // Super high z-index
    // Use liquidGlass properties for shadow/elevation/border-radius container
    borderRadius: 20,
    ...liquidGlass.floatingCard,
    // Reset background and border to let BlurView handle visual fill
    backgroundColor: 'transparent', 
    borderWidth: 0,
  },
  dropdownBlur: {
    // Re-apply border and radius to the inner blur view to ensure glass effect is contained
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    overflow: 'hidden',
    width: '100%',
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
    borderBottomColor: liquidGlass.separator.backgroundColor,
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
    borderTopColor: liquidGlass.separator.backgroundColor,
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
