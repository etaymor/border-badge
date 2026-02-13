/**
 * Screen-level styles for PhotoImportScreen.
 *
 * Covers container, header, idle, scanning, list, trip selection,
 * progress, loading/empty, manual search, and premium gate styles.
 */

import { StyleSheet } from 'react-native';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

export const screenStyles = StyleSheet.create({
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
  privacyNotice: {
    marginTop: 20,
    paddingHorizontal: 4,
    alignSelf: 'stretch',
  },
  privacyTitle: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.midnightNavy,
    marginBottom: 6,
    textAlign: 'center',
  },
  privacyBullet: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: 2,
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
