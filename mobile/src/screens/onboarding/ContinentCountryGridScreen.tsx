import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// Calculate row height based on card aspect ratio (3:4) and layout
// Available width = SCREEN_WIDTH - padding(16*2) - gap(12) = 2 cards
// Card width = (SCREEN_WIDTH - 44) / 2
// Card height = cardWidth * (4/3) due to aspectRatio 3/4
// Row height = cardHeight + marginBottom(12)
const CARD_WIDTH = (SCREEN_WIDTH - 44) / 2;
const CARD_HEIGHT = CARD_WIDTH * (4 / 3);
const ROW_HEIGHT = CARD_HEIGHT + 12; // 12px marginBottom

import { CountryCard, GlassBackButton } from '@components/ui';
import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';
import { ALL_REGIONS, REGIONS, type Region } from '@constants/regions';
import { useCountriesByRegion } from '@hooks/useCountries';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { useOnboardingStore } from '@stores/onboardingStore';

type Props = OnboardingStackScreenProps<'ContinentCountryGrid'>;

// Type for country pairs (for 2-column rows)
interface CountryPair {
  left: { code: string; name: string };
  right?: { code: string; name: string };
}

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

  // Animation values
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const gridOpacity = useRef(new Animated.Value(0)).current;
  const footerOpacity = useRef(new Animated.Value(0)).current;
  const badgeScale = useRef(new Animated.Value(1)).current;

  // Staggered entrance animations
  useEffect(() => {
    headerOpacity.setValue(0);
    gridOpacity.setValue(0);
    footerOpacity.setValue(0);

    Animated.sequence([
      Animated.timing(headerOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(gridOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(footerOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [region, headerOpacity, gridOpacity, footerOpacity]);

  // Bounce badge when selection count changes
  const prevSelectedCount = useRef(0);
  const selectedInRegion = useMemo(() => {
    return regionCountries.filter((c) => selectedCountries.includes(c.code)).length;
  }, [regionCountries, selectedCountries]);

  useEffect(() => {
    if (selectedInRegion !== prevSelectedCount.current && selectedInRegion > 0) {
      Animated.sequence([
        Animated.spring(badgeScale, {
          toValue: 1.2,
          friction: 3,
          tension: 200,
          useNativeDriver: true,
        }),
        Animated.spring(badgeScale, {
          toValue: 1,
          friction: 3,
          useNativeDriver: true,
        }),
      ]).start();
    }
    prevSelectedCount.current = selectedInRegion;
  }, [selectedInRegion, badgeScale]);

  // Pair countries for 2-column layout
  const countryPairs: CountryPair[] = useMemo(() => {
    const pairs: CountryPair[] = [];
    for (let i = 0; i < regionCountries.length; i += 2) {
      pairs.push({
        left: regionCountries[i],
        right: regionCountries[i + 1],
      });
    }
    return pairs;
  }, [regionCountries]);

  const handleSaveAndContinue = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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

  const handleToggleVisited = useCallback(
    (code: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      toggleCountry(code);
    },
    [toggleCountry]
  );

  const handleToggleWishlist = useCallback(
    (code: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      toggleBucketListCountry(code);
    },
    [toggleBucketListCountry]
  );

  // FlatList optimization for instant scroll calculations
  const getItemLayout = useCallback(
    (_: ArrayLike<CountryPair> | null | undefined, index: number) => ({
      length: ROW_HEIGHT,
      offset: ROW_HEIGHT * index,
      index,
    }),
    []
  );

  const renderCountryRow = useCallback(
    ({ item }: { item: CountryPair }) => (
      <View style={styles.countryRow}>
        <View style={styles.countryCardWrapper}>
          <CountryCard
            code={item.left.code}
            name={item.left.name}
            isVisited={selectedCountries.includes(item.left.code)}
            isWishlisted={bucketListCountries.includes(item.left.code)}
            onPress={() => handleToggleVisited(item.left.code)}
            onAddVisited={() => handleToggleVisited(item.left.code)}
            onToggleWishlist={() => handleToggleWishlist(item.left.code)}
          />
        </View>
        {item.right && (
          <View style={styles.countryCardWrapper}>
            <CountryCard
              code={item.right.code}
              name={item.right.name}
              isVisited={selectedCountries.includes(item.right.code)}
              isWishlisted={bucketListCountries.includes(item.right.code)}
              onPress={() => handleToggleVisited(item.right!.code)}
              onAddVisited={() => handleToggleVisited(item.right!.code)}
              onToggleWishlist={() => handleToggleWishlist(item.right!.code)}
            />
          </View>
        )}
        {!item.right && <View style={styles.countryCardWrapper} />}
      </View>
    ),
    [selectedCountries, bucketListCountries, handleToggleVisited, handleToggleWishlist]
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
      <Animated.View style={[styles.header, { opacity: headerOpacity }]}>
        <View style={styles.headerTop}>
          <GlassBackButton onPress={() => navigation.goBack()} />
          <View style={styles.headerCenter}>
            <Text style={styles.regionTitle}>{region}</Text>
            <Text style={styles.progressText}>
              {selectedInRegion}/{regionCountries.length} countries selected
            </Text>
          </View>
          {/* Floating selected badge */}
          {selectedInRegion > 0 && (
            <Animated.View style={[styles.floatingBadge, { transform: [{ scale: badgeScale }] }]}>
              <Text style={styles.floatingBadgeText}>{selectedInRegion}</Text>
            </Animated.View>
          )}
        </View>
      </Animated.View>

      {/* Country grid */}
      <Animated.View style={[styles.gridContainer, { opacity: gridOpacity }]}>
        <FlatList
          data={countryPairs}
          renderItem={renderCountryRow}
          keyExtractor={(item) => item.left.code}
          getItemLayout={getItemLayout}
          contentContainerStyle={styles.gridContent}
          showsVerticalScrollIndicator={false}
          testID="country-grid"
        />
      </Animated.View>

      {/* Footer */}
      <Animated.View style={[styles.footer, { opacity: footerOpacity }]}>
        <TouchableOpacity
          style={styles.continueButton}
          onPress={handleSaveAndContinue}
          activeOpacity={0.8}
        >
          <Text style={styles.continueButtonText}>Save & Continue</Text>
          <Ionicons name="arrow-forward" size={20} color={colors.midnightNavy} />
        </TouchableOpacity>

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
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    fontFamily: fonts.openSans.regular,
    color: colors.stormGray,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.paperBeige,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerCenter: {
    flex: 1,
    marginLeft: 12,
  },
  regionTitle: {
    fontSize: 28,
    fontFamily: fonts.playfair.bold,
    color: colors.midnightNavy,
  },
  progressText: {
    fontSize: 14,
    fontFamily: fonts.openSans.regular,
    color: colors.stormGray,
    marginTop: 2,
  },
  floatingBadge: {
    backgroundColor: colors.mossGreen,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  floatingBadgeText: {
    color: colors.white,
    fontSize: 16,
    fontFamily: fonts.openSans.bold,
  },
  gridContainer: {
    flex: 1,
  },
  gridContent: {
    padding: 16,
    paddingBottom: 180,
  },
  countryRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  countryCardWrapper: {
    flex: 1,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.warmCream,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: colors.paperBeige,
  },
  continueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sunsetGold,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  continueButtonText: {
    fontSize: 18,
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
  },
  progressContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: withAlpha(colors.midnightNavy, 0.19),
  },
  progressDotActive: {
    backgroundColor: colors.midnightNavy,
    width: 24,
  },
  progressDotCompleted: {
    backgroundColor: colors.mossGreen,
  },
});
