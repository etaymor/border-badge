/**
 * ReadingGrid - the stage card while the scan reads the library.
 *
 * The user's own photos, as the scan reads them, fill a 3 x 4 grid across
 * the whole stage, edge to edge (the same grid as carousel beat 1). Tiles fill in a scattered order rather than reading order, and once
 * the grid is full it keeps churning, one tile at a time, while there are new
 * reads to show — so the card is visibly working without a word of copy.
 * Trip photos (taken outside the home country) get a gold check.
 *
 * Everything shown is already on the device; nothing here uploads. Tiles
 * with no photo yet are a faint navy tile, never a stock photo.
 */

import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { colors, withAlpha } from '@constants/colors';
import type { ReadingPreview } from '@services/photoImport/scanPreviewPicker';
import { PhotoThumbnail } from '@screens/photos/components/PhotoThumbnail';

import { SCAN_SLOT_FLY_IN_SPRING_CONFIG } from './scanMotion';

export const READING_GRID_COLUMNS = 3;
export const READING_GRID_ROWS = 4;
export const READING_GRID_TILE_COUNT = READING_GRID_COLUMNS * READING_GRID_ROWS;
const GUTTER = 3;
export const READING_GRID_TICK_MS = 350;
export const READING_GRID_REDUCED_TICK_MS = 2000;
const DIMMED_OPACITY = 0.22;
const BADGE_DELAY_MS = 160;
const MAX_QUEUED = READING_GRID_TILE_COUNT;

/**
 * Fixed scattered fill order (a permutation of 0..11) so the first photos
 * land all over the stage, not along the top row.
 */
const FILL_ORDER = [4, 9, 2, 6, 11, 0, 7, 3, 10, 1, 8, 5] as const;

/** Replacement order once full: a different spread so churn never sweeps. */
const CHURN_ORDER = [7, 0, 10, 5, 2, 9, 3, 11, 6, 1, 8, 4] as const;

type Tiles = readonly (ReadingPreview | null)[];

const EMPTY_TILES: Tiles = Array.from({ length: READING_GRID_TILE_COUNT }, () => null);

/**
 * Place the next queued photo. Pure so the fill order can be tested without
 * timers: fills empty tiles in FILL_ORDER first, then replaces in CHURN_ORDER.
 */
export function placeNextReadingTile(
  tiles: Tiles,
  next: ReadingPreview,
  churnCursor: number
): { tiles: Tiles; churnCursor: number } {
  const emptyIndex = FILL_ORDER.find((index) => tiles[index] === null);
  const updated = tiles.slice();
  if (emptyIndex !== undefined) {
    updated[emptyIndex] = next;
    return { tiles: updated, churnCursor };
  }
  const target = CHURN_ORDER[churnCursor % CHURN_ORDER.length];
  updated[target] = next;
  return { tiles: updated, churnCursor: churnCursor + 1 };
}

interface PhotoTileProps {
  preview: ReadingPreview;
  index: number;
  reduceMotion: boolean;
}

