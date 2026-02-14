import { useEffect } from 'react';
import {
  Animated,
  Image,
  Keyboard,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { requestTrackingPermissionsAsync } from 'expo-tracking-transparency';
import { Settings } from 'react-native-fbsdk-next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OnboardingHookHeader } from '@components/onboarding/OnboardingHookHeader';
import { Text } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useScreenEntrance } from '@hooks/useScreenEntrance';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { Analytics } from '@services/analytics';
import { useAuthStore } from '@stores/authStore';

/* eslint-disable @typescript-eslint/no-require-imports */
const collageImage = require('../../../assets/onboarding-videos/photo-trip-collage.jpg');
/* eslint-enable @typescript-eslint/no-require-imports */

type Props = OnboardingStackScreenProps<'EmotionalHook'>;

export function EmotionalHookScreen({ navigation }: Props) {
  const { getAnimatedStyle, getButtonStyle } = useScreenEntrance({ elementCount: 4 });
  const session = useAuthStore((s) => s.session);

  useEffect(() => {
    Keyboard.dismiss();
    Analytics.viewOnboardingEmotionalHook();
  }, []);

  // Request App Tracking Transparency permission (iOS only).
  // Shown after account creation, before the paywall.
  useEffect(() => {
    if (Platform.OS !== 'ios' || !session) return;
    const requestTracking = async () => {
      const { status } = await requestTrackingPermissionsAsync();
      Settings.setAdvertiserTrackingEnabled(status === 'granted');
    };
    requestTracking();
  }, [session]);

  const handleContinue = () => {
    navigation.navigate('FunctionalHook');
  };

  const handleLogin = () => {
    Analytics.skipToLogin('EmotionalHook');
    navigation.navigate('Auth', { screen: 'Login' });
  };

  return (
    <SafeAreaView style={styles.container}>
      <OnboardingHookHeader onLogin={session ? undefined : handleLogin} />

      {/* Image behind text and button - uncropped, visible in lower portion */}
      <Animated.View style={[styles.imageContainer, getAnimatedStyle(2)]}>
        <Image source={collageImage} style={styles.image} resizeMode="contain" />
      </Animated.View>

      {/* Content layer on top of image */}
      <View style={styles.overlay}>
        <View style={styles.textSection}>
          <Animated.View style={getAnimatedStyle(0)}>
            <Text variant="title" style={styles.title}>
              Remember everywhere you&apos;ve been
            </Text>
          </Animated.View>

          <Animated.View style={getAnimatedStyle(1)}>
            <Text variant="body" style={styles.subtext}>
              Trips fade. Photos get buried. Atlasi keeps your adventures alive, beautifully
              organized, always ready to share.
            </Text>
          </Animated.View>
        </View>

        <View style={styles.footer}>
          <Animated.View style={[{ width: '100%' }, getButtonStyle(3)]}>
            <TouchableOpacity
              style={styles.continueButton}
              onPress={handleContinue}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel="Continue"
              accessibilityHint="Proceed to learn about saving places"
              testID="emotional-hook-continue"
            >
              <Text style={styles.continueButtonText}>Continue</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  imageContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '77%',
  },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  textSection: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  title: {
    marginBottom: 12,
  },
  subtext: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    lineHeight: 24,
    color: colors.stormGray,
  },
  footer: {
    paddingHorizontal: 24,
    paddingVertical: 24,
    alignItems: 'center',
  },
  continueButton: {
    backgroundColor: colors.sunsetGold,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  continueButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
  },
});
