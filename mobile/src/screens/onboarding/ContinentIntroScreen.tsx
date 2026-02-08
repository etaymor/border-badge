import * as Haptics from 'expo-haptics';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef } from 'react';
import { Animated, Image, Keyboard, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassBackButton, Text } from '@components/ui';
import { useReducedMotion } from '@hooks/useReducedMotion';
import { useResponsive } from '@hooks/useResponsive';
import { useScreenEntrance } from '@hooks/useScreenEntrance';

/* eslint-disable @typescript-eslint/no-require-imports */
const atlasLogo = require('../../../assets/atlasi-logo.png');
/* eslint-enable @typescript-eslint/no-require-imports */
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { REGIONS } from '@constants/regions';
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
  const { addVisitedContinent } = useOnboardingStore();
  const { isSmallScreen, isLargeScreen } = useResponsive();
  const reduceMotion = useReducedMotion();

  const canGoBack = navigation.canGoBack();
  const continentVideo = getContinentVideo(region);
  const playerSource = continentVideo ?? DEFAULT_CONTINENT_VIDEO;
  const hasVideoSource = Boolean(playerSource);
  const backgroundColor = CONTINENT_BACKGROUNDS[region] || DEFAULT_BACKGROUND;

  // Premium entrance animation with reset capability
  const { getAnimatedStyle, getButtonStyle, resetAnimation, startAnimation } = useScreenEntrance({
    elementCount: 3,
    autoStart: false,
  });

  // Video scale animation (content-specific, keeps the premium video zoom-in)
  const videoScale = useRef(new Animated.Value(reduceMotion ? 1 : 0.95)).current;

  const player = useVideoPlayer(playerSource, (playerInstance) => {
    playerInstance.loop = true;
    playerInstance.muted = true;
    playerInstance.audioMixingMode = 'mixWithOthers';
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

  // Pause video on blur and resume on focus (also dismiss keyboard on focus)
  useEffect(() => {
    const unsubscribeFocus = navigation.addListener('focus', () => {
      Keyboard.dismiss();
      if (hasVideoSource) {
        try {
          player.play();
        } catch {
          // Native player may be released
        }
      }
    });
    const unsubscribeBlur = navigation.addListener('blur', () => {
      try {
        player.pause();
      } catch {
        // Native player may be released
      }
    });
    return () => {
      unsubscribeFocus();
      unsubscribeBlur();
    };
  }, [navigation, player, hasVideoSource]);

  // Reset and restart animations when region changes
  useEffect(() => {
    if (reduceMotion) {
      videoScale.setValue(1);
      return;
    }

    // Reset video scale
    videoScale.setValue(0.95);

    // Reset and start screen entrance
    resetAnimation();
    startAnimation();

    // Animate video scale
    Animated.spring(videoScale, {
      toValue: 1,
      friction: 8,
      tension: 80,
      useNativeDriver: true,
    }).start();
  }, [region, resetAnimation, startAnimation, videoScale, reduceMotion]);

  const handleYes = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    addVisitedContinent(region);
    navigation.replace('ContinentCountryGrid', { region });
  };

  const handleNo = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Move to next continent or Antarctica prompt
    const nextIndex = regionIndex + 1;
    if (nextIndex < REGIONS.length) {
      // Replace instead of push to avoid stacking multiple ContinentIntro instances
      // (each instance keeps its video player in memory)
      navigation.replace('ContinentIntro', {
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
        <Animated.View style={[styles.header, getAnimatedStyle(0)]}>
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
          <Text variant="title" style={[styles.title, isLargeScreen && styles.titleLarge]}>
            Visited {region}?
          </Text>
        </Animated.View>

        {/* Video container with overlaid buttons */}
        <Animated.View
          style={[
            styles.videoContainer,
            isSmallScreen && styles.videoContainerSmall,
            isLargeScreen && styles.videoContainerLarge,
            getAnimatedStyle(1),
            { transform: [{ scale: videoScale }] },
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
    marginTop: 0,
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
