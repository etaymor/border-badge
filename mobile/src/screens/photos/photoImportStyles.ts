/**
 * Styles for PhotoImportScreen and related components.
 *
 * Barrel that merges screen, card, and gallery style groups into a
 * single `styles` export so consumers don't need to change imports.
 */

import { StyleSheet } from 'react-native';

import { cardStyles } from './styles/cardStyles';
import { galleryStyles } from './styles/galleryStyles';
import { screenStyles } from './styles/screenStyles';

const scanningStyles = StyleSheet.create({
  discoveryRowsRegion: {
    width: '100%',
    marginTop: 20,
  },
});

export const styles = {
  ...screenStyles,
  ...cardStyles,
  ...galleryStyles,
  ...scanningStyles,
} as const;
