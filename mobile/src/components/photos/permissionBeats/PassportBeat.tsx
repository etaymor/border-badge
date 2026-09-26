import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { StampScatter, type StampScatterItem } from '@components/photos/StampScatter';
import { colors, withAlpha } from '@constants/colors';

import {
  DEFAULT_PERMISSION_BEAT_ASSETS,
  PERMISSION_BEAT_DEMO_COUNTRIES,
  type PermissionBeatAssets,
} from './permissionBeatAssets';
import { PERMISSION_SHELF_STAGGER } from './permissionMotion';
import { usePermissionBeatClock } from './usePermissionBeatFade';

const SLOTS_PER_STAMP = 2;
/** Fixed so the demo page looks the same every time the carousel shows it. */
const DEMO_SCATTER_SEED = 7;

interface PassportBeatProps {
  isActive: boolean;
  reduceMotion: boolean;
  homeCountry?: string | null;
  assets?: PermissionBeatAssets;
}

/**
 * Beat 3: the demo countries pop onto the card as stamps with their photos
 * tucked behind — the same `StampScatter` the live scan uses. No names.
 */
export default function PassportBeat({
  isActive,
  reduceMotion,
  homeCountry,
  assets = DEFAULT_PERMISSION_BEAT_ASSETS,
}: PassportBeatProps) {
  const normalizedHomeCountry = homeCountry?.trim().toUpperCase();
  const countries = PERMISSION_BEAT_DEMO_COUNTRIES.filter(
    ({ code }) => code !== normalizedHomeCountry
  );
  const shouldAnimate = isActive && !reduceMotion;
  const timing = { count: countries.length, stagger: PERMISSION_SHELF_STAGGER * 2 };
  const clock = usePermissionBeatClock(shouldAnimate, timing);

  const items: StampScatterItem[] = countries.map(({ code }, order) => ({
    code,
    drive: shouldAnimate ? { kind: 'loop', clock, order, timing } : { kind: 'settled' },
    photos: Array.from({ length: SLOTS_PER_STAMP }, (_, slotIndex) => {
      const source = assets.beat3?.[code]?.[slotIndex];
      return source ? (
        <Image
          key={slotIndex}
          testID={`permission-beat3-image-${code}-${slotIndex}`}
          source={source}
          style={styles.photo}
          contentFit="cover"
        />
      ) : (
        <View
          key={slotIndex}
          testID={`permission-beat-placeholder-beat3-${code}-${slotIndex}`}
          style={[styles.photo, styles.placeholder]}
        />
      );
    }),
  }));

  return (
    // Stamps straight on the navy stage; the beat clock pops and fades them.
    <View testID="permission-beat-3" style={styles.page} accessible={false}>
      <StampScatter
        items={items}
        reduceMotion={reduceMotion}
        capacity={Math.max(1, countries.length)}
        seed={DEMO_SCATTER_SEED}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    ...StyleSheet.absoluteFillObject,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    backgroundColor: withAlpha(colors.midnightNavy, 0.12),
  },
});
