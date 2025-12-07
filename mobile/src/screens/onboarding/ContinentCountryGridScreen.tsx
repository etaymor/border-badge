import { useCallback, useMemo } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, CountryGridItem } from '@components/ui';
import { colors } from '@constants/colors';
import { ALL_REGIONS, REGIONS, type Region } from '@constants/regions';
import { useCountriesByRegion } from '@hooks/useCountries';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { useOnboardingStore } from '@stores/onboardingStore';

type Props = OnboardingStackScreenProps<'ContinentCountryGrid'>;

export function ContinentCountryGridScreen({ navigation, route }: Props) {
  const { region } = route.params;
  // Use region-specific hook for better performance (queries SQLite directly)
  const { data: regionCountries, isLoading } = useCountriesByRegion(region);
  const {
    selectedCountries,
    toggleCountry,
    bucketListCountries,
    toggleBucketListCountry,
    visitedContinents,
  } = useOnboardingStore();

  // Count selected countries in this region
  const selectedInRegion = useMemo(() => {
    return regionCountries.filter((c) => selectedCountries.includes(c.code)).length;
  }, [regionCountries, selectedCountries]);

  const handleSaveAndContinue = () => {
    // Find current region index and move to next
    const currentIndex = REGIONS.indexOf(region as Region);
    const nextIndex = currentIndex + 1;

    if (nextIndex < REGIONS.length) {
      navigation.navigate('ContinentIntro', {
        region: REGIONS[nextIndex],
        regionIndex: nextIndex,
      });
    } else {
      // After Oceania, show Antarctica prompt
      navigation.navigate('AntarcticaPrompt');
    }
  };

  // Wrap in useCallback to prevent FlatList re-renders
  const renderCountryItem = useCallback(
    ({ item }: { item: (typeof regionCountries)[0] }) => (
      <CountryGridItem
        code={item.code}
        name={item.name}
        isSelected={selectedCountries.includes(item.code)}
        isWishlisted={bucketListCountries.includes(item.code)}
        onToggleVisited={() => toggleCountry(item.code)}
        onToggleWishlist={() => toggleBucketListCountry(item.code)}
      />
    ),
    [selectedCountries, bucketListCountries, toggleCountry, toggleBucketListCountry]
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading countries...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backIcon}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.regionTitle}>{region}</Text>
          <Button
            title="Save & Continue"
            onPress={handleSaveAndContinue}
            variant="ghost"
            style={styles.headerButton}
          />
        </View>
        <Text style={styles.progressText}>
          {selectedInRegion}/{regionCountries.length} logged
        </Text>
      </View>

      {/* Floating selected badge */}
      {selectedInRegion > 0 && (
        <View style={styles.floatingBadge}>
          <Text style={styles.floatingBadgeText}>{selectedInRegion} selected</Text>
        </View>
      )}

      {/* Country grid */}
      <FlatList
        data={regionCountries}
        renderItem={renderCountryItem}
        keyExtractor={(item) => item.code}
        numColumns={3}
        contentContainerStyle={styles.gridContent}
        showsVerticalScrollIndicator={false}
        testID="country-grid"
      />

      {/* Footer */}
      <View style={styles.footer}>
        <Button
          title="Save & Continue"
          onPress={handleSaveAndContinue}
          style={styles.footerButton}
          testID="save-continue-button"
        />
      </View>

      {/* Progress indicator - 6 dots for all regions including Antarctica */}
      <View style={styles.progressContainer}>
        {ALL_REGIONS.map((r, index) => (
          <View
            key={index}
            style={[
              styles.progressDot,
              visitedContinents.includes(r) && styles.progressDotCompleted,
              r === region && styles.progressDotActive,
            ]}
          />
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  backButton: {
    paddingRight: 8,
    paddingVertical: 4,
  },
  backIcon: {
    fontSize: 28,
    color: colors.textPrimary,
    fontWeight: '300',
  },
  regionTitle: {
    flex: 1,
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  headerButton: {
    paddingHorizontal: 0,
  },
  progressText: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  floatingBadge: {
    position: 'absolute',
    top: 100,
    right: 16,
    backgroundColor: '#007AFF',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  floatingBadgeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  gridContent: {
    padding: 8,
    paddingBottom: 100,
  },
  footer: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#F2F2F7',
  },
  footerButton: {
    width: '100%',
  },
  progressContainer: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    backgroundColor: '#fff',
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E5E5EA',
  },
  progressDotActive: {
    backgroundColor: '#007AFF',
    width: 24,
  },
  progressDotCompleted: {
    backgroundColor: '#34C759',
  },
});
