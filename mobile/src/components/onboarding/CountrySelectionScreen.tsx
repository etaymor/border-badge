import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState } from 'react';
import {
  Animated,
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
import { fonts } from '@constants/typography';
import { useCountries, type Country } from '@hooks/useCountries';
import { useCountrySelectionAnimations } from '@hooks/useCountrySelectionAnimations';
import { getFlagEmoji } from '@utils/flags';

import { CelebrationOverlay, type CelebrationBadgeConfig } from './CelebrationOverlay';

export interface CountrySelectionConfig {
  // Appearance
  backgroundColor: string;
  title: string;
  dropdownBorderColor: string;

  // Celebration overlay
  celebration: CelebrationBadgeConfig & {
    showStars?: boolean;
    holdDuration?: number;
  };

  // Visual elements
  heroElement?: 'locationPin';
  showBackButton?: boolean;

  // Store integration
  onCountrySelect: (country: Country) => void;
  getCurrentSelection: () => string | null;

  // Navigation
  onNavigateNext: () => void;
  onNavigateBack?: () => void;
  onNavigateLogin: () => void;

  // Test ID prefix
  testIdPrefix: string;
}

interface CountrySelectionScreenProps {
  config: CountrySelectionConfig;
}

export function CountrySelectionScreen({ config }: CountrySelectionScreenProps) {
  const {
    backgroundColor,
    title,
    dropdownBorderColor,
    celebration,
    heroElement,
    showBackButton = false,
    onCountrySelect,
    getCurrentSelection,
    onNavigateNext,
    onNavigateBack,
    onNavigateLogin,
    testIdPrefix,
  } = config;

  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedCountryData, setSelectedCountryData] = useState<Country | null>(null);
  const [showSelection, setShowSelection] = useState(false);

  const { data: countries, isLoading } = useCountries();
  const currentSelection = getCurrentSelection();

  const { refs, animateDropdown, playCelebration } = useCountrySelectionAnimations({
    hasLocationPin: heroElement === 'locationPin',
    hasBackButton: showBackButton,
    hasStars: celebration.showStars,
    celebrationHoldDuration: celebration.holdDuration ?? 600,
  });

  // Animate dropdown on visibility change
  useEffect(() => {
    animateDropdown(showDropdown);
  }, [showDropdown, animateDropdown]);

  const filteredCountries = useMemo(() => {
    if (!countries || !searchQuery) return [];
    const query = searchQuery.toLowerCase();
    return countries
      .filter((c) => c.name.toLowerCase().includes(query) || c.code.toLowerCase().includes(query))
      .slice(0, 8);
  }, [countries, searchQuery]);

  const handleSelectCountry = (country: Country) => {
    onCountrySelect(country);
    setSearchQuery('');
    setShowDropdown(false);
    Keyboard.dismiss();

    // Trigger haptic feedback
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Show the selection overlay
    setSelectedCountryData(country);
    setShowSelection(true);

    // Play celebration animation then navigate
    playCelebration(() => {
      setShowSelection(false);
      onNavigateNext();
    });
  };

  const handleNext = () => {
    onNavigateNext();
  };

  const handleBack = () => {
    onNavigateBack?.();
  };

  const handleLogin = () => {
    onNavigateLogin();
  };

  const renderDropdownItem = ({ item, index }: { item: Country; index: number }) => {
    const itemDelay = index * 50;

    return (
      <Animated.View
        style={{
          opacity: refs.dropdownOpacity,
          transform: [
            {
              translateY: refs.dropdownTranslate.interpolate({
                inputRange: [-10, 0],
                outputRange: [-10 + itemDelay * 0.1, 0],
              }),
            },
          ],
        }}
      >
        <TouchableOpacity
          style={[styles.dropdownItem, { borderBottomColor: dropdownBorderColor }]}
          onPress={() => handleSelectCountry(item)}
          testID={`${testIdPrefix}-country-option-${item.code}`}
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
    <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['top']}>
      {/* Back button - top left */}
      {showBackButton && (
        <Animated.View style={[styles.backButton, { opacity: refs.backButtonOpacity }]}>
          <TouchableOpacity
            onPress={handleBack}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={28} color={colors.midnightNavy} />
          </TouchableOpacity>
        </Animated.View>
      )}

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
              opacity: refs.titleOpacity,
              transform: [{ translateY: refs.titleTranslate }],
            },
          ]}
        >
          <Text variant="title" style={styles.title}>
            {title}
          </Text>
        </Animated.View>

        {/* Search Input */}
        <Animated.View
          style={[
            styles.searchContainer,
            {
              opacity: refs.searchOpacity,
              transform: [{ translateY: refs.searchTranslate }],
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
              testID={`${testIdPrefix}-search`}
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
                  opacity: refs.dropdownOpacity,
                  transform: [{ translateY: refs.dropdownTranslate }],
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

        {/* Hero Element: Location Pin */}
        {heroElement === 'locationPin' && (
          <Animated.View
            style={[
              styles.pinContainer,
              {
                opacity: refs.pinOpacity,
                transform: [{ scale: refs.pinScale }, { translateY: refs.pinBounce }],
              },
            ]}
          >
            <View style={styles.pinIcon}>
              <Ionicons name="location" size={220} color={colors.white} />
            </View>
          </Animated.View>
        )}

        {/* Spacer when no hero element */}
        {!heroElement && <View style={styles.spacer} />}

        {/* Loading indicator */}
        {isLoading && (
          <View style={styles.loadingContainer}>
            <Text variant="body" style={styles.loadingText}>
              Loading countries...
            </Text>
          </View>
        )}

        {/* Footer with Next button */}
        <Animated.View style={[styles.footer, { opacity: refs.buttonOpacity }]}>
          <TouchableOpacity
            style={[styles.nextButton, !currentSelection && styles.nextButtonDisabled]}
            onPress={handleNext}
            disabled={!currentSelection}
          >
            <Text variant="label" style={styles.nextButtonText}>
              Next
            </Text>
            <Ionicons name="arrow-forward" size={20} color={colors.midnightNavy} />
          </TouchableOpacity>
        </Animated.View>
      </View>

      {/* Selection Celebration Overlay */}
      <CelebrationOverlay
        visible={showSelection && !!selectedCountryData}
        flagEmoji={selectedCountryData ? getFlagEmoji(selectedCountryData.code) : ''}
        countryName={selectedCountryData?.name ?? ''}
        badge={celebration}
        showStars={celebration.showStars}
        animationRefs={refs}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  },
  flagEmoji: {
    fontSize: 28,
    marginRight: 16,
  },
  countryName: {
    fontSize: 17,
    color: colors.midnightNavy,
  },
  pinContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: -20,
  },
  pinIcon: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
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
});
