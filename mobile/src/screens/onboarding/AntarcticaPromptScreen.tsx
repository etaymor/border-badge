/* eslint-disable @typescript-eslint/no-require-imports */
import * as Haptics from 'expo-haptics';
import { Image as ExpoImage } from 'expo-image';
import { useEffect, useRef } from 'react';
import { Animated, ImageSourcePropType, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OnboardingHeaderSpacer } from '@components/onboarding/OnboardingHeader';
import { Text } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useReducedMotion } from '@hooks/useReducedMotion';
import { useResponsive } from '@hooks/useResponsive';
import { useScreenEntrance } from '@hooks/useScreenEntrance';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { Analytics } from '@services/analytics';
import { useOnboardingStore } from '@stores/onboardingStore';

const antarcticaImage: ImageSourcePropType = require('../../../assets/country-images/continents/Antarctica.png');

type Props = OnboardingStackScreenProps<'AntarcticaPrompt'>;

const ANTARCTICA_CODE = 'AQ';

// Antarctica background - pixel sampled from illustration
const ANTARCTICA_BACKGROUND = '#FDFBF1';

export function AntarcticaPromptScreen({ navigation }: Props) {
  const addVisitedContinent = useOnboardingStore((s) => s.addVisitedContinent);
  const toggleCountry = useOnboardingStore((s) => s.toggleCountry);
  const { isSmallScreen, isLargeScreen } = useResponsive();
  const reduceMotion = useReducedMotion();

  // Premium entrance animation
  const { getAnimatedStyle, getButtonStyle } = useScreenEntrance({ elementCount: 3 });

  // Image scale animation (content-specific, keeps the premium zoom-in)
  const imageScale = useRef(new Animated.Value(reduceMotion ? 1 : 0.95)).current;

  // Track screen view
  useEffect(() => {
    Analytics.viewOnboardingAntarctica();
  }, []);

  // Image scale animation
  useEffect(() => {
    if (reduceMotion) {
      imageScale.setValue(1);
      return;
    }

    Animated.spring(imageScale, {
      toValue: 1,
      friction: 8,
      tension: 80,
      useNativeDriver: true,
    }).start();
  }, [imageScale, reduceMotion]);

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

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {/* Space for the shared onboarding header (rendered by the stack) */}
        <OnboardingHeaderSpacer />

        {/* Title */}
        <Animated.View style={[styles.header, getAnimatedStyle(0)]}>
          <Text variant="title" style={[styles.title, isLargeScreen && styles.titleLarge]}>
            Been to Antarctica?
          </Text>
        </Animated.View>

        {/* Image container with overlaid buttons */}
        <Animated.View
          style={[
            styles.imageContainer,
            isSmallScreen && styles.imageContainerSmall,
            isLargeScreen && styles.imageContainerLarge,
            getAnimatedStyle(1),
            { transform: [{ scale: imageScale }] },
          ]}
        >
          <ExpoImage
            testID="antarctica-image"
            source={antarcticaImage}
            style={styles.image}
            contentFit="contain"
          />

          {/* Buttons overlaid on image */}
          <Animated.View style={[styles.buttonContainer, getButtonStyle(2)]}>
            <TouchableOpacity style={styles.yesButton} onPress={handleYes} activeOpacity={0.9}>
              <Text style={styles.yesButtonText}>Yes</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.noButton} onPress={handleNo} activeOpacity={0.9}>
              <Text style={styles.noButtonText}>No</Text>
            </TouchableOpacity>
          </Animated.View>
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
  title: {
    color: colors.midnightNavy,
    textAlign: 'center',
    marginTop: 12,
  },
  titleLarge: {
    fontSize: 36,
    lineHeight: 44,
    marginTop: 24,
  },
  imageContainer: {
    flex: 1,
    position: 'relative',
    marginTop: -60,
  },
  imageContainerSmall: {
    marginTop: -30,
  },
  imageContainerLarge: {
    marginTop: 0,
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
    borderRadius: 9999,
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
    borderRadius: 9999,
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
});
