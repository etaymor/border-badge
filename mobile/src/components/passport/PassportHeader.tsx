import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { GlassIconButton } from '@components/ui';
import atlasLogo from '../../../assets/atlasi-logo.png';

interface PassportHeaderProps {
  onProfilePress: () => void;
}

export function PassportHeader({ onProfilePress }: PassportHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.headerSpacer} />
      <Image source={atlasLogo} style={styles.headerLogo} resizeMode="contain" />
      <GlassIconButton
        icon="settings-outline"
        onPress={onProfilePress}
        accessibilityLabel="Open profile settings"
        testID="profile-settings-button"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  headerSpacer: {
    width: 44,
  },
  headerLogo: {
    width: 140,
    height: 40,
  },
});
