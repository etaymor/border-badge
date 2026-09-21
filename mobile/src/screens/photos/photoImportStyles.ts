/**
 * Styles for PhotoImportScreen and related components.
 *
 * Barrel that merges screen, card, and gallery style groups into a
 * single `styles` export so consumers don't need to change imports.
 */

import { cardStyles } from './styles/cardStyles';
import { galleryStyles } from './styles/galleryStyles';
import { screenStyles } from './styles/screenStyles';

export const styles = {
  ...screenStyles,
  ...cardStyles,
  ...galleryStyles,
} as const;
