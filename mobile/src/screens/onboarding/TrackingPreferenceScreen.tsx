import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { memo, useCallback, useEffect, useRef } from 'react';
import {
  Animated,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@components/ui';
import atlasLogo from '../../../assets/atlasi-logo.png';
import { colors } from '@constants/colors';
import {
  TRACKING_PRESET_ORDER,
  TRACKING_PRESETS,
  type TrackingPreset,
} from '@constants/trackingPreferences';
import { fonts } from '@constants/typography';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { useOnboardingStore } from '@stores/onboardingStore';

type Props = OnboardingStackScreenProps<'TrackingPreference'>;

// Animation timing constants
const ANIMATION_TIMING = {
  titleDuration: 400,
  subtitleDuration: 300,
  cardStagger: 100,
  cardDuration: 300,
  buttonDuration: 300,
} as const;

interface PresetCardProps {
  preset: TrackingPreset;
  isSelected: boolean;
  onSelect: () => void;
  animatedValue: Animated.Value;
}

const PresetCard = memo(function PresetCard({
  preset,
  isSelected,
  onSelect,
  animatedValue,
}: PresetCardProps) {
  const presetData = TRACKING_PRESETS[preset];
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
  }, [onSelect, scaleAnim]);

  return (
    <Animated.View
      style={[
        styles.cardAnimationWrapper,
        {
          opacity: animatedValue,
          transform: [
            { translateY: animatedValue.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) },
            { scale: scaleAnim },
          ],
        },
      ]}
    >
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
          <Text style={styles.presetDescription}>{presetData.description}</Text>
          {preset !== 'classic' && (
            <Text style={styles.presetAdded}>{presetData.shortDescription}</Text>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
});

export function TrackingPreferenceScreen({ navigation }: Props) {
  const { trackingPreference, setTrackingPreference } = useOnboardingStore();

  // Staggered fade-in animations
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleTranslate = useRef(new Animated.Value(20)).current;
  const subtitleOpacity = useRef(new Animated.Value(0)).current;
  const card1Opacity = useRef(new Animated.Value(0)).current;
  const card2Opacity = useRef(new Animated.Value(0)).current;
  const card3Opacity = useRef(new Animated.Value(0)).current;
  const card4Opacity = useRef(new Animated.Value(0)).current;
  const buttonOpacity = useRef(new Animated.Value(0)).current;

  const cardOpacities = [card1Opacity, card2Opacity, card3Opacity, card4Opacity];

  useEffect(() => {
    // Staggered entrance animations
    Animated.sequence([
      Animated.parallel([
        Animated.timing(titleOpacity, {
          toValue: 1,
          duration: ANIMATION_TIMING.titleDuration,
          useNativeDriver: true,
        }),
        Animated.timing(titleTranslate, {
          toValue: 0,
          duration: ANIMATION_TIMING.titleDuration,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(subtitleOpacity, {
        toValue: 1,
        duration: ANIMATION_TIMING.subtitleDuration,
        useNativeDriver: true,
      }),
      // Stagger cards
      Animated.stagger(ANIMATION_TIMING.cardStagger, [
        Animated.timing(card1Opacity, {
          toValue: 1,
          duration: ANIMATION_TIMING.cardDuration,
          useNativeDriver: true,
        }),
        Animated.timing(card2Opacity, {
          toValue: 1,
          duration: ANIMATION_TIMING.cardDuration,
          useNativeDriver: true,
        }),
        Animated.timing(card3Opacity, {
          toValue: 1,
          duration: ANIMATION_TIMING.cardDuration,
          useNativeDriver: true,
        }),
        Animated.timing(card4Opacity, {
          toValue: 1,
          duration: ANIMATION_TIMING.cardDuration,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(buttonOpacity, {
        toValue: 1,
        duration: ANIMATION_TIMING.buttonDuration,
        useNativeDriver: true,
      }),
    ]).start();
  }, [
    titleOpacity,
    titleTranslate,
    subtitleOpacity,
    card1Opacity,
    card2Opacity,
    card3Opacity,
    card4Opacity,
    buttonOpacity,
  ]);

  const handleNext = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate('DreamDestination');
  }, [navigation]);

  const handleLogin = useCallback(() => {
    navigation.navigate('Auth', { screen: 'Auth' });
  }, [navigation]);

  const handleSelectPreset = useCallback(
    (preset: TrackingPreset) => {
      setTrackingPreference(preset);
    },
    [setTrackingPreference]
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header with logo and login */}
      <View style={styles.headerRow}>
        <Image source={atlasLogo} style={styles.logo} resizeMode="contain" />
        <TouchableOpacity onPress={handleLogin} style={styles.loginButton}>
          <Text variant="label" style={styles.loginText}>
            Login
          </Text>
        </TouchableOpacity>
      </View>

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
            How do you want to track your travels?
          </Text>
        </Animated.View>

        {/* Subtitle */}
        <Animated.View style={{ opacity: subtitleOpacity }}>
          <Text style={styles.subtitle}>
            Choose what counts as a country in your passport. You can always change this later.
          </Text>
        </Animated.View>

        {/* Preset Cards */}
        <ScrollView
          style={styles.scrollContainer}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {TRACKING_PRESET_ORDER.map((preset, index) => (
            <PresetCard
              key={preset}
              preset={preset}
              isSelected={trackingPreference === preset}
              onSelect={() => handleSelectPreset(preset)}
              animatedValue={cardOpacities[index]}
            />
          ))}
        </ScrollView>

        {/* Footer with Next button */}
        <Animated.View style={[styles.footer, { opacity: buttonOpacity }]}>
          <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
            <Text variant="label" style={styles.nextButtonText}>
              Next
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
    marginBottom: 12,
  },
  title: {
    fontSize: 28,
    lineHeight: 36,
    color: colors.midnightNavy,
  },
  subtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    lineHeight: 24,
    color: colors.stormGray,
    marginBottom: 24,
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
    borderRadius: 16,
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
    borderRadius: 12,
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
    borderRadius: 12,
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
