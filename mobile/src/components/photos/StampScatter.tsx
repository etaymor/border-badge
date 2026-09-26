/**
 * StampScatter - found countries as stamps scattered across the stage card.
 *
 * Each country is its stamp and the one or two photos tucked behind it,
 * scrapbook-style. No names: the stamp is the label. The country name lives
 * only in the accessibility label, always as the full name, never a code.
 *
 * Shared by the live scan (`ScanStage`, stamps arrive as the scan finds them)
 * and carousel beat 3 (`PassportBeat`, a demo set on a loop), so the promise
 * and the real thing are the same picture.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  Extrapolation,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

import { getStampImage } from '../../assets/stampImages';
import { colors, withAlpha } from '@constants/colors';

import {
  PERMISSION_CLOCK_STILL,
  permissionFadeAt,
  permissionPopAt,
  type PermissionBeatTiming,
} from './permissionBeats/usePermissionBeatFade';
import { SCAN_SLOT_FLY_IN_SPRING_CONFIG } from './scanMotion';
import { useStageInsets } from './StageHero';
import {
  TUCKED_PHOTO_OFFSETS,
  hashString,
  layoutStampScatter,
  stampTilt,
  type StampAnchor,
} from './stampScatterLayout';

interface StampScatterGeometry {
  stampSize: number;
  photoSize: number;
}

/**
 * How a stamp's pop is driven.
 * - `hidden` / `settled`: static (not yet arrived / already on the page).
 * - `enter`: spring in once (live scan arrival).
 * - `loop`: pop at `order` on the beat's shared clock, fade with the rest,
 *   repeat (carousel beat 3). The clock is the beat's, so every stamp and
 *   the fade stay in lockstep.
 *
 * A given stamp's kind only ever moves forward (hidden -> enter), so the
 * effect below keys on primitives and never restarts a pop mid-flight.
 */
export type StampDrive =
  | { kind: 'hidden' }
  | { kind: 'settled' }
  | { kind: 'enter' }
  | { kind: 'loop'; clock: SharedValue<number>; order: number; timing: PermissionBeatTiming };

export interface StampScatterItem {
  code: string;
  drive: StampDrive;
  /** Rendered behind the stamp; at most two are used. */
  photos: readonly ReactNode[];
  accessibilityLabel?: string;
}

interface StampScatterProps {
  items: readonly StampScatterItem[];
  reduceMotion: boolean;
  /**
   * Stamps on the page at once; sets their size (fewer = bigger). Past it,
   * each new stamp takes the spot of the oldest, which fades away.
   */
  capacity: number;
  /** Seeds the jitter. Keep stable for the life of one scan. */
  seed?: number;
  testID?: string;
}

/** Stamp lands first; its photos slide out from under it after. */
const PHOTO_START = 0.45;
const SETTLE_TILT_SWING = 18;
const STAMP_EXIT_MS = 450;
const NO_TIMING: PermissionBeatTiming = { count: 0, stagger: 0 };

/** What a stamp's animation reads: the beat clock when looping, else its own value. */
interface StampMotion {
  clock: SharedValue<number>;
  own: SharedValue<number>;
  isLoop: boolean;
  order: number;
  timing: PermissionBeatTiming;
}

function readPop(motion: StampMotion): number {
  'worklet';
  return motion.isLoop
    ? permissionPopAt(motion.clock.value, motion.order, motion.timing.stagger)
    : motion.own.value;
}

function readFade(motion: StampMotion): number {
  'worklet';
  return motion.isLoop ? permissionFadeAt(motion.clock.value, motion.timing) : 1;
}

interface ScatterStampProps {
  item: StampScatterItem;
  anchor: StampAnchor;
  geometry: StampScatterGeometry;
  reduceMotion: boolean;
  zIndex: number;
}

