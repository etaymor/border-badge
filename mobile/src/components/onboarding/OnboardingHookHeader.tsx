import { Image, StyleSheet, TouchableOpacity, View } from 'react-native';

import { GlassBackButton, Text } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

/* eslint-disable @typescript-eslint/no-require-imports */
const atlasLogo = require('../../../assets/atlasi-logo.png');
/* eslint-enable @typescript-eslint/no-require-imports */

interface OnboardingHookHeaderProps {
  onBack?: () => void;
  onLogin?: () => void;
}

export function OnboardingHookHeader({ onBack, onLogin }: OnboardingHookHeaderProps) {
  return (
    <View style={styles.headerRow}>
      {onBack ? <GlassBackButton onPress={onBack} /> : <View style={styles.loginButton} />}
      <Image source={atlasLogo} style={styles.logo} resizeMode="contain" />
      {onLogin ? (
        <TouchableOpacity onPress={onLogin} style={styles.loginButton}>
          <Text style={styles.loginText}>Login</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.loginButton} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
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
  logo: {
    width: 140,
    height: 40,
  },
});
