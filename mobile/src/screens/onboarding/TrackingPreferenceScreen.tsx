import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { memo, useCallback, useEffect, useRef } from 'react';
import {
  Animated,
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassBackButton, Text } from '@components/ui';
import { useReducedMotion } from '@hooks/useReducedMotion';
import { useResponsive } from '@hooks/useResponsive';
import { useScreenEntrance } from '@hooks/useScreenEntrance';
import atlasLogo from '../../../assets/atlasi-logo.png';
import { colors } from '@constants/colors';
import {
  TRACKING_PRESET_ORDER,
  TRACKING_PRESETS,
  type TrackingPreset,
} from '@constants/trackingPreferences';
import { fonts } from '@constants/typography';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { Analytics } from '@services/analytics';
import { useOnboardingStore } from '@stores/onboardingStore';

type Props = OnboardingStackScreenProps<'TrackingPreference'>;

interface PresetCardProps {
  preset: TrackingPreset;
  isSelected: boolean;
  onSelect: () => void;
  hideDescription?: boolean;
}

const PresetCard = memo(function PresetCard({
  preset,
  isSelected,
  onSelect,
  hideDescription,
}: PresetCardProps) {
  const presetData = TRACKING_PRESETS[preset];
  const reduceMotion = useReducedMotion();
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (reduceMotion) {
      onSelect();
      return;
    }
    // Scale animation on selection
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 0.98,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 4,
        useNativeDriver: true,
      }),
    ]).start();
    onSelect();
  }, [onSelect, scaleAnim, reduceMotion]);

  return (
    <Animated.View style={[styles.cardAnimationWrapper, { transform: [{ scale: scaleAnim }] }]}>
      <Pressable
        style={[styles.presetCard, isSelected && styles.presetCardSelected]}
        onPress={handlePress}
        accessibilityRole="radio"
        accessibilityState={{ checked: isSelected }}
        accessibilityLabel={`${presetData.name}, ${presetData.count} countries`}
      >
        {/* Radio indicator */}
        <View style={[styles.radioOuter, isSelected && styles.radioOuterSelected]}>
          {isSelected && <View style={styles.radioInner} />}
        </View>

        {/* Card content */}
        <View style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <Text style={styles.presetName}>{presetData.name.toUpperCase()}</Text>
            <Text style={styles.presetCount}>{presetData.count} countries</Text>
          </View>
          {!hideDescription && (
            <Text style={styles.presetDescription}>{presetData.description}</Text>
          )}
          {preset !== 'classic' && (
            <Text style={styles.presetAdded}>{presetData.shortDescription}</Text>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
});

function TrackingPreferenceScreen({ navigation }: Props) {
  const { trackingPreference, setTrackingPreference } = useOnboardingStore();
  const { isSmallScreen } = useResponsive();

  // Premium entrance animation
  const { getAnimatedStyle, getButtonStyle } = useScreenEntrance({ elementCount: 4 });

  // Dismiss keyboard when screen receives focus (safety net from previous screen)
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      Keyboard.dismiss();
    });
    return unsubscribe;
  }, [navigation]);

  // Track screen view
  useEffect(() => {
    Analytics.viewOnboardingTracking();
  }, []);

  const handleBack = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.goBack();
  }, [navigation]);

  const handleNext = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate('DreamDestination');
  }, [navigation]);

  const handleLogin = useCallback(() => {
    Analytics.skipToLogin('TrackingPreference');
    navigation.navigate('Auth', { screen: 'Login' });
  }, [navigation]);

  const handleSelectPreset = useCallback(
    (preset: TrackingPreset) => {
      setTrackingPreference(preset);
    },
    [setTrackingPreference]
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header with back button, logo and login */}
      <View style={styles.headerRow}>
        <View style={styles.backButtonContainer}>
          <GlassBackButton onPress={handleBack} size="small" />
        </View>
        <Image source={atlasLogo} style={styles.logo} resizeMode="contain" />
        <TouchableOpacity onPress={handleLogin} style={styles.loginButton}>
          <Text variant="label" style={styles.loginText}>
            Login
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {/* Title - Text component handles responsive sizing */}
        <Animated.View style={[styles.header, getAnimatedStyle(0)]}>
          <Text variant="title" style={styles.title}>
            Choose your country list
          </Text>
        </Animated.View>

        {/* Subtitle */}
        <Animated.View style={getAnimatedStyle(1)}>
          <Text variant="body" style={styles.subtitle}>
            Pick how many destinations you want to track. You can always change this later.
          </Text>
        </Animated.View>

        {/* Preset Cards */}
        <Animated.View style={[styles.scrollWrapper, getAnimatedStyle(2)]}>
          <ScrollView
            style={styles.scrollContainer}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {TRACKING_PRESET_ORDER.map((preset) => (
              <PresetCard
                key={preset}
                preset={preset}
                isSelected={trackingPreference === preset}
                onSelect={() => handleSelectPreset(preset)}
                hideDescription={isSmallScreen}
              />
            ))}
          </ScrollView>
        </Animated.View>

        {/* Footer with Next button */}
        <Animated.View style={[styles.footer, getButtonStyle(3)]}>
          <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
            <Text variant="label" style={styles.nextButtonText}>
              Continue
            </Text>
            <Ionicons name="arrow-forward" size={20} color={colors.midnightNavy} />
          </TouchableOpacity>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  logo: {
    width: 140,
    height: 40,
  },
  backButtonContainer: {
    position: 'absolute',
    left: 20,
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
    marginBottom: 8,
  },
  title: {
    color: colors.midnightNavy,
  },
  subtitle: {
    color: colors.stormGray,
    marginBottom: 20,
  },
  scrollWrapper: {
    flex: 1,
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 16,
  },
  cardAnimationWrapper: {
    marginBottom: 12,
  },
  presetCard: {
    flexDirection: 'row',
    backgroundColor: colors.cloudWhite,
    borderRadius: 20,
    padding: 16,
    borderWidth: 2,
    borderColor: colors.paperBeige,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  presetCardSelected: {
    backgroundColor: 'rgba(244, 196, 48, 0.08)',
    borderColor: colors.sunsetGold,
  },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 9999,
    borderWidth: 2,
    borderColor: colors.stormGray,
    marginRight: 12,
    marginTop: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioOuterSelected: {
    borderColor: colors.sunsetGold,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.sunsetGold,
  },
  cardContent: {
    flex: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  presetName: {
    fontFamily: fonts.openSans.bold,
    fontSize: 14,
    color: colors.midnightNavy,
    letterSpacing: 0.5,
  },
  presetCount: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 13,
    color: colors.adobeBrick,
  },
  presetDescription: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.stormGray,
  },
  presetAdded: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 13,
    color: colors.mossGreen,
    marginTop: 4,
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
  nextButtonText: {
    fontSize: 16,
    color: colors.midnightNavy,
    fontWeight: '600',
  },
});

export default TrackingPreferenceScreen;
