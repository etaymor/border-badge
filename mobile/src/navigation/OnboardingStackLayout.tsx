import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  OnboardingHeader,
  type OnboardingHeaderRoute,
} from '@components/onboarding/OnboardingHeader';
import { colors } from '@constants/colors';
import { Analytics } from '@services/analytics';

interface OnboardingStackLayoutProps {
  state: { index: number; routes: readonly OnboardingHeaderRoute[] };
  navigation: {
    goBack: () => void;
    navigate: (name: 'Auth', params: { screen: 'Login' }) => void;
  };
  children: ReactNode;
}

/**
 * Wraps the onboarding stack (passed as the navigator's `layout`) and renders
 * the single shared header above it. The layout sits OUTSIDE the per-screen
 * transition containers, so the header stays fixed while only screen content
 * animates on push/pop.
 *
 * The container is painted cream: with `detachPreviousScreen` the screen
 * beneath the top one is detached during push/pop, so this background is what
 * shows wherever the moving screen doesn't cover (white would flash).
 */
export function OnboardingStackLayout({ state, navigation, children }: OnboardingStackLayoutProps) {
  const route = state.routes[state.index];

  return (
    <View testID="onboarding-stack-layout" style={styles.container}>
      {children}
      <OnboardingHeader
        route={route}
        canGoBack={state.index > 0}
        onBack={() => navigation.goBack()}
        onLogin={(source) => {
          Analytics.skipToLogin(source);
          navigation.navigate('Auth', { screen: 'Login' });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
});
