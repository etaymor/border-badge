import { useEffect } from 'react';
import { Animated, Image, StyleSheet, TouchableOpacity, View } from 'react-native';
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
const socialImage = require('../../../assets/onboarding-videos/social-exported-list.jpg');
/* eslint-enable @typescript-eslint/no-require-imports */

type Props = OnboardingStackScreenProps<'FunctionalHook'>;

export function FunctionalHookScreen({ navigation }: Props) {
  const { getAnimatedStyle, getButtonStyle } = useScreenEntrance({ elementCount: 4 });
  const session = useAuthStore((s) => s.session);

  useEffect(() => {
    Analytics.viewOnboardingFunctionalHook();
  }, []);

  const handleContinue = () => {
    navigation.navigate('Paywall');
  };

  const handleLogin = () => {
    Analytics.skipToLogin('FunctionalHook');
    navigation.navigate('Auth', { screen: 'Login' });
  };

  return (
    <SafeAreaView style={styles.container}>
      <OnboardingHookHeader
        onBack={() => navigation.goBack()}
        onLogin={session ? undefined : handleLogin}
      />

      <View style={styles.content}>
        {/* Title */}
        <Animated.View style={[styles.textSection, getAnimatedStyle(0)]}>
          <Text variant="title" style={styles.title}>
            Never lose a place again.
          </Text>
        </Animated.View>

        {/* Subtext */}
        <Animated.View style={[styles.textSection, getAnimatedStyle(1)]}>
          <Text variant="body" style={styles.subtext}>
            Found a hidden beach on TikTok? A rooftop bar on Instagram? Share the link and
            we&apos;ll save it: location, details, everything.
          </Text>
        </Animated.View>

        {/* Edge-to-edge image */}
        <Animated.View style={[styles.imageContainer, getAnimatedStyle(2)]}>
          <Image source={socialImage} style={styles.image} resizeMode="cover" />
        </Animated.View>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Animated.View style={[{ width: '100%' }, getButtonStyle(3)]}>
          <TouchableOpacity
            style={styles.continueButton}
            onPress={handleContinue}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel="Start saving places"
            accessibilityHint="Proceed to create your account"
            testID="functional-hook-continue"
          >
            <Text style={styles.continueButtonText}>Start saving places</Text>
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
  content: {
    flex: 1,
    paddingTop: 16,
  },
  textSection: {
    paddingHorizontal: 24,
  },
  title: {
    marginBottom: 12,
  },
  subtext: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    lineHeight: 24,
    color: colors.stormGray,
    marginBottom: 24,
  },
  imageContainer: {
    flex: 1,
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
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