function ScatterStamp({ item, anchor, geometry, reduceMotion, zIndex }: ScatterStampProps) {
  const code = item.code.toUpperCase();
  const stampImage = getStampImage(code);
  const tilt = stampTilt(code);
  const swing = tilt >= 0 ? SETTLE_TILT_SWING : -SETTLE_TILT_SWING;
  const { drive } = item;
  const driveKind = drive.kind;
  const stillClock = useSharedValue(PERMISSION_CLOCK_STILL);
  const isLoop = drive.kind === 'loop' && !reduceMotion;
  const clock = drive.kind === 'loop' ? drive.clock : stillClock;
  const loopOrder = drive.kind === 'loop' ? drive.order : 0;
  const loopTiming = drive.kind === 'loop' ? drive.timing : NO_TIMING;
  const startsVisible = driveKind === 'settled' || (reduceMotion && driveKind !== 'hidden');
  const own = useSharedValue(startsVisible ? 1 : 0);

  useEffect(() => {
    if (driveKind === 'loop') return;
    if (driveKind === 'hidden') {
      own.value = 0;
      return;
    }
    if (driveKind === 'settled' || reduceMotion) {
      own.value = 1;
      return;
    }
    own.value = 0;
    own.value = withSpring(1, SCAN_SLOT_FLY_IN_SPRING_CONFIG);
  }, [driveKind, own, reduceMotion]);

  const motion: StampMotion = { clock, own, isLoop, order: loopOrder, timing: loopTiming };

  const stampStyle = useAnimatedStyle(() => {
    const progress = readPop(motion);
    return {
      opacity: interpolate(progress, [0, 0.15], [0, 1], Extrapolation.CLAMP) * readFade(motion),
      transform: [
        { scale: interpolate(progress, [0, 1], [0.2, 1]) },
        { rotate: `${interpolate(progress, [0, 1], [tilt + swing, tilt])}deg` },
      ],
    };
  });

  const { stampSize, photoSize } = geometry;
  const photos = item.photos.slice(0, TUCKED_PHOTO_OFFSETS.length);

  return (
    <Animated.View
      testID={`stamp-scatter-${code}`}
      pointerEvents="none"
      exiting={reduceMotion ? undefined : FadeOut.duration(STAMP_EXIT_MS)}
      style={[
        styles.group,
        {
          left: anchor.x - stampSize / 2,
          top: anchor.y - stampSize / 2,
          width: stampSize,
          height: stampSize,
          zIndex,
        },
      ]}
      accessible={drive.kind !== 'hidden' && item.accessibilityLabel !== undefined}
      accessibilityLabel={item.accessibilityLabel}
      accessibilityElementsHidden={drive.kind === 'hidden'}
      importantForAccessibility={drive.kind === 'hidden' ? 'no-hide-descendants' : 'auto'}
    >
      {photos.map((photo, index) => (
        <TuckedPhoto
          key={index}
          code={code}
          index={index}
          motion={motion}
          stampSize={stampSize}
          photoSize={photoSize}
        >
          {photo}
        </TuckedPhoto>
      ))}
      <Animated.View style={[styles.stampWrap, stampStyle]}>
        {stampImage ? (
          <Image
            testID={`stamp-scatter-stamp-${code}`}
            source={stampImage}
            style={styles.stamp}
            contentFit="contain"
            recyclingKey={code}
            cachePolicy="memory-disk"
            accessible={false}
          />
        ) : (
          <View testID={`stamp-scatter-stamp-fallback-${code}`} style={styles.stampFallback} />
        )}
      </Animated.View>
    </Animated.View>
  );
}

interface TuckedPhotoProps {
  code: string;
  index: number;
  motion: StampMotion;
  stampSize: number;
  photoSize: number;
  children: ReactNode;
}

function TuckedPhoto({ code, index, motion, stampSize, photoSize, children }: TuckedPhotoProps) {
  const offset = TUCKED_PHOTO_OFFSETS[index];
  const targetX = offset.x * stampSize;
  const targetY = offset.y * stampSize;

  const animatedStyle = useAnimatedStyle(() => {
    const photoProgress = interpolate(
      readPop(motion),
      [PHOTO_START, 1],
      [0, 1],
      Extrapolation.CLAMP
    );
    return {
      opacity: photoProgress * readFade(motion),
      transform: [
        { translateX: photoProgress * targetX },
        { translateY: photoProgress * targetY },
        { rotate: `${photoProgress * offset.rotation}deg` },
        { scale: interpolate(photoProgress, [0, 1], [0.5, 1]) },
      ],
    };
  });

  return (
    <Animated.View
      testID={`stamp-scatter-photo-${code}-${index}`}
      style={[
        styles.photoFrame,
        {
          width: photoSize,
          height: photoSize,
          left: (stampSize - photoSize) / 2,
          top: (stampSize - photoSize) / 2,
        },
        animatedStyle,
      ]}
    >
      <View style={styles.photoInner}>{children}</View>
    </Animated.View>
  );
}

export function StampScatter({
  items,
  reduceMotion,
  capacity,
  seed,
  testID = 'stamp-scatter',
}: StampScatterProps) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useStageInsets();
  // Estimate the stage until its first layout so stamps land on frame one.
  const [frame, setFrame] = useState(() => ({
    width: windowWidth,
    height: Math.round(windowHeight * 0.55),
  }));
  const layoutSeed = seed ?? hashString(items[0]?.code ?? '');
  const { stampSize, photoSize, anchors } = layoutStampScatter(
    {
      width: frame.width,
      height: frame.height,
      top: insets.top,
      bottom: insets.bottom,
      corner: insets.corner,
    },
    capacity,
    layoutSeed
  );

  // Slot i % capacity; a stamp leaves once a newer one on its slot has landed.
  const lastLandedOnSlot = new Map<number, number>();
  items.forEach((item, index) => {
    if (item.drive.kind !== 'hidden') lastLandedOnSlot.set(index % capacity, index);
  });

  return (
    <View
      testID={testID}
      style={styles.root}
      pointerEvents="none"
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setFrame((current) =>
          current.width === width && current.height === height ? current : { width, height }
        );
      }}
    >
      {items.map((item, index) => {
        const slot = index % capacity;
        const anchor = anchors[slot];
        if (!anchor) return null;
        if ((lastLandedOnSlot.get(slot) ?? index) > index) return null;
        return (
          <ScatterStamp
            key={item.code}
            item={item}
            anchor={anchor}
            geometry={{ stampSize, photoSize }}
            reduceMotion={reduceMotion}
            zIndex={index + 1}
          />
        );
      })}
    </View>
  );
}

export default StampScatter;

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
  },
  group: {
    position: 'absolute',
  },
  stampWrap: {
    width: '100%',
    height: '100%',
    shadowColor: colors.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  stamp: {
    width: '100%',
    height: '100%',
  },
  stampFallback: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.stormGray,
  },
  photoFrame: {
    position: 'absolute',
    padding: 3,
    borderRadius: 6,
    backgroundColor: colors.white,
    shadowColor: colors.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  photoInner: {
    flex: 1,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: withAlpha(colors.midnightNavy, 0.12),
  },
});