function PhotoTile({ preview, index, reduceMotion }: PhotoTileProps) {
  const [failed, setFailed] = useState(false);
  const progress = useSharedValue(reduceMotion ? 1 : 0);
  const badge = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      progress.value = 1;
      badge.value = 1;
      return;
    }
    progress.value = withSpring(1, SCAN_SLOT_FLY_IN_SPRING_CONFIG);
    badge.value = withDelay(BADGE_DELAY_MS, withSpring(1, SCAN_SLOT_FLY_IN_SPRING_CONFIG));
  }, [badge, progress, reduceMotion]);

  const tileStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, progress.value * 1.6),
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.82, 1]) }],
  }));
  const badgeStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, badge.value),
    transform: [{ scale: interpolate(badge.value, [0, 1], [0.3, 1]) }],
  }));

  if (failed) return null;

  return (
    <Animated.View style={[styles.photoLayer, tileStyle]}>
      <PhotoThumbnail
        testID={`reading-grid-photo-${index}`}
        uri={preview.uri}
        assetId={preview.assetId}
        style={styles.photo}
        transition={0}
        recoverOnError={false}
        onError={() => setFailed(true)}
        accessible={false}
      />
      {preview.isTravel ? (
        <Animated.View testID={`reading-grid-check-${index}`} style={[styles.badge, badgeStyle]}>
          <View style={styles.checkStem} />
          <View style={styles.checkArm} />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

export interface ReadingGridProps {
  previews: readonly ReadingPreview[];
  /** Fades the grid back to a texture once stamps start landing. */
  dimmed: boolean;
  reduceMotion: boolean;
  /** Stop placing new tiles (scan paused or finished). */
  frozen?: boolean;
}

export function ReadingGrid({ previews, dimmed, reduceMotion, frozen = false }: ReadingGridProps) {
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [grid, setGrid] = useState<{ tiles: Tiles; churnCursor: number }>({
    tiles: EMPTY_TILES,
    churnCursor: 0,
  });
  const queueRef = useRef<ReadingPreview[]>([]);
  const queuedIdsRef = useRef(new Set<string>());
  const opacity = useSharedValue(dimmed ? DIMMED_OPACITY : 1);

  useEffect(() => {
    for (const preview of previews) {
      if (queuedIdsRef.current.has(preview.assetId)) continue;
      queuedIdsRef.current.add(preview.assetId);
      queueRef.current.push(preview);
    }
    // Reads can outpace the tick; show the freshest, drop the backlog.
    if (queueRef.current.length > MAX_QUEUED) {
      queueRef.current.splice(0, queueRef.current.length - MAX_QUEUED);
    }
  }, [previews]);

  useEffect(() => {
    if (frozen) return;
    const tick = () => {
      const next = queueRef.current.shift();
      if (!next) return;
      setGrid((current) => placeNextReadingTile(current.tiles, next, current.churnCursor));
    };
    tick();
    const timer = setInterval(
      tick,
      reduceMotion ? READING_GRID_REDUCED_TICK_MS : READING_GRID_TICK_MS
    );
    return () => clearInterval(timer);
  }, [frozen, reduceMotion]);

  useEffect(() => {
    const target = dimmed ? DIMMED_OPACITY : 1;
    opacity.value = reduceMotion ? target : withTiming(target, { duration: 400 });
  }, [dimmed, opacity, reduceMotion]);

  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const tileWidth =
    frame.width > 0
      ? (frame.width - GUTTER * (READING_GRID_COLUMNS - 1)) / READING_GRID_COLUMNS
      : undefined;
  const tileHeight =
    frame.height > 0
      ? (frame.height - GUTTER * (READING_GRID_ROWS - 1)) / READING_GRID_ROWS
      : undefined;

  return (
    <Animated.View
      testID="scan-stage-reading-grid"
      style={[styles.grid, fadeStyle, reduceMotion && { opacity: dimmed ? DIMMED_OPACITY : 1 }]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setFrame((current) =>
          current.width === width && current.height === height ? current : { width, height }
        );
      }}
    >
      {grid.tiles.map((preview, index) => (
        <View
          key={index}
          testID={`scan-stage-grid-tile-${index}`}
          style={[styles.tile, tileWidth !== undefined && { width: tileWidth, height: tileHeight }]}
        >
          <View style={styles.placeholder} />
          {preview ? (
            <PhotoTile
              key={preview.assetId}
              preview={preview}
              index={index}
              reduceMotion={reduceMotion}
            />
          ) : null}
        </View>
      ))}
    </Animated.View>
  );
}

export default ReadingGrid;

const styles = StyleSheet.create({
  grid: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GUTTER,
    alignContent: 'flex-start',
  },
  tile: {
    overflow: 'hidden',
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: withAlpha(colors.cloudWhite, 0.06),
  },
  photoLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  badge: {
    position: 'absolute',
    right: 5,
    bottom: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.sunsetGold,
  },
  checkStem: {
    position: 'absolute',
    left: 5,
    top: 10,
    width: 6,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: colors.midnightNavy,
    transform: [{ rotate: '45deg' }],
  },
  checkArm: {
    position: 'absolute',
    left: 8,
    top: 8,
    width: 9,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: colors.midnightNavy,
    transform: [{ rotate: '-48deg' }],
  },
});
