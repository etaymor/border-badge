import { StyleSheet } from 'react-native';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  animatedContainer: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 24,
  },
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  headerSpacer: {
    width: 44,
  },
  headerLogo: {
    width: 140,
    height: 40,
  },
  // Travel Status Card
  statusCard: {
    marginTop: 0,
    marginHorizontal: 16,
    backgroundColor: colors.cloudWhite,
    borderRadius: 16,
    padding: 16,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusContent: {
    flex: 1,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 2,
  },
  statusLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  statusTitle: {
    fontFamily: fonts.openSans.bold,
    fontSize: 18,
    color: colors.adobeBrick,
    letterSpacing: 0.5,
  },
  countContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  countText: {
    fontFamily: fonts.openSans.bold,
  },
  countCurrent: {
    fontSize: 16,
    color: colors.adobeBrick,
  },
  countTotal: {
    fontSize: 14,
    color: colors.adobeBrick,
    opacity: 0.7,
  },
  statusLabel: {
    fontFamily: fonts.openSans.bold,
    fontSize: 11,
    color: colors.adobeBrick,
    opacity: 0.8,
  },
  countriesLabel: {
    fontFamily: fonts.openSans.bold,
    fontSize: 11,
    color: colors.adobeBrick,
    opacity: 0.8,
  },
  progressBar: {
    width: '100%',
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#64B5F6',
    borderRadius: 4,
  },
  // Stats Grid
  statsGrid: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 16,
    gap: 12,
  },
  statBox: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statValue: {
    fontFamily: fonts.openSans.bold,
    fontSize: 22,
    marginBottom: 4,
  },
  statLabel: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  // Search Row with Liquid Glass
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
  // Section Title
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
  // Section header row with share button
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
  // Stamp Row (2-up grid)
  stampRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 12,
  },
  // Unvisited Row (2-up grid)
  unvisitedRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 12,
  },
  // Stamp Card Wrapper (for animation)
  stampCardWrapper: {
    flex: 1,
  },
  // Country Card Wrapper
  countryCardWrapper: {
    flex: 1,
  },
  // Empty State
  emptyState: {
    paddingVertical: 40,
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
