import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  Keyboard,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@components/ui';
import { colors } from '@constants/colors';
import { REGIONS } from '@constants/regions';
import { fonts } from '@constants/typography';
import { useCountries, type Country } from '@hooks/useCountries';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { useOnboardingStore } from '@stores/onboardingStore';
import { getFlagEmoji } from '@utils/flags';

type Props = OnboardingStackScreenProps<'DreamDestination'>;

export function DreamDestinationScreen({ navigation }: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedCountryData, setSelectedCountryData] = useState<Country | null>(null);
  const [showSelection, setShowSelection] = useState(false);
  const { dreamDestination, setDreamDestination, toggleBucketListCountry, bucketListCountries } =
    useOnboardingStore();
  const { data: countries, isLoading } = useCountries();

  // Animation values
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleTranslate = useRef(new Animated.Value(20)).current;
  const searchOpacity = useRef(new Animated.Value(0)).current;
  const searchTranslate = useRef(new Animated.Value(20)).current;
  const buttonOpacity = useRef(new Animated.Value(0)).current;
  const backButtonOpacity = useRef(new Animated.Value(0)).current;
  const dropdownOpacity = useRef(new Animated.Value(0)).current;
  const dropdownTranslate = useRef(new Animated.Value(-10)).current;

  // Selection celebration animation values
  const selectionScale = useRef(new Animated.Value(0)).current;
  const selectionOpacity = useRef(new Animated.Value(0)).current;
  const flagScale = useRef(new Animated.Value(0.5)).current;
  const flagRotate = useRef(new Animated.Value(0)).current;
  const checkmarkScale = useRef(new Animated.Value(0)).current;
  const checkmarkOpacity = useRef(new Animated.Value(0)).current;
  const confettiOpacity = useRef(new Animated.Value(0)).current;
  const starScale = useRef(new Animated.Value(0)).current;

  // Staggered entrance animations
  useEffect(() => {
    Animated.sequence([
      Animated.timing(backButtonOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.parallel([
        Animated.timing(titleOpacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(titleTranslate, {
          toValue: 0,
          duration: 500,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(searchOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(searchTranslate, {
          toValue: 0,
          duration: 400,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(buttonOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, [
    titleOpacity,
    titleTranslate,
    searchOpacity,
    searchTranslate,
    buttonOpacity,
    backButtonOpacity,
  ]);

  // Animate dropdown appearance
  useEffect(() => {
    if (showDropdown) {
      Animated.parallel([
        Animated.timing(dropdownOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(dropdownTranslate, {
          toValue: 0,
          duration: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      dropdownOpacity.setValue(0);
      dropdownTranslate.setValue(-10);
    }
  }, [showDropdown, dropdownOpacity, dropdownTranslate]);

  const filteredCountries = useMemo(() => {
    if (!countries || !searchQuery) return [];
    const query = searchQuery.toLowerCase();
    return countries
      .filter((c) => c.name.toLowerCase().includes(query) || c.code.toLowerCase().includes(query))
      .slice(0, 8);
  }, [countries, searchQuery]);

  const playSelectionCelebration = (country: Country) => {
    // Trigger haptic feedback
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Reset animation values
    selectionScale.setValue(0);
    selectionOpacity.setValue(0);
    flagScale.setValue(0.5);
    flagRotate.setValue(0);
    checkmarkScale.setValue(0);
    checkmarkOpacity.setValue(0);
    confettiOpacity.setValue(0);
    starScale.setValue(0);

    // Show the selection overlay
    setSelectedCountryData(country);
    setShowSelection(true);

    // Play celebration sequence
    Animated.sequence([
      // Fade in backdrop and scale up container
      Animated.parallel([
        Animated.timing(selectionOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(selectionScale, {
          toValue: 1,
          friction: 6,
          tension: 100,
          useNativeDriver: true,
        }),
      ]),
      // Bounce in flag with rotation and stars
      Animated.parallel([
        Animated.spring(flagScale, {
          toValue: 1,
          friction: 4,
          tension: 80,
          useNativeDriver: true,
        }),
        Animated.timing(flagRotate, {
          toValue: 1,
          duration: 400,
          easing: Easing.out(Easing.back(1.5)),
          useNativeDriver: true,
        }),
        Animated.timing(confettiOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(starScale, {
          toValue: 1,
          friction: 5,
          tension: 100,
          useNativeDriver: true,
        }),
      ]),
      // Pop in checkmark
      Animated.parallel([
        Animated.spring(checkmarkScale, {
          toValue: 1,
          friction: 5,
          tension: 120,
          useNativeDriver: true,
        }),
        Animated.timing(checkmarkOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
      // Hold for a moment
      Animated.delay(700),
      // Fade out
      Animated.timing(selectionOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setShowSelection(false);
      // Navigate to first continent intro
      navigation.navigate('ContinentIntro', { region: REGIONS[0], regionIndex: 0 });
    });
  };

  const handleSelectCountry = (country: Country) => {
    setDreamDestination(country.code);
    // Also add to bucket list if not already there
    if (!bucketListCountries.includes(country.code)) {
      toggleBucketListCountry(country.code);
    }
    setSearchQuery('');
    setShowDropdown(false);
    Keyboard.dismiss();

    // Play celebration animation then navigate
    playSelectionCelebration(country);
  };

  const handleNext = () => {
    navigation.navigate('ContinentIntro', { region: REGIONS[0], regionIndex: 0 });
  };

  const handleBack = () => {
    navigation.goBack();
  };

  const handleLogin = () => {
    navigation.navigate('PhoneAuth');
  };

  const renderDropdownItem = ({ item, index }: { item: Country; index: number }) => {
    const itemDelay = index * 50;

    return (
      <Animated.View
        style={{
          opacity: dropdownOpacity,
          transform: [
            {
              translateY: dropdownTranslate.interpolate({
                inputRange: [-10, 0],
                outputRange: [-10 + itemDelay * 0.1, 0],
              }),
            },
          ],
        }}
      >
        <TouchableOpacity
          style={styles.dropdownItem}
          onPress={() => handleSelectCountry(item)}
          testID={`country-option-${item.code}`}
          activeOpacity={0.7}
        >
          <Text style={styles.flagEmoji}>{getFlagEmoji(item.code)}</Text>
          <Text variant="body" style={styles.countryName}>
            {item.name}
          </Text>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Back button - top left */}
      <Animated.View style={[styles.backButton, { opacity: backButtonOpacity }]}>
        <TouchableOpacity onPress={handleBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={28} color={colors.midnightNavy} />
        </TouchableOpacity>
      </Animated.View>

      {/* Login button - top right */}
      <TouchableOpacity onPress={handleLogin} style={styles.loginButton}>
        <Text variant="label" style={styles.loginText}>
          Login
        </Text>
      </TouchableOpacity>

      <View style={styles.content}>
        {/* Title */}
        <Animated.View
          style={[
            styles.header,
            {
              opacity: titleOpacity,
              transform: [{ translateY: titleTranslate }],
            },
          ]}
        >
          <Text variant="title" style={styles.title}>
            Pick a place you dream of visiting
          </Text>
        </Animated.View>

        {/* Search Input */}
        <Animated.View
          style={[
            styles.searchContainer,
            {
              opacity: searchOpacity,
              transform: [{ translateY: searchTranslate }],
            },
          ]}
        >
          <View style={styles.searchInputWrapper}>
            <Ionicons
              name="search"
              size={28}
              color="rgba(23, 42, 58, 0.5)"
              style={styles.searchIcon}
            />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={(text) => {
                setSearchQuery(text);
                setShowDropdown(text.length > 0);
              }}
              placeholder="Type Country"
              placeholderTextColor="rgba(23, 42, 58, 0.5)"
              autoCapitalize="words"
              autoCorrect={false}
              onFocus={() => setShowDropdown(searchQuery.length > 0)}
              testID="dream-destination-search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => {
                  setSearchQuery('');
                  setShowDropdown(false);
                }}
                style={styles.clearButton}
              >
                <Ionicons name="close-circle" size={26} color="rgba(23, 42, 58, 0.5)" />
              </TouchableOpacity>
            )}
          </View>

          {/* Dropdown */}
          {showDropdown && filteredCountries.length > 0 && (
            <Animated.View
              style={[
                styles.dropdown,
                {
                  opacity: dropdownOpacity,
                  transform: [{ translateY: dropdownTranslate }],
                },
              ]}
            >
              <FlatList
                data={filteredCountries}
                keyExtractor={(item) => item.code}
                renderItem={renderDropdownItem}
                keyboardShouldPersistTaps="handled"
                style={styles.dropdownList}
                showsVerticalScrollIndicator={false}
              />
            </Animated.View>
          )}
        </Animated.View>

        {/* Spacer to push button to bottom */}
        <View style={styles.spacer} />

        {/* Loading indicator */}
        {isLoading && (
          <View style={styles.loadingContainer}>
            <Text variant="body" style={styles.loadingText}>
              Loading countries...
            </Text>
          </View>
        )}

        {/* Footer with Next button */}
        <Animated.View style={[styles.footer, { opacity: buttonOpacity }]}>
          <TouchableOpacity
            style={[styles.nextButton, !dreamDestination && styles.nextButtonDisabled]}
            onPress={handleNext}
            disabled={!dreamDestination}
          >
            <Text variant="label" style={styles.nextButtonText}>
              Next
            </Text>
            <Ionicons name="arrow-forward" size={20} color={colors.midnightNavy} />
          </TouchableOpacity>
        </Animated.View>
      </View>

      {/* Selection Celebration Overlay */}
      {showSelection && selectedCountryData && (
        <Animated.View
          style={[
            styles.celebrationOverlay,
            {
              opacity: selectionOpacity,
            },
          ]}
        >
          <Animated.View
            style={[
              styles.celebrationContent,
              {
                transform: [{ scale: selectionScale }],
              },
            ]}
          >
            {/* Confetti-like decorative elements */}
            <Animated.View style={[styles.confettiContainer, { opacity: confettiOpacity }]}>
              <View style={[styles.confettiDot, styles.confetti1]} />
              <View style={[styles.confettiDot, styles.confetti2]} />
              <View style={[styles.confettiDot, styles.confetti3]} />
              <View style={[styles.confettiDot, styles.confetti4]} />
              <View style={[styles.confettiDot, styles.confetti5]} />
              <View style={[styles.confettiDot, styles.confetti6]} />
            </Animated.View>

            {/* Stars around the flag */}
            <Animated.View
              style={[
                styles.starsContainer,
                {
                  opacity: confettiOpacity,
                  transform: [{ scale: starScale }],
                },
              ]}
            >
              <Ionicons name="star" size={24} color={colors.sunsetGold} style={styles.star1} />
              <Ionicons name="star" size={16} color={colors.sunsetGold} style={styles.star2} />
              <Ionicons name="star" size={20} color={colors.sunsetGold} style={styles.star3} />
            </Animated.View>

            {/* Flag with bounce */}
            <Animated.View
              style={[
                styles.celebrationFlag,
                {
                  transform: [
                    { scale: flagScale },
                    {
                      rotate: flagRotate.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['-10deg', '0deg'],
                      }),
                    },
                  ],
                },
              ]}
            >
              <Text style={styles.celebrationFlagText}>
                {getFlagEmoji(selectedCountryData.code)}
              </Text>
            </Animated.View>

            {/* Country name */}
            <Text variant="title" style={styles.celebrationCountryName}>
              {selectedCountryData.name}
            </Text>

            {/* Checkmark badge */}
            <Animated.View
              style={[
                styles.checkmarkBadge,
                {
                  opacity: checkmarkOpacity,
                  transform: [{ scale: checkmarkScale }],
                },
              ]}
            >
              <Ionicons name="sparkles" size={24} color={colors.sunsetGold} />
              <Text variant="label" style={styles.checkmarkText}>
                Dream Added!
              </Text>
            </Animated.View>
          </Animated.View>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.lakeBlue,
  },
  backButton: {
    position: 'absolute',
    top: 60,
    left: 20,
    zIndex: 10,
    padding: 8,
  },
  loginButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    zIndex: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  loginText: {
    color: colors.midnightNavy,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 80,
  },
  header: {
    marginBottom: 48,
  },
  title: {
    fontSize: 32,
    lineHeight: 40,
    color: colors.midnightNavy,
  },
  searchContainer: {
    position: 'relative',
    zIndex: 10,
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(23, 42, 58, 0.08)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
    minHeight: 60,
  },
  searchIcon: {
    marginRight: 16,
    alignSelf: 'center',
  },
  searchInput: {
    flex: 1,
    fontSize: 28,
    fontFamily: fonts.openSans.regular,
    color: colors.midnightNavy,
    paddingVertical: 0,
    lineHeight: 36,
  },
  clearButton: {
    padding: 4,
  },
  dropdown: {
    position: 'absolute',
    top: 76,
    left: 0,
    right: 0,
    backgroundColor: colors.warmCream,
    borderRadius: 16,
    maxHeight: 320,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
    overflow: 'hidden',
  },
  dropdownList: {
    maxHeight: 320,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.lakeBlue,
  },
  flagEmoji: {
    fontSize: 28,
    marginRight: 16,
  },
  countryName: {
    fontSize: 17,
    color: colors.midnightNavy,
  },
  spacer: {
    flex: 1,
  },
  loadingContainer: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  loadingText: {
    color: colors.midnightNavy,
    opacity: 0.7,
  },
  footer: {
    paddingVertical: 24,
    paddingBottom: 40,
  },
  nextButton: {
    backgroundColor: colors.sunsetGold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    paddingVertical: 16,
    paddingHorizontal: 56,
    borderRadius: 12,
    gap: 8,
    minWidth: 260,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  nextButtonDisabled: {
    opacity: 0.5,
  },
  nextButtonText: {
    fontSize: 16,
    color: colors.midnightNavy,
    fontWeight: '600',
  },
  // Celebration overlay styles
  celebrationOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(23, 42, 58, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  celebrationContent: {
    alignItems: 'center',
    padding: 40,
  },
  confettiContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confettiDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  confetti1: {
    backgroundColor: colors.sunsetGold,
    top: -40,
    left: 20,
  },
  confetti2: {
    backgroundColor: colors.dustyCoral,
    top: -20,
    right: 30,
  },
  confetti3: {
    backgroundColor: colors.mossGreen,
    bottom: -30,
    left: 40,
  },
  confetti4: {
    backgroundColor: colors.lakeBlue,
    bottom: -20,
    right: 20,
  },
  confetti5: {
    backgroundColor: colors.adobeBrick,
    top: 20,
    left: -20,
  },
  confetti6: {
    backgroundColor: colors.warmCream,
    top: 30,
    right: -10,
  },
  starsContainer: {
    position: 'absolute',
    width: 200,
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  star1: {
    position: 'absolute',
    top: 10,
    right: 20,
  },
  star2: {
    position: 'absolute',
    top: 50,
    left: 10,
  },
  star3: {
    position: 'absolute',
    bottom: 30,
    right: 30,
  },
  celebrationFlag: {
    marginBottom: 16,
  },
  celebrationFlagText: {
    fontSize: 80,
  },
  celebrationCountryName: {
    fontSize: 28,
    color: colors.white,
    marginBottom: 20,
    textAlign: 'center',
  },
  checkmarkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warmCream,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 30,
    gap: 8,
  },
  checkmarkText: {
    color: colors.midnightNavy,
    fontSize: 16,
    fontWeight: '600',
  },
});
