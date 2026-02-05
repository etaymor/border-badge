import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
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

import { GlassBackButton, Text, StampCard } from '@components/ui';

/* eslint-disable @typescript-eslint/no-require-imports */
const atlasLogo = require('../../../assets/atlasi-logo.png');
/* eslint-enable @typescript-eslint/no-require-imports */
import { colors } from '@constants/colors';
import { liquidGlass, GLASS_CONFIG } from '@constants/glass';
import { fonts } from '@constants/typography';
import { useCountries, type Country } from '@hooks/useCountries';
import { useCountrySelectionAnimations } from '@hooks/useCountrySelectionAnimations';
import { getFlagEmoji } from '@utils/flags';

import CelebrationOverlay from './CelebrationOverlay';

export interface CountrySelectionConfig {
  // Appearance
  backgroundColor: string;
  title: string;
  subtitle?: string;

  // Celebration overlay
  celebrationType: 'home' | 'dream';

  // Visual elements
  heroElement?: 'locationPin';
  showBackButton?: boolean;
  /** Country codes for stamp-based quick selectors (e.g., ['US', 'DE', 'BR']) */
  stampSuggestions?: string[];

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
    subtitle,
    celebrationType,
    heroElement,
    showBackButton = false,
    stampSuggestions,
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
  const [inputDisabled, setInputDisabled] = useState(false);
  const hasNavigatedRef = useRef(false);
  const searchInputRef = useRef<TextInput>(null);

  const { data: countries, isLoading, error, refetch } = useCountries();
  const currentSelection = getCurrentSelection();

  const { refs, animateDropdown, playCelebration } = useCountrySelectionAnimations({
    hasLocationPin: heroElement === 'locationPin',
    hasBackButton: showBackButton,
    celebrationHoldDuration: 600, // Faster transition to next step
  });

  // Reset navigation ref and input state on screen focus
  useFocusEffect(
    useCallback(() => {
      hasNavigatedRef.current = false;
      setInputDisabled(false);
    }, [])
  );

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
    // 1. Dismiss keyboard and disable input FIRST to prevent iOS focus restoration
    Keyboard.dismiss();
    searchInputRef.current?.blur();
    setInputDisabled(true);

    // 2. Clear search state
    setSearchQuery('');
    setShowDropdown(false);

    // 3. Update store
    onCountrySelect(country);

    // 4. Trigger haptic feedback
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // 5. Show celebration overlay
    setSelectedCountryData(country);
    setShowSelection(true);
    hasNavigatedRef.current = false;

    // 6. Play celebration then navigate directly (no InteractionManager)
    playCelebration(() => {
      handleNavigateNext();
    });
  };

  const handleNext = () => {
    Keyboard.dismiss();
    handleNavigateNext();
  };

  const handleBack = () => {
    onNavigateBack?.();
  };

  const handleLogin = () => {
    onNavigateLogin();
  };

  const handleStampPress = (countryCode: string) => {
    if (!countries) return;

    const country = countries.find((c) => c.code === countryCode);

    if (country) {
      handleSelectCountry(country);
    }
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
          style={styles.dropdownItem}
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
          {subtitle && (
            <Text variant="body" style={styles.subtitle}>
              {subtitle}
            </Text>
          )}
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
                  ref={searchInputRef}
                  style={styles.searchInput}
                  value={searchQuery}
                  editable={!inputDisabled}
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
                liquidGlass.floatingCard,
                {
                  opacity: refs.dropdownOpacity,
                  transform: [{ translateY: refs.dropdownTranslate }],
                },
              ]}
            >
              <BlurView
                intensity={GLASS_CONFIG.intensity.medium}
                tint={GLASS_CONFIG.tint}
                style={styles.dropdownBlur}
              >
                <FlatList
                  data={filteredCountries}
                  keyExtractor={(item) => item.code}
                  renderItem={renderDropdownItem}
                  keyboardShouldPersistTaps="handled"
                  style={styles.dropdownList}
                  showsVerticalScrollIndicator={false}
                />
              </BlurView>
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

        {/* Stamp Suggestions (quick selectors) */}
        {!heroElement && stampSuggestions && stampSuggestions.length > 0 && (
          <View style={styles.suggestionsContainer}>
            {/* First row - 2 stamps */}
            <View style={styles.stampsRow}>
              {stampSuggestions.slice(0, 2).map((code) => (
                <View key={code} style={styles.stampWrapper}>
                  <StampCard code={code} onPress={() => handleStampPress(code)} />
                </View>
              ))}
            </View>
            {/* Second row - 2 stamps */}
            <View style={styles.stampsRow}>
              {stampSuggestions.slice(2, 4).map((code) => (
                <View key={code} style={styles.stampWrapper}>
                  <StampCard code={code} onPress={() => handleStampPress(code)} />
                </View>
              ))}
            </View>
            {/* Third row - centered single stamp */}
            {stampSuggestions.length > 4 && (
              <View style={styles.stampsRowCentered}>
                <View style={styles.stampWrapper}>
                  <StampCard
                    code={stampSuggestions[4]}
                    onPress={() => handleStampPress(stampSuggestions[4])}
                  />
                </View>
              </View>
            )}
          </View>
        )}

        {/* Spacer when no hero element AND no suggestions */}
        {!heroElement && (!stampSuggestions || stampSuggestions.length === 0) && (
          <View style={styles.spacer} />
        )}

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

        {/* Footer with Next button - only show when no stamp suggestions (stamps auto-navigate on selection) */}
        {!stampSuggestions && (
          <Animated.View style={[styles.footer, { opacity: refs.buttonOpacity }]}>
            <TouchableOpacity
              style={[styles.nextButton, !currentSelection && styles.nextButtonDisabled]}
              onPress={handleNext}
              disabled={!currentSelection}
            >
              <Text variant="label" style={styles.nextButtonText}>
                Continue
              </Text>
              <Ionicons name="arrow-forward" size={20} color={colors.midnightNavy} />
            </TouchableOpacity>
          </Animated.View>
        )}
      </View>

      {/* Selection Celebration Overlay - Using Modal for guaranteed overlay above all content */}
      {showSelection && selectedCountryData && (
        <Modal visible={true} transparent={true} animationType="none" statusBarTranslucent={true}>
          <CelebrationOverlay
            visible={true}
            countryCode={selectedCountryData.code}
            countryName={selectedCountryData.name}
            type={celebrationType}
            animationRefs={refs}
            onSkip={handleNavigateNext}
          />
        </Modal>
      )}
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
  subtitle: {
    color: colors.midnightNavy,
    opacity: 0.7,
    marginTop: 8,
  },
  searchContainer: {
    position: 'relative',
    zIndex: 1, // Reduced from 10 to avoid overlapping animations
  },
  searchGlassWrapper: {
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 12,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  searchGlassContainer: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: 48,
    borderRadius: 20,
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
    maxHeight: 320,
  },
  dropdownBlur: {
    flex: 1,
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
    borderBottomColor: 'rgba(23, 42, 58, 0.1)',
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
  suggestionsContainer: {
    flex: 1,
    marginTop: 16,
  },
  stampsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  stampsRowCentered: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  stampWrapper: {
    width: '48%',
    aspectRatio: 1,
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
    borderRadius: 9999,
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
