/* eslint-disable @typescript-eslint/no-require-imports */
import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import {
  Animated,
  Image,
  ImageSourcePropType,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassBackButton } from '@components/ui';
import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';
import { ALL_REGIONS } from '@constants/regions';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { useOnboardingStore } from '@stores/onboardingStore';

const antarcticaImage: ImageSourcePropType = require('../../../assets/country-images/continents/Antarctica.png');

type Props = OnboardingStackScreenProps<'AntarcticaPrompt'>;

const ANTARCTICA_CODE = 'AQ';

// Antarctica background - pixel sampled from illustration
const ANTARCTICA_BACKGROUND = '#FDFBF1';

export function AntarcticaPromptScreen({ navigation }: Props) {
  const { addVisitedContinent, toggleCountry, visitedContinents } = useOnboardingStore();

  // Animation values
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const titleTranslate = useRef(new Animated.Value(-20)).current;
  const imageScale = useRef(new Animated.Value(0.95)).current;
  const buttonsTranslate = useRef(new Animated.Value(30)).current;
  const dotsOpacity = useRef(new Animated.Value(0)).current;

  // Staggered entrance animations
  useEffect(() => {
    Animated.sequence([
      // Everything fades in together
      Animated.parallel([
        Animated.timing(contentOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.spring(imageScale, {
          toValue: 1,
          friction: 8,
          tension: 80,
          useNativeDriver: true,
        }),
        Animated.spring(titleTranslate, {
          toValue: 0,
          friction: 8,
          tension: 60,
          useNativeDriver: true,
        }),
      ]),
      // Buttons slide up
      Animated.spring(buttonsTranslate, {
        toValue: 0,
        friction: 7,
        tension: 60,
        useNativeDriver: true,
      }),
      // Progress dots pop in
      Animated.timing(dotsOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [contentOpacity, titleTranslate, imageScale, buttonsTranslate, dotsOpacity]);

  const handleYes = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Add Antarctica as visited continent and select the country
    addVisitedContinent('Antarctica');
    toggleCountry(ANTARCTICA_CODE);
    navigation.navigate('ProgressSummary');
  };

  const handleNo = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Just proceed without selecting Antarctica
    navigation.navigate('ProgressSummary');
  };

  const handleLogin = () => {
    navigation.navigate('Auth', { screen: 'PhoneAuth' });
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {/* Header with title */}
        <Animated.View
          style={[
            styles.header,
            {
              opacity: contentOpacity,
              transform: [{ translateY: titleTranslate }],
            },
          ]}
        >
          <View style={styles.navBar}>
            <GlassBackButton onPress={() => navigation.goBack()} />
            <TouchableOpacity onPress={handleLogin} style={styles.loginButton}>
              <Text style={styles.loginText}>Login</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.title}>Been to Antarctica?</Text>
        </Animated.View>

        {/* Image container with overlaid buttons */}
        <Animated.View
          style={[
            styles.imageContainer,
            {
              opacity: contentOpacity,
              transform: [{ scale: imageScale }],
            },
          ]}
        >
          <Image source={antarcticaImage} style={styles.image} resizeMode="contain" />

          {/* Buttons overlaid on image */}
          <Animated.View
            style={[
              styles.buttonContainer,
              {
                opacity: contentOpacity,
                transform: [{ translateY: buttonsTranslate }],
              },
            ]}
          >
            <TouchableOpacity style={styles.yesButton} onPress={handleYes} activeOpacity={0.9}>
              <Text style={styles.yesButtonText}>Yes</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.noButton} onPress={handleNo} activeOpacity={0.9}>
              <Text style={styles.noButtonText}>No</Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>

        {/* Progress indicator at bottom */}
        <Animated.View style={[styles.progressContainer, { opacity: dotsOpacity }]}>
          {ALL_REGIONS.map((region, index) => (
            <View
              key={region}
              style={[
                styles.progressDot,
                // Previous regions are completed if visited
                index < 5 && visitedContinents.includes(region) && styles.progressDotCompleted,
                // Antarctica (index 5) is always active on this screen
                index === 5 && styles.progressDotActive,
              ]}
            />
          ))}
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ANTARCTICA_BACKGROUND,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
  },
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  loginButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  loginText: {
    fontSize: 16,
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
  },
  title: {
    fontSize: 32,
    fontFamily: fonts.playfair.bold,
    color: colors.midnightNavy,
    textAlign: 'center',
  },
  imageContainer: {
    flex: 1,
    position: 'relative',
    marginTop: -60,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  buttonContainer: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 24,
  },
  yesButton: {
    flex: 1,
    backgroundColor: colors.sunsetGold,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  yesButtonText: {
    fontSize: 18,
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
  },
  noButton: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  noButtonText: {
    fontSize: 18,
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
  },
  progressContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingBottom: 16,
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
