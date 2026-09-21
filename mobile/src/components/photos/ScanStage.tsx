import { memo, useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { CountryRow, type CountryRowSlot } from '@components/photos/CountryRow';
import { SCAN_SLOT_FLY_IN_SPRING_CONFIG } from '@components/photos/scanMotion';
import { useArrivalQueue } from '@components/photos/useArrivalQueue';
import { colors, withAlpha } from '@constants/colors';
import { SCAN_COPY } from '@constants/scanCopy';
import { useStableCallback } from '@hooks/useStableCallback';
import type { CountryPreviewRow, ScanPreview } from '@services/photoImport/scanPreviewPicker';
import { PhotoThumbnail } from '@screens/photos/components/PhotoThumbnail';

const VISIBLE_ROW_COUNT = 4;
const DISCOVERY_ROW_HEIGHT = 64;
const SHELF_VIEWPORT_HEIGHT = VISIBLE_ROW_COUNT * DISCOVERY_ROW_HEIGHT;
const GRADIENT_MASK_HEIGHT = 24;
const SWEEP_DURATION_MS = 1800;
const GRID_COLUMNS = 4;
const GRID_ROWS = 5;
const GRID_TILE_COUNT = GRID_COLUMNS * GRID_ROWS;
const GRID_GUTTER = 4;
const SLOTS_PER_ROW = 2;

export interface ScanStageProps {
  rows: readonly CountryPreviewRow[];
  isComplete: boolean;
  isPaused?: boolean;
  reduceMotion: boolean;
}

/**
 * Neutral image-outline mark (same visual language as BuildProgressSheet's
 * SlotPlaceholderMark). Copied here so ScanStage does not import the sheet.
 */
function SlotPlaceholderMark() {
  return (
    <View style={styles.slotMarkFrame} testID="scan-slot-placeholder-mark">
      <View style={styles.slotMarkSun} />
      <View style={styles.slotMarkPeak} />
    </View>
  );
}

function PlaceholderTile({ testID }: { testID?: string }) {
  return (
    <View style={styles.placeholderTile} testID={testID}>
      <SlotPlaceholderMark />
    </View>
  );
}

interface ScanThumbnailProps {
  code: string;
  index: number;
  preview: ScanPreview;
}

function ScanThumbnail({ code, index, preview }: ScanThumbnailProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <PlaceholderTile testID={`scan-stage-slot-placeholder-${code}-${index}`} />;
  }

  return (
    <View
      style={styles.thumbnail}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <PhotoThumbnail
        testID={`scan-stage-thumbnail-${code}-${index}`}
        uri={preview.uri}
        assetId={preview.assetId}
        style={styles.thumbnail}
        transition={0}
        recoverOnError={false}
        onError={() => setFailed(true)}
        accessible={false}
      />
    </View>
  );
}

function buildSlots(code: string, previews: readonly ScanPreview[]): CountryRowSlot[] {
  return Array.from({ length: SLOTS_PER_ROW }, (_, index) => {
    const preview = previews[index];
    if (!preview) {
      return function EmptySlot() {
        return <PlaceholderTile testID={`scan-stage-slot-placeholder-${code}-${index}`} />;
      };
    }
    return function PreviewSlot() {
      return <ScanThumbnail code={code} index={index} preview={preview} />;
    };
  });
}

interface ReadingGridProps {
  reduceMotion: boolean;
  active: boolean;
}

function ReadingGrid({ reduceMotion, active }: ReadingGridProps) {
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const sweep = useSharedValue(0);
  const frameWidth = useSharedValue(0);
  const shouldSweep = active && !reduceMotion;

  useEffect(() => {
    if (!shouldSweep) {
      cancelAnimation(sweep);
      sweep.value = 0;
      return;
    }

    sweep.value = 0;
    sweep.value = withRepeat(
      withTiming(1, { duration: SWEEP_DURATION_MS, easing: Easing.linear }),
      -1,
      false
    );

    return () => {
      cancelAnimation(sweep);
    };
  }, [shouldSweep, sweep]);

  const sweepStyle = useAnimatedStyle(() => {
    const width = frameWidth.value;
    const bandWidth = Math.max(40, width * 0.22);
    return {
      transform: [{ translateX: sweep.value * (width + bandWidth) - bandWidth }],
    };
  });

  const tileWidth =
    frame.width > 0 ? (frame.width - GRID_GUTTER * (GRID_COLUMNS - 1)) / GRID_COLUMNS : undefined;
  const tileHeight =
    frame.height > 0 ? (frame.height - GRID_GUTTER * (GRID_ROWS - 1)) / GRID_ROWS : undefined;

  return (
    <View
      testID="scan-stage-reading-grid"
      style={styles.grid}
      accessible={false}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        frameWidth.value = width;
        setFrame((current) =>
          current.width === width && current.height === height ? current : { width, height }
        );
      }}
    >
      {Array.from({ length: GRID_TILE_COUNT }, (_, index) => (
        <View
          key={index}
          testID={`scan-stage-grid-tile-${index}`}
          style={[
            styles.gridTile,
            tileWidth !== undefined && { width: tileWidth, height: tileHeight },
          ]}
        >
          <PlaceholderTile testID={`scan-stage-grid-placeholder-${index}`} />
        </View>
      ))}
      {shouldSweep ? (
        <Animated.View
          testID="scan-stage-sweep"
          pointerEvents="none"
          style={[styles.sweepBand, sweepStyle, frame.height > 0 && { height: frame.height }]}
        />
      ) : null}
    </View>
  );
}

