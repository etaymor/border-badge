/**
 * StageHero - the navy hero every scan surface shares, with its visual full
 * bleed.
 *
 * The visual (a permission beat, the idle stamp page, the live scan) fills
 * the whole hero edge to edge, from the top of the screen down under the
 * sheet's rounded top. The header (back button, optional title) floats over
 * it on a navy scrim so it stays legible.
 *
 * Because the edges are covered — the header on top, the sheet's overlap at
 * the bottom — the hero publishes the visible band as `StageInsets`. Anything
 * that must be seen in full (pills, stamps, slots) lays itself out inside that
 * band; backgrounds (photo grids, the beat-2 photo) just fill.
 *
 * A header with a title spans the width, so the band starts below it and a
 * scrim keeps the title legible. A `titleless` header is only the back button:
 * the band starts just under the status bar, there is no scrim, and only the
 * button's corner is kept clear (`StageInsets.corner`), so the top right of
 * the stage is usable.
 */

import { createContext, useContext, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, withAlpha } from '@constants/colors';

/** How far the cream sheet's rounded top rides up over the hero. */
export const STAGE_SHEET_OVERLAP = 28;
/** Header estimate before its first layout: back button row under the notch. */
const HEADER_ESTIMATE = 60;
const SCRIM_TAIL = 36;
/** A title-less header's back button: 16pt gutter + 44pt button + breathing room. */
const BACK_CORNER_WIDTH = 72;
const STATUS_BAR_GAP = 8;

export interface StageInsets {
  /** Covered by the header, from the top of the stage. */
  top: number;
  /** Covered by the sheet, from the bottom of the stage. */
  bottom: number;
  /** Top-left block (back button) to keep clear when the header has no title. */
  corner?: { width: number; height: number };
}

const StageInsetsContext = createContext<StageInsets>({ top: 0, bottom: 0 });

/** The visible band of the stage a child is drawn in. Zero outside a hero. */
export function useStageInsets(): StageInsets {
  return useContext(StageInsetsContext);
}

interface StageHeroProps {
  /** Header row; rendered over the visual. Include the safe-area top yourself. */
  header: ReactNode;
  children: ReactNode;
  /** The header is only a back button: open the top right, drop the scrim. */
  titleless?: boolean;
  testID?: string;
}

export function StageHero({ header, children, titleless = false, testID }: StageHeroProps) {
  const safeArea = useSafeAreaInsets();
  const [headerHeight, setHeaderHeight] = useState(safeArea.top + HEADER_ESTIMATE);
  const insets: StageInsets = titleless
    ? {
        top: safeArea.top + STATUS_BAR_GAP,
        bottom: STAGE_SHEET_OVERLAP,
        corner: { width: BACK_CORNER_WIDTH, height: headerHeight },
      }
    : { top: headerHeight, bottom: STAGE_SHEET_OVERLAP };

  return (
    <View style={styles.hero} testID={testID}>
      <StageInsetsContext.Provider value={insets}>
        <View style={StyleSheet.absoluteFill} testID="stage-fill" pointerEvents="none">
          {children}
        </View>
      </StageInsetsContext.Provider>
      {titleless ? null : (
        <LinearGradient
          testID="stage-header-scrim"
          colors={[withAlpha(colors.midnightNavy, 0.92), withAlpha(colors.midnightNavy, 0)]}
          locations={[0.55, 1]}
          style={[styles.scrim, { height: headerHeight + SCRIM_TAIL }]}
          pointerEvents="none"
        />
      )}
      <View
        style={styles.header}
        pointerEvents="box-none"
        onLayout={(event) => {
          const { height } = event.nativeEvent.layout;
          setHeaderHeight((current) => (Math.abs(current - height) < 0.5 ? current : height));
        }}
      >
        {header}
      </View>
    </View>
  );
}

export default StageHero;

const styles = StyleSheet.create({
  hero: {
    flex: 1,
    minHeight: 280,
    backgroundColor: colors.midnightNavy,
    overflow: 'hidden',
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
});
