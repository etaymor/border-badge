import * as Haptics from 'expo-haptics';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassBackButton, Text } from '@components/ui';
import { useResponsive } from '@hooks/useResponsive';

/* eslint-disable @typescript-eslint/no-require-imports */
const atlasLogo = require('../../../assets/atlasi-logo.png');
/* eslint-enable @typescript-eslint/no-require-imports */
import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';
import { ALL_REGIONS, REGIONS } from '@constants/regions';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { Analytics } from '@services/analytics';
import { useOnboardingStore } from '@stores/onboardingStore';
import { DEFAULT_CONTINENT_VIDEO, getContinentVideo } from '../../assets/continentVideos';

type Props = OnboardingStackScreenProps<'ContinentIntro'>;

// Background colors extracted from each continent's video/illustration (pixel sampled)
const CONTINENT_BACKGROUNDS: Record<string, string> = {
  Africa: '#FCF7EC',
  Americas: '#FBF7E6',
  Asia: '#F6F0E0',
  Europe: '#FCF9E9',
  Oceania: '#FBFCF5',
};

const DEFAULT_BACKGROUND = colors.warmCream;

export function ContinentIntroScreen({ navigation, route }: Props) {
  const { region, regionIndex } = route.params;
  const { addVisitedContinent, visitedContinents } = useOnboardingStore();
  const { isSmallScreen } = useResponsive();

  const canGoBack = navigation.canGoBack();
  const continentVideo = getContinentVideo(region);
  const playerSource = continentVideo ?? DEFAULT_CONTINENT_VIDEO;
  const hasVideoSource = Boolean(playerSource);
  const backgroundColor = CONTINENT_BACKGROUNDS[region] || DEFAULT_BACKGROUND;

  // Animation values
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const titleTranslate = useRef(new Animated.Value(-20)).current;
  const videoScale = useRef(new Animated.Value(0.95)).current;
  const buttonsTranslate = useRef(new Animated.Value(30)).current;
  const dotsOpacity = useRef(new Animated.Value(0)).current;

  const player = useVideoPlayer(playerSource, (playerInstance) => {
    playerInstance.loop = true;
    playerInstance.muted = true;
  });

  useEffect(() => {
    if (hasVideoSource) {
      player.play();
    } else {
      player.pause();
    }
  }, [hasVideoSource, player]);

  // Track screen view (fires when region changes)
  useEffect(() => {
    Analytics.viewOnboardingContinent(region);
  }, [region]);

  // Staggered entrance animations
  useEffect(() => {
    // Reset animations when region changes
    contentOpacity.setValue(0);
    titleTranslate.setValue(-20);
    videoScale.setValue(0.95);
    buttonsTranslate.setValue(30);
    dotsOpacity.setValue(0);

    Animated.sequence([
      // Everything fades in together
      Animated.parallel([
        Animated.timing(contentOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.spring(videoScale, {
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
  }, [region, contentOpacity, titleTranslate, videoScale, buttonsTranslate, dotsOpacity]);

  const handleYes = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    addVisitedContinent(region);
    navigation.navigate('ContinentCountryGrid', { region });
  };

  const handleNo = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Move to next continent or Antarctica prompt
    const nextIndex = regionIndex + 1;
    if (nextIndex < REGIONS.length) {
      // Use push instead of navigate to add to stack history for back navigation
      navigation.push('ContinentIntro', {
        region: REGIONS[nextIndex],
        regionIndex: nextIndex,
      });
    } else {
      // After Oceania, show Antarctica prompt
      navigation.navigate('AntarcticaPrompt');
    }
  };

  const handleLogin = () => {
    Analytics.skipToLogin(`ContinentIntro_${region}`);
    navigation.navigate('Auth', { screen: 'Login' });
  };

  return (
    <View style={[styles.container, { backgroundColor }]}>
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
            <View style={styles.backButtonContainer}>
              {canGoBack ? (
                <GlassBackButton onPress={() => navigation.goBack()} />
              ) : (
                <View style={styles.backButtonPlaceholder} />
              )}
            </View>
            <Image source={atlasLogo} style={styles.logo} resizeMode="contain" />
            <TouchableOpacity onPress={handleLogin} style={styles.loginButton}>
              <Text style={styles.loginText}>Login</Text>
            </TouchableOpacity>
          </View>
          <Text variant="title" style={[styles.title, !isSmallScreen && styles.titleLarge]}>
            Visited {region}?
          </Text>
        </Animated.View>

        {/* Video container with overlaid buttons */}
        <Animated.View
          style={[
            styles.videoContainer,
            isSmallScreen && styles.videoContainerSmall,
            !isSmallScreen && styles.videoContainerLarge,
            {
              opacity: contentOpacity,
              transform: [{ scale: videoScale }],
            },
          ]}
        >
          {hasVideoSource ? (
            <VideoView
              player={player}
              style={styles.video}
              contentFit="contain"
              nativeControls={false}
            />
          ) : (
            <View style={[styles.illustrationPlaceholder, { backgroundColor }]} />
          )}

          {/* Buttons overlaid on video */}
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
          {ALL_REGIONS.map((r, index) => (
            <View
              key={index}
              style={[
                styles.progressDot,
                visitedContinents.includes(r) && styles.progressDotCompleted,
                index === regionIndex && styles.progressDotActive,
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
  },
  safeArea: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
  },
  navBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  backButtonContainer: {
    position: 'absolute',
    left: 0,
  },
  backButtonPlaceholder: {
    width: 44,
    height: 44,
  },
  logo: {
    width: 140,
    height: 40,
  },
  loginButton: {
    position: 'absolute',
    right: 0,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  loginText: {
    fontSize: 16,
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
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
  videoContainer: {
    flex: 1,
    position: 'relative',
    marginTop: -60,
  },
  videoContainerSmall: {
    marginTop: -30,
  },
  videoContainerLarge: {
    marginTop: -40,
  },
  video: {
    width: '100%',
    height: '100%',
  },
  illustrationPlaceholder: {
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
