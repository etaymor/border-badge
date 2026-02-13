/**
 * Card styles for PlaceSuggestionCard and PhotoClusterCard.
 */

import { StyleSheet } from 'react-native';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

export const cardStyles = StyleSheet.create({
  // Suggestion card
  suggestionCard: {
    backgroundColor: colors.white,
    borderRadius: 20,
    marginBottom: 24,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
  },
  suggestionHeroContainer: {
    height: 240,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.backgroundMuted,
  },
  suggestionHeroImage: {
    width: '100%',
    height: '100%',
  },
  suggestionContent: {
    padding: 16,
    paddingTop: 32, // Space for floating buttons
  },
  suggestionFloatingActions: {
    position: 'absolute',
    top: 216, // 240 (hero height) - 24 (half button height)
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    zIndex: 10,
  },
  floatingActionButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  floatingRejectButton: {
    backgroundColor: colors.adobeBrick,
  },
  floatingConfirmButton: {
    backgroundColor: colors.success,
  },
  suggestionPhotos: {
    flexDirection: 'row',
    padding: 12,
    paddingBottom: 8,
  },
  suggestionThumbnail: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 8,
  },
  suggestionInfo: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  suggestionName: {
    fontFamily: fonts.playfair.bold,
    fontSize: 22,
    color: colors.midnightNavy,
    marginBottom: 4,
  },
  suggestionAddress: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.textTertiary,
    marginBottom: 8,
  },
  suggestionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  categoryBadge: {
    backgroundColor: colors.sunsetGold + '20',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 12,
  },
  categoryText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 12,
    color: colors.sunsetGold,
    textTransform: 'capitalize',
  },
  distanceText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.textSecondary,
  },
  suggestionActions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectButton: {
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  confirmButton: {},

  // PhotoClusterCard (no suggestions)
  clusterInfo: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  clusterNoSuggestions: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  clusterPhotoCount: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 12,
    color: colors.sunsetGold,
  },
  clusterMorePhotos: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: colors.midnightNavy + '80',
    justifyContent: 'center',
    alignItems: 'center',
  },
  clusterMorePhotosText: {
    fontFamily: fonts.openSans.bold,
    fontSize: 14,
    color: colors.white,
  },
  clusterAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  clusterAddButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.sunsetGold,
    marginLeft: 8,
  },
});
