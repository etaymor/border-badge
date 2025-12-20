import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PricingToggle, RotatingStampHero } from '@components/onboarding';
import type { PricingPlan } from '@components/onboarding/PricingToggle';
import { Text } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { useOnboardingStore } from '@stores/onboardingStore';

type Props = OnboardingStackScreenProps<'Paywall'>;

const PREMIUM_FEATURES = [
  'See where friends overlap',
  'Turn trips into shareable stories',
  'AI-powered smart itineraries',
  'Milestone videos & animated passport',
  'Deep trip journals with photos & notes',
  'Personalized destination recommendations',
];

export function PaywallScreen({ navigation }: Props) {
  const { selectedCountries, homeCountry } = useOnboardingStore();
  const [selectedPlan, setSelectedPlan] = useState<PricingPlan>('yearly');

  // Combine all stamps
  const allStampCodes = useMemo(() => {
    const stamps = new Set(selectedCountries);
    if (homeCountry) stamps.add(homeCountry);
    return Array.from(stamps);
  }, [selectedCountries, homeCountry]);

  // Animation refs
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleTranslate = useRef(new Animated.Value(20)).current;
  const subtitleOpacity = useRef(new Animated.Value(0)).current;
  const featuresOpacity = useRef(new Animated.Value(0)).current;
  const featuresTranslate = useRef(new Animated.Value(20)).current;
  const pricingOpacity = useRef(new Animated.Value(0)).current;
  const ctaScale = useRef(new Animated.Value(0.9)).current;
  const ctaOpacity = useRef(new Animated.Value(0)).current;
  const ctaGlow = useRef(new Animated.Value(0)).current;

  // Feature item animations
  const featureAnimations = useRef(PREMIUM_FEATURES.map(() => new Animated.Value(0))).current;

  // Run entrance animations
  useEffect(() => {
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    let glowLoop: Animated.CompositeAnimation | null = null;

    // Phase 1: Title (0-400ms)
    Animated.parallel([
      Animated.timing(titleOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.timing(titleTranslate, {
        toValue: 0,
        duration: 400,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    // Phase 1b: Subtitle (100ms after title)
    timeouts.push(
      setTimeout(() => {
        Animated.timing(subtitleOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();
      }, 100)
    );

    // Phase 3: Features (1200-1600ms)
    timeouts.push(
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(featuresOpacity, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(featuresTranslate, {
            toValue: 0,
            duration: 400,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]).start();

        // Stagger feature items
        featureAnimations.forEach((anim, index) => {
          timeouts.push(
            setTimeout(() => {
              Animated.timing(anim, {
                toValue: 1,
                duration: 300,
                useNativeDriver: true,
              }).start();
            }, index * 50)
          );
        });
      }, 1200)
    );

    // Phase 4: Pricing (1600-2000ms)
    timeouts.push(
      setTimeout(() => {
        Animated.timing(pricingOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }).start();
      }, 1600)
    );

    // Phase 4b: CTA button
    timeouts.push(
      setTimeout(() => {
        Animated.parallel([
          Animated.spring(ctaScale, {
            toValue: 1,
            friction: 6,
            tension: 80,
            useNativeDriver: true,
          }),
          Animated.timing(ctaOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start();

        // Start continuous glow pulse
        glowLoop = Animated.loop(
          Animated.sequence([
            Animated.timing(ctaGlow, {
              toValue: 1,
              duration: 1000,
              useNativeDriver: true,
            }),
            Animated.timing(ctaGlow, {
              toValue: 0,
              duration: 1000,
              useNativeDriver: true,
            }),
          ])
        );
        glowLoop.start();
      }, 1800)
    );

    return () => {
      timeouts.forEach(clearTimeout);
      glowLoop?.stop();
    };
  }, [
    titleOpacity,
    titleTranslate,
    subtitleOpacity,
    featuresOpacity,
    featuresTranslate,
    featureAnimations,
    pricingOpacity,
    ctaScale,
    ctaOpacity,
    ctaGlow,
  ]);

  const handleStartTrial = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // TODO: Integrate with RevenueCat for actual subscription
    navigation.navigate('NameEntry');
  };

  const handleMaybeLater = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate('NameEntry');
  };

  const handleLogin = () => {
    navigation.navigate('Auth', { screen: 'Login' });
  };

  const ctaShadowOpacity = ctaGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.2, 0.4],
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Login button - top right */}
      <TouchableOpacity
        onPress={handleLogin}
        style={styles.loginButton}
        accessibilityRole="button"
        accessibilityLabel="Login to your account"
      >
        <Text variant="label" style={styles.loginText}>
          Login
        </Text>
      </TouchableOpacity>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero Section */}
        <View style={styles.heroSection}>
          {/* Title */}
          <Animated.View
            style={[
              styles.titleContainer,
              {
                opacity: titleOpacity,
                transform: [{ translateY: titleTranslate }],
              },
            ]}
          >
            <Text style={styles.title}>Your passport is just</Text>
            <Text style={styles.title}>the beginning.</Text>
          </Animated.View>

          {/* Accent Subtitle */}
          <Animated.Text style={[styles.accentSubtitle, { opacity: subtitleOpacity }]}>
            ~ unlock the full adventure ~
          </Animated.Text>

          {/* Rotating Stamp Hero */}
          <View style={styles.stampHeroContainer}>
            <RotatingStampHero stampCodes={allStampCodes} />
          </View>
        </View>

        {/* Feature List */}
        <Animated.View
          style={[
            styles.featureSection,
            {
              opacity: featuresOpacity,
              transform: [{ translateY: featuresTranslate }],
            },
          ]}
        >
          {PREMIUM_FEATURES.map((feature, index) => (
            <Animated.View
              key={index}
              style={[styles.featureItem, { opacity: featureAnimations[index] }]}
            >
              <Ionicons
                name="checkmark-circle"
                size={22}
                color={colors.mossGreen}
                style={styles.checkIcon}
              />
              <Text style={styles.featureText}>{feature}</Text>
            </Animated.View>
          ))}
        </Animated.View>

        {/* Pricing Toggle */}
        <Animated.View style={[styles.pricingSection, { opacity: pricingOpacity }]}>
          <PricingToggle selectedPlan={selectedPlan} onPlanChange={setSelectedPlan} />
        </Animated.View>

        {/* Spacer for footer */}
        <View style={styles.footerSpacer} />
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        {/* CTA Button */}
        <Animated.View
          style={[
            styles.ctaContainer,
            {
              opacity: ctaOpacity,
              transform: [{ scale: ctaScale }],
            },
          ]}
        >
          <Animated.View style={[styles.ctaShadow, { shadowOpacity: ctaShadowOpacity }]}>
            <TouchableOpacity
              style={styles.ctaButton}
              onPress={handleStartTrial}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel="Unlock all features, start 7-day free trial"
            >
              <Ionicons name="lock-open-outline" size={20} color={colors.midnightNavy} />
              <Text style={styles.ctaButtonText}>Unlock All Features</Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>

        {/* Maybe Later */}
        <TouchableOpacity
          style={styles.maybeLaterButton}
          onPress={handleMaybeLater}
          accessibilityRole="button"
          accessibilityLabel="Skip premium, continue with free version"
        >
          <Text style={styles.maybeLaterText}>Maybe later</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 60,
  },
  heroSection: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  titleContainer: {
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontFamily: fonts.playfair.bold,
    fontSize: 32,
    color: colors.midnightNavy,
    textAlign: 'center',
    lineHeight: 40,
  },
  accentSubtitle: {
    fontFamily: fonts.dawning.regular,
    fontSize: 20,
    color: colors.adobeBrick,
    textAlign: 'center',
    marginBottom: 24,
  },
  stampHeroContainer: {
    marginBottom: 32,
  },
  featureSection: {
    paddingHorizontal: 32,
    marginBottom: 24,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  checkIcon: {
    marginRight: 12,
  },
  featureText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.midnightNavy,
    flex: 1,
  },
  pricingSection: {
    marginBottom: 24,
  },
  footerSpacer: {
    height: 180,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
    backgroundColor: colors.warmCream,
    alignItems: 'center',
  },
  ctaContainer: {
    width: '100%',
    alignItems: 'center',
  },
  ctaShadow: {
    borderRadius: 12,
    shadowColor: colors.sunsetGold,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 8,
  },
  ctaButton: {
    backgroundColor: colors.sunsetGold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    gap: 10,
    minWidth: 280,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  ctaButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  maybeLaterButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 8,
  },
  maybeLaterText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.stormGray,
  },
});
