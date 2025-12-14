import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { MainTabScreenProps } from '@navigation/types';

type Props = MainTabScreenProps<'Friends'>;

/**
 * Friends tab screen - placeholder for future social features.
 * Profile and sign out have been moved to ProfileSettingsScreen
 * accessible from the Passport screen header.
 */
export function ProfileScreen(_props: Props) {
  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Ionicons name="people-outline" size={64} color={colors.stormGray} />
        </View>
        <Text style={styles.title}>Friends</Text>
        <Text style={styles.subtitle}>Coming Soon</Text>
        <Text style={styles.description}>
          Share trips and wishlists with friends, see where they&apos;ve been, and plan adventures
          together.
        </Text>
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
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  iconContainer: {
    marginBottom: 16,
    opacity: 0.6,
  },
  title: {
    fontFamily: fonts.playfair.bold,
    fontSize: 28,
    color: colors.midnightNavy,
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.adobeBrick,
    marginBottom: 16,
  },
  description: {
    fontFamily: fonts.openSans.regular,
    fontSize: 15,
    color: colors.stormGray,
    textAlign: 'center',
    lineHeight: 22,
  },
});
