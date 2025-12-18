import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@components/ui';
import { colors } from '@constants/colors';
import type { OnboardingStackScreenProps } from '@navigation/types';

/* eslint-disable @typescript-eslint/no-require-imports */
const welcomeVideo = require('../../../assets/country-images/wonders-world/Atlantis.mp4');
const atlasLogo = require('../../../assets/atlasi-logo.png');

type Props = OnboardingStackScreenProps<'WelcomeCarousel'>;

export function WelcomeCarouselScreen({ navigation }: Props) {
  const player = useVideoPlayer(welcomeVideo, (player) => {
    player.loop = true;
    player.muted = true;
    player.play();
  });

  const handleNext = () => {
    navigation.navigate('OnboardingSlider');
  };

  const handleLogin = () => {
    navigation.navigate('Auth', { screen: 'Auth' });
  };

  return (
    <View style={styles.container}>
      {/* Full-screen video background - decorative, muted autoplay */}
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
        accessible={true}
        accessibilityLabel="Decorative video showing world travel destinations"
      />

      {/* Header with logo and login - same as slider screen */}
      <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
        <View style={styles.header}>
          <Image source={atlasLogo} style={styles.logo} resizeMode="contain" />
          <TouchableOpacity
            onPress={handleLogin}
            style={styles.loginButton}
            testID="carousel-login-button"
            accessibilityRole="button"
            accessibilityLabel="Login to your account"
          >
            <Text variant="label" style={styles.loginText}>
              Login
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Text overlay - below header */}
      <View style={styles.textOverlay}>
        <Text variant="title" style={styles.title}>
          The world is waiting
        </Text>
        <Text variant="body" style={styles.body}>
          Track where you&apos;ve been. Dream about where you&apos;re going.
        </Text>
      </View>

      {/* Next button - footer */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.nextButton}
          onPress={handleNext}
          testID="start-journey-button"
          accessibilityRole="button"
          accessibilityLabel="Next, continue to onboarding"
        >
          <Text variant="label" style={styles.nextButtonText}>
            Next
          </Text>
          <Ionicons name="arrow-forward" size={20} color={colors.midnightNavy} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  headerSafeArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  header: {
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
  textOverlay: {
    position: 'absolute',
    top: 140,
    left: 24,
    right: 24,
    alignItems: 'center',
  },
  title: {
    fontSize: 36,
    lineHeight: 44,
    color: colors.midnightNavy,
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    fontSize: 18,
    color: colors.midnightNavy,
    textAlign: 'center',
    maxWidth: '95%',
    lineHeight: 26,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingVertical: 24,
    paddingBottom: 40,
    alignItems: 'center',
  },
  nextButton: {
    backgroundColor: colors.sunsetGold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
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
