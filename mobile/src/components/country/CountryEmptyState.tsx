import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface CountryEmptyStateProps {
  flagEmoji: string;
  displayName: string;
}

function CountryEmptyStateComponent({ flagEmoji, displayName }: CountryEmptyStateProps) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconContainer}>
        <Text style={styles.emptyIcon}>{flagEmoji}</Text>
      </View>
      <View style={styles.textContainer}>
        <Text style={styles.emptyTitle}>No adventures yet</Text>
        <Text style={styles.emptySubtitle}>Start planning your trip to {displayName}</Text>
      </View>
    </View>
  );
}

export default memo(CountryEmptyStateComponent);

const styles = StyleSheet.create({
  emptyState: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    gap: 16,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.paperBeige,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.midnightNavyBorder,
  },
  emptyIcon: {
    fontSize: 40,
  },
  textContainer: {
    flex: 1,
  },
  emptyTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.stormGray,
    lineHeight: 24,
  },
});
