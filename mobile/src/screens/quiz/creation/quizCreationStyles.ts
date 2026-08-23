/**
 * quizCreationStyles - The wizard's one stylesheet.
 *
 * Shared by `QuizCreationScreen` (hero, sheet, per-phase copy) and
 * `BuildProgressSheet` (counter, meter, slot grid). Kept in one module rather
 * than split per component because the two render halves of the SAME sheet:
 * the phases have to agree on `sheetContent`'s gap, `title`, and `body`, and a
 * second stylesheet is how they would quietly stop agreeing.
 */

import { StyleSheet } from 'react-native';

import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';

export const styles = StyleSheet.create({
  stage: {
    flex: 1,
    backgroundColor: colors.midnightNavy,
  },
  heroRegion: {
    flex: 1,
    minHeight: 200,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  heroFill: {
    flex: 1,
    backgroundColor: colors.midnightNavy,
    overflow: 'hidden',
  },
  heroNeutral: {
    flex: 1,
    backgroundColor: colors.midnightNavy,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
    // Keep centered content clear of the sheet's rounded overlap.
    paddingBottom: 24,
  },
  heroFooter: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 44,
  },
  heroEyebrow: {
    fontFamily: fonts.body.bold,
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.sunsetGold,
    textAlign: 'center',
  },
  sheet: {
    backgroundColor: colors.warmCream,
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    marginTop: -28,
    paddingTop: 32,
    paddingHorizontal: 24,
  },
  sheetContent: {
    gap: 14,
  },
  // The permission-request sheet carries a longer privacy notice than every
  // other phase, so it gets its own roomier rhythm rather than stretching
  // sheetContent (shared by phases with far less to say) to match.
  permissionSheetContent: {
    gap: 18,
    paddingTop: 4,
    paddingBottom: 12,
  },
  title: {
    fontFamily: fonts.playfair.bold,
    fontSize: 28,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    fontFamily: fonts.body.regular,
    fontSize: 16,
    lineHeight: 24,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  freshnessDetail: {
    fontFamily: fonts.body.regular,
    fontSize: 12,
    lineHeight: 18,
    color: withAlpha(colors.midnightNavy, 0.55),
    textAlign: 'center',
    marginTop: -4,
  },
  freshnessLine: {
    fontFamily: fonts.body.semiBold,
    fontSize: 13,
    lineHeight: 19,
    color: withAlpha(colors.midnightNavy, 0.6),
    textAlign: 'center',
  },
  statusLine: {
    fontFamily: fonts.body.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: -6,
  },
  counter: {
    fontFamily: fonts.playfair.bold,
    fontSize: 40,
    lineHeight: 48,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  counterOf: {
    fontFamily: fonts.playfair.regular,
    fontSize: 22,
    color: colors.stormGray,
  },
  examinedLine: {
    fontFamily: fonts.body.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.stormGray,
    textAlign: 'center',
    marginTop: -8,
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: withAlpha(colors.sunsetGold, 0.25),
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: colors.sunsetGold,
  },
  slotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -5,
  },
  slotWrapper: {
    width: '20%',
    aspectRatio: 1,
    padding: 5,
  },
  slot: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.paperBeige,
    borderWidth: 1,
    borderColor: withAlpha(colors.stormGray, 0.18),
  },
  slotPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.paperBeige,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotMarkFrame: {
    width: 28,
    height: 28,
    borderWidth: 1.5,
    borderColor: withAlpha(colors.stormGray, 0.4),
    borderRadius: 6,
    overflow: 'hidden',
  },
  slotMarkSun: {
    position: 'absolute',
    top: 5,
    left: 5,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: withAlpha(colors.stormGray, 0.4),
  },
  slotMarkPeak: {
    position: 'absolute',
    bottom: -1,
    right: 3,
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderBottomWidth: 11,
    borderLeftColor: colors.transparent,
    borderRightColor: colors.transparent,
    borderBottomColor: withAlpha(colors.stormGray, 0.35),
  },
  slotPhotoLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.warmCream,
  },
  slotPhotoPending: {
    opacity: 0.55,
  },
  slotPhoto: {
    flex: 1,
  },
  privacyLine: {
    fontFamily: fonts.body.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.stormGray,
    textAlign: 'center',
  },
  hint: {
    fontFamily: fonts.body.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textTertiary,
    textAlign: 'center',
  },
});
