import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface ProfileNameSectionProps {
  username: string;
  isSmallScreen?: boolean;
}

export function ProfileNameSection({ username, isSmallScreen }: ProfileNameSectionProps) {
  return (
    <View style={styles.nameSection}>
      <Text style={[styles.username, isSmallScreen && styles.usernameSmall]}>{username}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  nameSection: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 4,
    paddingBottom: 16,
  },
  username: {
    fontFamily: fonts.playfair.bold,
    fontSize: 24,
    color: colors.midnightNavy,
  },
  usernameSmall: {
    fontSize: 20,
  },
});