interface ShelfRowProps {
  row: CountryPreviewRow;
  targetY: number;
  hasArrived: boolean;
  entering: boolean;
  reduceMotion: boolean;
}

function ShelfRow({ row, targetY, hasArrived, entering, reduceMotion }: ShelfRowProps) {
  const translateY = useSharedValue(hasArrived ? targetY : SHELF_VIEWPORT_HEIGHT);

  useEffect(() => {
    if (!hasArrived) {
      translateY.value = SHELF_VIEWPORT_HEIGHT;
      return;
    }
    if (reduceMotion) {
      translateY.value = targetY;
      return;
    }
    translateY.value = withSpring(targetY, SCAN_SLOT_FLY_IN_SPRING_CONFIG);
  }, [hasArrived, reduceMotion, targetY, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View
      testID={`scan-stage-row-${row.code}`}
      style={[
        styles.positionedRow,
        { opacity: hasArrived ? 1 : 0 },
        reduceMotion
          ? { transform: [{ translateY: hasArrived ? targetY : SHELF_VIEWPORT_HEIGHT }] }
          : animatedStyle,
      ]}
      accessible={hasArrived}
      accessibilityLabel={SCAN_COPY.trips.discovery(row.name)}
      accessibilityLiveRegion="polite"
      accessibilityElementsHidden={!hasArrived}
      importantForAccessibility={hasArrived ? 'auto' : 'no-hide-descendants'}
    >
      <CountryRow
        code={row.code}
        name={row.name}
        slots={buildSlots(row.code, row.previews)}
        entering={entering}
        reduceMotion={reduceMotion}
      />
    </Animated.View>
  );
}

function ScanStageComponent({ rows, isComplete, isPaused = false, reduceMotion }: ScanStageProps) {
  const announce = useStableCallback((row: CountryPreviewRow) => {
    if (Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(SCAN_COPY.trips.discovery(row.name));
    }
  });

  const { arrivedKeys, enteringKey } = useArrivalQueue({
    rows,
    isComplete,
    isPaused,
    onArrive: announce,
  });

  const showShelf = arrivedKeys.size > 0;
  const arrivedRows = rows.filter((row) => arrivedKeys.has(row.code));
  const firstVisibleIndex = Math.max(0, arrivedRows.length - VISIBLE_ROW_COUNT);
  const visiblePositions = new Map(
    arrivedRows.map((row, index) => [row.code, (index - firstVisibleIndex) * DISCOVERY_ROW_HEIGHT])
  );

  const gridOpacity = useSharedValue(showShelf ? 0 : 1);
  const shelfOpacity = useSharedValue(showShelf ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      gridOpacity.value = showShelf ? 0 : 1;
      shelfOpacity.value = showShelf ? 1 : 0;
      return;
    }
    gridOpacity.value = withTiming(showShelf ? 0 : 1, { duration: 280 });
    shelfOpacity.value = withTiming(showShelf ? 1 : 0, { duration: 280 });
  }, [gridOpacity, reduceMotion, shelfOpacity, showShelf]);

  const gridFadeStyle = useAnimatedStyle(() => ({ opacity: gridOpacity.value }));
  const shelfFadeStyle = useAnimatedStyle(() => ({ opacity: shelfOpacity.value }));

  return (
    <View
      testID="scan-stage"
      style={styles.root}
      pointerEvents="none"
      accessibilityRole="summary"
      accessibilityElementsHidden={isPaused}
      importantForAccessibility={isPaused ? 'no-hide-descendants' : 'auto'}
    >
      <Animated.View
        style={[styles.layer, gridFadeStyle, reduceMotion && { opacity: showShelf ? 0 : 1 }]}
        pointerEvents={showShelf ? 'none' : 'auto'}
      >
        <ReadingGrid reduceMotion={reduceMotion} active={!showShelf} />
      </Animated.View>

      <Animated.View
        style={[styles.layer, shelfFadeStyle, reduceMotion && { opacity: showShelf ? 1 : 0 }]}
        pointerEvents={showShelf ? 'auto' : 'none'}
      >
        <View testID="scan-stage-shelf" style={styles.shelfViewport}>
          {rows.map((row) => {
            const hasArrived = arrivedKeys.has(row.code);
            const targetY = visiblePositions.get(row.code) ?? SHELF_VIEWPORT_HEIGHT;
            return (
              <ShelfRow
                key={row.code}
                row={row}
                targetY={targetY}
                hasArrived={hasArrived}
                entering={enteringKey === row.code}
                reduceMotion={reduceMotion}
              />
            );
          })}
          <LinearGradient
            testID="scan-stage-top-mask"
            colors={[colors.warmCream, withAlpha(colors.warmCream, 0)]}
            style={styles.topMask}
            pointerEvents="none"
          />
        </View>
      </Animated.View>
    </View>
  );
}

export const ScanStage = memo(ScanStageComponent);
export default ScanStage;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  layer: {
    ...StyleSheet.absoluteFillObject,
  },
  grid: {
    flex: 1,
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GUTTER,
    alignContent: 'flex-start',
    padding: 12,
  },
  gridTile: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  placeholderTile: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.paperBeige,
    borderWidth: 1,
    borderColor: withAlpha(colors.stormGray, 0.18),
    borderRadius: 8,
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
  sweepBand: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 56,
    backgroundColor: withAlpha(colors.cloudWhite, 0.35),
  },
  shelfViewport: {
    flex: 1,
    width: '100%',
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  positionedRow: {
    position: 'absolute',
    top: 8,
    left: 12,
    right: 12,
    height: DISCOVERY_ROW_HEIGHT,
  },
  topMask: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: GRADIENT_MASK_HEIGHT,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
});
