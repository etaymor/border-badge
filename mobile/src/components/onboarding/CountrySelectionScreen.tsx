import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Image,
  Keyboard,
  Modal,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassBackButton, Text } from '@components/ui';

/* eslint-disable @typescript-eslint/no-require-imports */
const atlasLogo = require('../../../assets/atlasi-logo.png');
/* eslint-enable @typescript-eslint/no-require-imports */
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useCountries, type Country } from '@hooks/useCountries';
import { useCountrySelectionAnimations } from '@hooks/useCountrySelectionAnimations';
import { getFlagEmoji } from '@utils/flags';

import CelebrationOverlay from './CelebrationOverlay';

export interface CountrySelectionConfig {
  // Appearance
  backgroundColor: string;
  title: string;
  dropdownBorderColor: string;

  // Celebration overlay
  celebrationType: 'home' | 'dream';

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

export default function CountrySelectionScreen({ config }: CountrySelectionScreenProps) {
  const {
    backgroundColor,
    title,
    dropdownBorderColor,
    celebrationType,
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
  const hasNavigatedRef = useRef(false);

  const { data: countries, isLoading, error, refetch } = useCountries();
  const currentSelection = getCurrentSelection();

  const { refs, animateDropdown, playCelebration } = useCountrySelectionAnimations({
    hasLocationPin: heroElement === 'locationPin',
    hasBackButton: showBackButton,
    celebrationHoldDuration: 600, // Faster transition to next step
  });

  // Reset navigation ref on mount
  useEffect(() => {
    hasNavigatedRef.current = false;
  }, []);

  // Safe navigation wrapper
  const handleNavigateNext = () => {
    if (!hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      setShowSelection(false);
      onNavigateNext();
    }
  };

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
    hasNavigatedRef.current = false; // Reset for this selection attempt

    // Play celebration animation then navigate
    playCelebration(() => {
      handleNavigateNext();
    });
  };

  const handleNext = () => {
    handleNavigateNext();
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
      {/* Header with logo and login */}
      <View style={styles.headerRow}>
        {/* Back button - left side */}
        {showBackButton && (
          <Animated.View style={[styles.backButtonContainer, { opacity: refs.backButtonOpacity }]}>
            <GlassBackButton onPress={handleBack} />
          </Animated.View>
        )}

        <Image source={atlasLogo} style={styles.logo} resizeMode="contain" />

        {/* Login button - right side */}
        <TouchableOpacity onPress={handleLogin} style={styles.loginButton}>
          <Text variant="label" style={styles.loginText}>
            Login
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {/* Title - Text component handles responsive sizing */}
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

        {/* Search Input - Liquid Glass Style */}
        <Animated.View
          style={[
            styles.searchContainer,
            {
              opacity: refs.searchOpacity,
              transform: [{ translateY: refs.searchTranslate }],
            },
          ]}
        >
          <View style={styles.searchGlassWrapper}>
            <BlurView intensity={60} tint="light" style={styles.searchGlassContainer}>
              <View style={styles.searchInputWrapper}>
                <Ionicons
                  name="search"
                  size={18}
                  color={colors.stormGray}
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
                  placeholderTextColor={colors.stormGray}
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
                    <Ionicons name="close-circle" size={20} color={colors.stormGray} />
                  </TouchableOpacity>
                )}
              </View>
            </BlurView>
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

        {/* Error state */}
        {error && !isLoading && (
          <View style={styles.errorContainer}>
            <Ionicons name="cloud-offline-outline" size={48} color={colors.dustyCoral} />
            <Text variant="body" style={styles.errorText}>
              Unable to load countries
            </Text>
            <TouchableOpacity
              onPress={refetch}
              style={styles.retryButton}
              accessibilityRole="button"
              accessibilityLabel="Retry loading countries"
            >
              <Text variant="label" style={styles.retryText}>
                Tap to retry
              </Text>
            </TouchableOpacity>
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

      {/* Selection Celebration Overlay - Using Modal for guaranteed overlay above all content */}
      <Modal
        visible={showSelection && !!selectedCountryData}
        transparent={true}
        animationType="none"
        statusBarTranslucent={true}
      >
        {selectedCountryData && (
          <CelebrationOverlay
            visible={true}
            countryCode={selectedCountryData.code}
            countryName={selectedCountryData.name}
            type={celebrationType}
            animationRefs={refs}
            onSkip={handleNavigateNext}
          />
        )}
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backButtonContainer: {
    position: 'absolute',
    left: 20,
  },
  logo: {
    width: 140,
    height: 40,
  },
  loginButton: {
    position: 'absolute',
    right: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  loginText: {
    color: colors.midnightNavy,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  header: {
    marginBottom: 32,
  },
  title: {
    color: colors.midnightNavy,
  },
  searchContainer: {
    position: 'relative',
    zIndex: 1, // Reduced from 10 to avoid overlapping animations
  },
  searchGlassWrapper: {
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: 12,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  searchGlassContainer: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    backgroundColor: 'transparent',
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  clearButton: {
    padding: 4,
  },
  dropdown: {
    position: 'absolute',
    top: 60,
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
  errorContainer: {
    position: 'absolute',
    top: '40%',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  errorText: {
    color: colors.midnightNavy,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  retryButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  retryText: {
    color: colors.primary,
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
