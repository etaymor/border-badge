/**
 * FirstQuizOfferScreen - post-paywall "make your first quiz" offer.
 *
 * The final post-signup step for every new user, shown after the paywall
 * resolves (purchase, cancel, or error alike). Skippable by design:
 *
 * - Accept arms the one-shot pendingFirstQuizLaunch flag, then finishes
 *   onboarding; useFirstQuizLaunch (inside Main) opens QuizCreation on top
 *   of home.
 * - Skip finishes onboarding straight to home, exactly as the paywall did
 *   before this screen existed.
 *
 * Both paths run the same finish (useFinishOnboarding), so the settled
 * onboarding order -- account creation BEFORE the paywall, guarded by
 * needsPostSignupFlow -- is untouched; this screen only appends to the tail.
 */

import { useEffect, useState } from 'react';
import { Animated, Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useFinishOnboarding } from '@hooks/useFinishOnboarding';
import { useScreenEntrance } from '@hooks/useScreenEntrance';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { Analytics } from '@services/analytics';
import { useAuthStore } from '@stores/authStore';

/* eslint-disable @typescript-eslint/no-require-imports */
const polaroidsIllustration = require('../../../assets/illustations/polaroids-illustration.png');
/* eslint-enable @typescript-eslint/no-require-imports */

type Props = OnboardingStackScreenProps<'FirstQuizOffer'>;

export function FirstQuizOfferScreen(_props: Props) {
  const { getAnimatedStyle, getButtonStyle } = useScreenEntrance({ elementCount: 5 });
  const finishOnboarding = useFinishOnboarding();
  const setPendingFirstQuizLaunch = useAuthStore((s) => s.setPendingFirstQuizLaunch);
  const [isFinishing, setIsFinishing] = useState(false);

  useEffect(() => {
    Analytics.firstQuizOfferShown();
  }, []);

  const handleAccept = async () => {
    if (isFinishing) return;
    setIsFinishing(true);
    Analytics.firstQuizOfferAccepted();
    // Armed BEFORE the finish flips the navigator: the flag must already be
    // set when Main mounts and useFirstQuizLaunch runs.
    setPendingFirstQuizLaunch(true);
    await finishOnboarding();
  };

  const handleSkip = async () => {
    if (isFinishing) return;
    setIsFinishing(true);
    Analytics.firstQuizOfferSkipped();
    await finishOnboarding();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Animated.View style={[styles.illustrationSection, getAnimatedStyle(0)]}>
          <Image source={polaroidsIllustration} style={styles.illustration} />
        </Animated.View>

        <Animated.View style={[styles.textSection, getAnimatedStyle(1)]}>
          <Text variant="title" style={styles.title}>
            Can your friends guess where you have been?
          </Text>
        </Animated.View>

        <Animated.View style={[styles.textSection, getAnimatedStyle(2)]}>
          <Text variant="body" style={styles.subtext}>
            Guess Where deals your travel photos out as a challenge - friends guess the country, you
            hold the score to beat. It takes about a minute, and you play it first.
          </Text>
        </Animated.View>
      </View>

      <View style={styles.footer}>
        <Animated.View style={[styles.footerItem, getButtonStyle(3)]}>
          <TouchableOpacity
            style={styles.acceptButton}
            onPress={handleAccept}
            activeOpacity={0.9}
            disabled={isFinishing}
            accessibilityRole="button"
            accessibilityLabel="Make my first challenge"
            accessibilityHint="Build a Guess Where challenge from your camera roll"
            testID="first-quiz-offer-accept"
          >
            <Text style={styles.acceptButtonText}>Make my first challenge</Text>
          </TouchableOpacity>
        </Animated.View>
        <Animated.View style={[styles.footerItem, getButtonStyle(4)]}>
          <TouchableOpacity
            style={styles.skipButton}
            onPress={handleSkip}
            activeOpacity={0.7}
            disabled={isFinishing}
            accessibilityRole="button"
            accessibilityLabel="Maybe later"
            accessibilityHint="Skip for now and go to your passport"
            testID="first-quiz-offer-skip"
          >
            <Text style={styles.skipButtonText}>Maybe later</Text>
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
    justifyContent: 'center',
  },
  illustrationSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  illustration: {
    width: 150,
    height: 150,
    resizeMode: 'contain',
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
  footer: {
    paddingHorizontal: 24,
    paddingVertical: 24,
    alignItems: 'center',
  },
  footerItem: {
    width: '100%',
  },
  acceptButton: {
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
  acceptButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  skipButton: {
    paddingVertical: 16,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  skipButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.stormGray,
  },
});
