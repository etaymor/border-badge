import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { Text } from '@components/ui';
import { colors } from '@constants/colors';
import type { OnboardingStackScreenProps } from '@navigation/types';

/* eslint-disable @typescript-eslint/no-require-imports */
const welcomeVideo = require('../../../assets/country-images/wonders-world/Atlantis.mp4');

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
    navigation.navigate('Auth', { screen: 'PhoneAuth' });
  };

  return (
    <View style={styles.container}>
      {/* Full-screen video background */}
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
      />

      {/* Login button - top right */}
      <TouchableOpacity
        onPress={handleLogin}
        style={styles.loginButton}
        testID="carousel-login-button"
      >
        <Text variant="label" style={styles.loginText}>
          Login
        </Text>
      </TouchableOpacity>

      {/* Text overlay - upper area */}
      <View style={styles.textOverlay}>
        <Text variant="title" style={styles.title}>
          Welcome Explorer
        </Text>
        <Text variant="body" style={styles.body}>
          Your journey around the world starts here.
        </Text>
      </View>

      {/* Next button - bottom third */}
      <View style={styles.bottomContainer}>
        <TouchableOpacity
          style={styles.nextButton}
          onPress={handleNext}
          testID="start-journey-button"
        >
          <Text variant="label" style={styles.nextButtonText}>
            Next
          </Text>
          <Ionicons name="arrow-forward" size={24} color={colors.midnightNavy} />
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
  textOverlay: {
    position: 'absolute',
    top: 140,
    left: 24,
    right: 24,
    alignItems: 'center',
  },
  title: {
    fontSize: 36,
    color: colors.midnightNavy,
    textAlign: 'center',
    marginBottom: 16,
  },
  body: {
    fontSize: 20,
    color: colors.midnightNavy,
    textAlign: 'center',
    maxWidth: '80%',
  },
  bottomContainer: {
    position: 'absolute',
    bottom: 100,
    left: 24,
    right: 24,
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
