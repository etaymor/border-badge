/**
 * PhotoInspector - tap-to-inspect for the play screen (Unit 1.2).
 *
 * A full-screen layer on the navy stage that covers the play interface
 * entirely: the question photo aspect-fit, pinch-to-zoom via the shared
 * PinchZoomView (the same math MediaViewer uses), and two ways back - tap the
 * photo, or the glass close affordance the quiz screens already use.
 *
 * Purely visual by design: it holds no game state and issues no requests, so
 * opening and closing can never disturb selection, the answer lock, or the
 * watchdog on the play screen underneath. Open/close fades at DURATION_BASE;
 * under reduce motion it is a plain swap.
 */

// Same rationale as the play screen: expo-image shares the decoded bitmap via
// recyclingKey + cache instead of re-decoding the full-resolution asset.
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { PinchZoomView } from '@components/media';
import { GlassBackButton } from '@components/ui/GlassBackButton';
import { colors } from '@constants/colors';
import { useReducedMotion } from '@hooks/useReducedMotion';

import { DURATION_BASE } from './motionTokens';

interface PhotoInspectorProps {
  /** The photo to inspect, full size and aspect-fit. */
  uri: string;
  /** Share the decode with the play stage (expo-image recyclingKey). */
  recyclingKey?: string;
  onClose: () => void;
  testID?: string;
}

export function PhotoInspector({
  uri,
  recyclingKey,
  onClose,
  testID = 'quiz-photo-inspector',
}: PhotoInspectorProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(DURATION_BASE)}
      exiting={reduceMotion ? undefined : FadeOut.duration(DURATION_BASE)}
      style={styles.overlay}
      testID={testID}
    >
      <Pressable
        style={styles.stage}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close the photo and return to the question"
        testID={`${testID}-surface`}
      >
        <PinchZoomView style={styles.zoomLayer} accessibilityLabel="Challenge photo, pinch to zoom">
          <Image
            source={{ uri }}
            style={styles.photo}
            contentFit="contain"
            recyclingKey={recyclingKey}
            cachePolicy="memory-disk"
            testID={`${testID}-image`}
          />
        </PinchZoomView>
      </Pressable>

      <View style={[styles.closeHolder, { top: insets.top + 8 }]}>
        <GlassBackButton
          icon="close"
          variant="dark"
          size="small"
          onPress={onClose}
          testID={`${testID}-close`}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.midnightNavy,
  },
  stage: {
    flex: 1,
  },
  zoomLayer: {
    flex: 1,
  },
  photo: {
    flex: 1,
    width: '100%',
  },
  closeHolder: {
    position: 'absolute',
    left: 16,
  },
});
