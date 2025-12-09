import { StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ReactNode } from 'react';

import { colors } from '@constants/colors';

interface ScreenProps {
  children: ReactNode;
  safeArea?: boolean;
  style?: ViewStyle;
}

export function Screen({ children, safeArea = true, style }: ScreenProps) {
  const Container = safeArea ? SafeAreaView : View;

  return <Container style={[styles.container, style]}>{children}</Container>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background, // Warm Cream
  },
});
