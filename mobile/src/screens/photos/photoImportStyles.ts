/**
 * Styles for PhotoImportScreen and related components.
 *
 * Barrel that merges screen, card, and gallery style groups into a
 * single `styles` export so consumers don't need to change imports.
 */

import { screenStyles } from './styles/screenStyles';
import { cardStyles } from './styles/cardStyles';
import { galleryStyles } from './styles/galleryStyles';

export const styles = { ...screenStyles, ...cardStyles, ...galleryStyles } as const;
