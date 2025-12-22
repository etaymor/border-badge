import React from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface PassportSearchBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onExplorePress: () => void;
  filtersActive: boolean;
  activeFilterCount: number;
}

export function PassportSearchBar({
  searchQuery,
  onSearchChange,
  onExplorePress,
  filtersActive,
  activeFilterCount,
}: PassportSearchBarProps) {
  return (
    <View style={styles.searchRow}>
      <View style={styles.searchGlassWrapper}>
        <BlurView intensity={60} tint="light" style={styles.searchGlassContainer}>
          <View style={styles.searchInputContainer}>
            <Ionicons name="search" size={18} color={colors.stormGray} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Type Country"
              placeholderTextColor={colors.stormGray}
              value={searchQuery}
              onChangeText={onSearchChange}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="search"
            />
          </View>
        </BlurView>
      </View>
      <TouchableOpacity
        style={[styles.exploreButton, filtersActive && styles.exploreButtonActive]}
        onPress={onExplorePress}
        activeOpacity={0.7}
      >
        <Text style={[styles.exploreButtonText, filtersActive && styles.exploreButtonTextActive]}>
          {filtersActive ? `FILTERS (${activeFilterCount})` : 'EXPLORE'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 20,
    gap: 16,
    alignItems: 'center',
  },
  searchGlassWrapper: {
    flex: 1,
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  searchGlassContainer: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.9)',
    backgroundColor: 'rgba(253, 246, 237, 0.5)',
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  exploreButton: {
    paddingHorizontal: 16,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
  },
  exploreButtonActive: {
    backgroundColor: colors.mossGreen,
  },
  exploreButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.mossGreen,
    letterSpacing: 0.5,
  },
  exploreButtonTextActive: {
    color: colors.cloudWhite,
  },
});
