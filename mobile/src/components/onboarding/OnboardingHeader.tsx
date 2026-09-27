/**
 * OnboardingHeader — the ONE header shared by the whole onboarding stack.
 *
 * It is rendered by the onboarding navigator's `layout` (see
 * navigation/OnboardingStackLayout.tsx), above the per-screen transition
 * containers, so it stays fixed while only screen content animates on
 * push/pop. Screens reserve its space with <OnboardingHeaderSpacer /> and
 * declare nothing else: what the header shows per route lives in
 * `getOnboardingHeaderConfig` below.
 *
 * Visibility follows the route by mounting/unmounting (Reanimated
 * entering/exiting fades), never by a hand-driven shared-value opacity: with
 * the React Compiler, `.value` writes on hook results are unsafe, and that
 * approach left the header invisible on Motivation after the intro slider.
 *
 * It never paints a background — ContinentIntro and AntarcticaPrompt have
 * their own background colors that must show through.
 */

import { Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import atlasLogo from '../../../assets/atlasi-navy-logo.png';
import { GlassBackButton, Text } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useAuthStore } from '@stores/authStore';

const HEADER_PADDING_TOP = 8;
const HEADER_ROW_HEIGHT = 44;
const HEADER_PADDING_BOTTOM = 4;

/** Height of the shared header below the top safe-area inset. */
export const ONBOARDING_HEADER_HEIGHT =
  HEADER_PADDING_TOP + HEADER_ROW_HEIGHT + HEADER_PADDING_BOTTOM;

const FADE_DURATION_MS = 200;

export interface OnboardingHeaderConfig {
  showBack: boolean;
  showLogin: boolean;
  /** Source passed to `Analytics.skipToLogin` when Login is pressed. */
  loginSource: string;
}

export interface OnboardingHeaderRoute {
  name: string;
  params?: object;
}

type HeaderFlags = Pick<OnboardingHeaderConfig, 'showBack' | 'showLogin'>;

// Routes absent from this map (OnboardingSlider, ContinentCountryGrid,
// Paywall, FirstQuizOffer) own their own chrome or have none.
const HEADER_FLAGS: Record<string, HeaderFlags> = {
  Motivation: { showBack: false, showLogin: true },
  TrackingPreference: { showBack: true, showLogin: true },
  HomeCountry: { showBack: true, showLogin: true },
  DreamDestination: { showBack: true, showLogin: true },
  ContinentIntro: { showBack: true, showLogin: true },
  AntarcticaPrompt: { showBack: true, showLogin: true },
  ProgressSummary: { showBack: true, showLogin: false },
  NameEntry: { showBack: false, showLogin: false },
  AccountCreation: { showBack: false, showLogin: false },
  EmotionalHook: { showBack: false, showLogin: true },
  FunctionalHook: { showBack: true, showLogin: true },
};

function getLoginSource(route: OnboardingHeaderRoute): string {
  if (route.name === 'ContinentIntro') {
    const region = (route.params as { region?: string } | undefined)?.region;
    return `ContinentIntro_${region}`;
  }
  return route.name;
}

export function getOnboardingHeaderConfig(
  route: OnboardingHeaderRoute
): OnboardingHeaderConfig | null {
  const flags = HEADER_FLAGS[route.name];
  if (!flags) return null;
  return { ...flags, loginSource: getLoginSource(route) };
}

interface OnboardingHeaderProps {
  route: OnboardingHeaderRoute;
  canGoBack: boolean;
  onBack: () => void;
  onLogin: (source: string) => void;
}

export function OnboardingHeader({ route, canGoBack, onBack, onLogin }: OnboardingHeaderProps) {
  const insets = useSafeAreaInsets();
  const session = useAuthStore((s) => s.session);
  const config = getOnboardingHeaderConfig(route);
  if (!config) return null;

  const showBack = config.showBack && canGoBack;
  const showLogin = config.showLogin && !session;
  const { loginSource } = config;

  return (
    <Animated.View
      testID="onboarding-header"
      pointerEvents="box-none"
      entering={FadeIn.duration(FADE_DURATION_MS)}
      exiting={FadeOut.duration(FADE_DURATION_MS)}
      style={[styles.container, { paddingTop: insets.top }]}
    >
      <View style={styles.row} pointerEvents="box-none">
        <Image
          testID="onboarding-header-logo"
          source={atlasLogo}
          style={styles.logo}
          resizeMode="contain"
        />
        {showBack && (
          <Animated.View
            style={styles.backSlot}
            entering={FadeIn.duration(FADE_DURATION_MS)}
            exiting={FadeOut.duration(FADE_DURATION_MS)}
          >
            <GlassBackButton onPress={onBack} testID="onboarding-header-back" />
          </Animated.View>
        )}
        {showLogin && (
          <Animated.View
            style={styles.loginSlot}
            entering={FadeIn.duration(FADE_DURATION_MS)}
            exiting={FadeOut.duration(FADE_DURATION_MS)}
          >
            <TouchableOpacity
              testID="onboarding-header-login"
              onPress={() => onLogin(loginSource)}
              style={styles.loginButton}
            >
              <Text style={styles.loginText}>Login</Text>
            </TouchableOpacity>
          </Animated.View>
        )}
      </View>
    </Animated.View>
  );
}

/** Reserves the shared header's height at the top of a screen's content. */
export function OnboardingHeaderSpacer() {
  return <View testID="onboarding-header-spacer" style={styles.spacer} />;
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  row: {
    height: HEADER_ROW_HEIGHT,
    marginTop: HEADER_PADDING_TOP,
    marginBottom: HEADER_PADDING_BOTTOM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 94,
    height: 24,
  },
  backSlot: {
    position: 'absolute',
    left: 16,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  loginSlot: {
    position: 'absolute',
    right: 16,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
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
  spacer: {
    height: ONBOARDING_HEADER_HEIGHT,
  },
});
