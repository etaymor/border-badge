/**
 * Gallery/overlay styles for photo preview modal.
 */

import { StyleSheet } from 'react-native';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

export const galleryStyles = StyleSheet.create({
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
  galleryBottomBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 40,
    paddingHorizontal: 16,
    gap: 12,
  },
  galleryCounter: {
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
  gallerySplitButton: {
    backgroundColor: colors.sunsetGold,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  gallerySplitButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.midnightNavy,
  },
  gallerySelectionToggle: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    zIndex: 10,
    padding: 4,
  },
  galleryCheckbox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.7)',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  galleryCheckboxSelected: {
    backgroundColor: colors.sunsetGold,
    borderColor: colors.sunsetGold,
  },
  galleryDeselectedOverlay: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
});
