import { StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { DURATION_FAST } from '@screens/quiz/components/motionTokens';

import OnDeviceBeat from './OnDeviceBeat';
import PassportBeat from './PassportBeat';
import { DEFAULT_PERMISSION_BEAT_ASSETS, type PermissionBeatAssets } from './permissionBeatAssets';
import TripsFoundBeat from './TripsFoundBeat';

export type PermissionBeatStep = 1 | 2 | 3;

interface PermissionBeatVisualProps {
  step: PermissionBeatStep;
  reduceMotion: boolean;
  homeCountry?: string | null;
  assets?: PermissionBeatAssets;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported permission beat: ${String(value)}`);
}

export default function PermissionBeatVisual({
  step,
  reduceMotion,
  homeCountry,
  assets = DEFAULT_PERMISSION_BEAT_ASSETS,
}: PermissionBeatVisualProps) {
  let beat;

  switch (step) {
    case 1:
      beat = <TripsFoundBeat isActive reduceMotion={reduceMotion} assets={assets} />;
      break;
    case 2:
      beat = <OnDeviceBeat isActive reduceMotion={reduceMotion} assets={assets} />;
      break;
    case 3:
      beat = (
        <PassportBeat
          isActive
          reduceMotion={reduceMotion}
          homeCountry={homeCountry}
          assets={assets}
        />
      );
      break;
    default:
      return assertNever(step);
  }

  return (
    <Animated.View
      key={step}
      style={styles.container}
      entering={reduceMotion ? undefined : FadeIn.duration(DURATION_FAST)}
      exiting={reduceMotion ? undefined : FadeOut.duration(DURATION_FAST)}
      accessible={false}
      pointerEvents="none"
    >
      {beat}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    minHeight: 280,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
