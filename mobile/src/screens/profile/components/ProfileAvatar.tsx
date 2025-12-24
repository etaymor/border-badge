import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface ProfileAvatarProps {
  initials: string;
  isSmallScreen?: boolean;
}

export function ProfileAvatar({ initials, isSmallScreen }: ProfileAvatarProps) {
  return (
    <View style={styles.avatarSection}>
      <View style={[styles.avatarCircle, isSmallScreen && styles.avatarCircleSmall]}>
        <Text style={[styles.avatarText, isSmallScreen && styles.avatarTextSmall]}>{initials}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  avatarSection: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 8,
  },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.adobeBrick,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  avatarText: {
    fontFamily: fonts.playfair.bold,
    fontSize: 32,
    color: colors.cloudWhite,
  },
  avatarCircleSmall: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  avatarTextSmall: {
    fontSize: 26,
  },
});
