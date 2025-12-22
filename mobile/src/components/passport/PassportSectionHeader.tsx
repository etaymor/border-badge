import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface PassportSectionHeaderProps {
  title: string;
  showShareButton?: boolean;
  onSharePress?: () => void;
  variant?: 'visited' | 'explore' | 'default';
}

export function PassportSectionHeader({
  title,
  showShareButton = false,
  onSharePress,
  variant = 'default',
}: PassportSectionHeaderProps) {
  const isScript = variant === 'visited' || variant === 'explore';

  if (showShareButton && onSharePress) {
    return (
      <View style={styles.sectionHeaderRow}>
        <Text style={[styles.sectionTitle, isScript && styles.scriptTitle]}>{title}</Text>
        <TouchableOpacity
          onPress={onSharePress}
          style={styles.sectionShareButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Share your passport"
        >
          <Ionicons name="share-outline" size={22} color={colors.adobeBrick} />
        </TouchableOpacity>
      </View>
    );
  }

  return <Text style={[styles.sectionTitle, isScript && styles.scriptTitle]}>{title}</Text>;
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 12,
  },
  scriptTitle: {
    fontFamily: fonts.dawning.regular,
    fontSize: 32,
    color: colors.adobeBrick,
    marginTop: 12,
    marginBottom: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
  },
  sectionShareButton: {
    padding: 8,
  },
});
