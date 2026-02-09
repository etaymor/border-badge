/**
 * Styles for PhotoImportScreen and related components.
 */

import { StyleSheet } from 'react-native';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  headerTitle: {
    flex: 1,
    fontFamily: fonts.playfair.bold,
    fontSize: 24,
    color: colors.midnightNavy,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 44,
  },

  // Idle state
  idleContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  idleTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 24,
    color: colors.midnightNavy,
    marginTop: 24,
    marginBottom: 12,
  },
  idleDescription: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 16,
  },
  lastScanText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 24,
  },
  scanButton: {
    minWidth: 200,
  },
  refreshLink: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    padding: 8,
  },
  refreshLinkText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.sunsetGold,
    marginLeft: 6,
  },

  // Scanning state
  scanningContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  scanningTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
    marginTop: 24,
    marginBottom: 8,
  },
  scanningProgress: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  progressBar: {
    width: '100%',
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.sunsetGold,
  },
  scanningHint: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 20,
    paddingHorizontal: 20,
  },
  discoveryFeed: {
    marginTop: 20,
    alignItems: 'center',
  },
  discoveryItem: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.midnightNavy,
    marginBottom: 4,
  },
  cancelButton: {
    marginTop: 24,
    padding: 12,
  },
  cancelText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.adobeBrick,
  },

  // Lists
  listContainer: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  tripSelectionContent: {
    paddingBottom: 40,
  },

  // Trip selection phase
  candidateSummary: {
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 16,
    marginBottom: 24,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  photoPreviewStrip: {
    marginVertical: 16,
  },
  previewThumbnail: {
    width: 64,
    height: 64,
    borderRadius: 8,
    marginRight: 8,
  },
  morePhotosIndicator: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: colors.midnightNavy + '80',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoCountText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.textSecondary,
  },
  tripSelectorSection: {
    marginBottom: 24,
  },
  tripSelectorLabel: {
    fontFamily: fonts.oswald.medium,
    fontSize: 12,
    color: colors.midnightNavy,
    marginBottom: 8,
    letterSpacing: 1.5,
    opacity: 0.7,
    textTransform: 'uppercase',
  },
  tripSelectorHint: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  sectionTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 24,
    color: colors.midnightNavy,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 20,
  },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  backLinkText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.sunsetGold,
    marginLeft: 4,
  },

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

  // Trip info header (suggestions phase)
  tripName: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
    marginBottom: 4,
    paddingHorizontal: 20,
  },
  tripMeta: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 2,
    paddingHorizontal: 20,
  },
  tripDates: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 16,
    paddingHorizontal: 20,
  },

  // Progress header for suggestions loading
  progressHeader: {
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  progressLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressLabel: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginLeft: 8,
  },

  // Warning banner for failed clusters / large libraries
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.sunsetGold + '15',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  // Loading & Empty states
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: 16,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  // Photo preview overlay
  overlayBackground: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    zIndex: 10,
    padding: 8,
  },
  fullPreview: {
    width: '100%',
    height: '100%',
  },
  galleryContainer: {
    flex: 1,
    width: '100%',
  },
  galleryCounter: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  galleryCounterText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.white,
  },

  // Manual search modal
  manualSearchContainer: {
    flex: 1,
    backgroundColor: colors.warmCream,
    paddingHorizontal: 20,
  },
  manualSearchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
  },
  manualSearchTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 24,
    color: colors.midnightNavy,
  },
  manualSearchCancel: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.sunsetGold,
  },
  photoRow: {
    flexDirection: 'row',
    marginBottom: 24,
  },
  contextThumb: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 8,
  },
  autocompleteSection: {
    marginBottom: 24,
    zIndex: 1000,
  },
  sectionLabel: {
    fontFamily: fonts.oswald.medium,
    fontSize: 12,
    color: colors.midnightNavy,
    marginBottom: 12,
    letterSpacing: 1.5,
    opacity: 0.7,
    textTransform: 'uppercase',
  },
  categorySection: {
    marginBottom: 24,
  },
  confirmSection: {
    marginTop: 'auto',
    paddingBottom: 40,
  },

  // Premium gate banner
  premiumGateBanner: {
    backgroundColor: colors.sunsetGold + '15',
    borderRadius: 12,
    padding: 20,
    marginHorizontal: 20,
    marginBottom: 16,
    alignItems: 'center',
  },
  premiumGateTitle: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
    marginBottom: 8,
  },
  premiumGateText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  premiumGateButton: {
    minWidth: 200,
  },
});
