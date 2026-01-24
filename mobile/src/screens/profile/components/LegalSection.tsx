import React from 'react';
import { View, Text, Pressable, StyleSheet, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { env } from '@config/env';

interface LegalSectionProps {
  isSmallScreen?: boolean;
}

export function LegalSection({ isSmallScreen }: LegalSectionProps) {
  const handleOpenTerms = () => {
    Linking.openURL(`${env.webBaseUrl}/terms`);
  };

  const handleOpenPrivacy = () => {
    Linking.openURL(`${env.webBaseUrl}/privacy`);
  };

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, isSmallScreen && styles.sectionTitleSmall]}>Legal</Text>

      <Pressable
        onPress={handleOpenTerms}
        style={({ pressed }) => [styles.linkRow, pressed && styles.linkRowPressed]}
        accessibilityRole="link"
        accessibilityLabel="Terms of Service"
        testID="terms-link"
      >
        <View style={styles.linkContent}>
          <Text style={[styles.linkText, isSmallScreen && styles.linkTextSmall]}>
            Terms of Service
          </Text>
          <Ionicons name="open-outline" size={16} color={colors.stormGray} />
        </View>
      </Pressable>

      <Pressable
        onPress={handleOpenPrivacy}
        style={({ pressed }) => [styles.linkRow, pressed && styles.linkRowPressed]}
        accessibilityRole="link"
        accessibilityLabel="Privacy Policy"
        testID="privacy-link"
      >
        <View style={styles.linkContent}>
          <Text style={[styles.linkText, isSmallScreen && styles.linkTextSmall]}>
            Privacy Policy
          </Text>
          <Ionicons name="open-outline" size={16} color={colors.stormGray} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: 24,
    paddingVertical: 8,
  },
  sectionTitle: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 12,
    color: colors.stormGray,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  sectionTitleSmall: {
    fontSize: 11,
  },
  linkRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.paperBeige,
  },
  linkRowPressed: {
    opacity: 0.6,
  },
  linkContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  linkText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 15,
    color: colors.midnightNavy,
  },
  linkTextSmall: {
    fontSize: 14,
  },
});
