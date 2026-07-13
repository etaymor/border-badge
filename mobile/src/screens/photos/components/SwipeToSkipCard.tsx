/**
 * SwipeToSkipCard - full right-to-left swipe to skip a photo cluster.
 *
 * Wraps the cluster cards in the photo-import suggestions list. Replaces the
 * legacy `Swipeable` the three cards each used to embed, for three reasons:
 *
 * 1. It runs on the UI thread. Legacy Swipeable drives its drag through the old
 *    Animated API on the JS thread, and fired its dismiss mid-spring.
 * 2. There is no latch. A partial drag springs back; only a full traverse (or a
 *    fling) commits. There is no half-open "Skip" panel left sitting under a
 *    finger to tap by accident.
 * 3. It survives cell recycling. FlashList v2 pools cells by item type and hands
 *    a pooled cell to a new item WITHOUT remounting it, so the class Swipeable's
 *    open state leaked into whatever cluster came next. `useRecyclingState` resets
 *    translateX during the render that reassigns the cell, before it paints.
 *
 * NEVER animate this card's height. FlashList's ViewHolder puts an onLayout on
 * every cell, which routes to validateItemSize -> recyclerViewContext.layout()
 * and recomputes the layout of every row below. A per-frame height change would
 * run that whole pass ~60x/sec. The gap left by a skipped card is closed instead
 * by a single LayoutAnimation at removal time -- see commitSkip.
 */

import { ReactNode, useCallback } from 'react';
import { Dimensions, LayoutAnimation, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useRecyclingState } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { colors } from '@constants/colors';
// The project's own hook, not Reanimated's: it shares ONE AccessibilityInfo
// listener across every subscriber. Reanimated's would attach a listener per
// card, which is the exact scaling problem that hook was written to solve.
import { useReducedMotion } from '@hooks/useReducedMotion';

const SCREEN_WIDTH = Dimensions.get('window').width;
/** Drag past this fraction of the screen and release to commit the skip. */
const COMMIT_FRACTION = 0.45;
/** ...or fling left faster than this, however short the drag. */
const FLING_VELOCITY = -800;
const EXIT_MS = 200;
const GAP_MS = 220;
/** Matches cardStyles.suggestionCard marginBottom, so the panel stays inside the card. */
const CARD_MARGIN_BOTTOM = 24;
/** Matches cardStyles.suggestionCard borderRadius. */
const CARD_RADIUS = 20;

export interface SwipeToSkipCardProps {
  /** Stable item identity. A change means FlashList recycled this cell. */
  itemId: string;
  /** Fired once, after the card has slid fully off-screen. */
  onSkip: () => void;
  /** Suppress the gesture (e.g. while the cluster is uploading). */
  enabled?: boolean;
  children: ReactNode;
}

export function SwipeToSkipCard({
  itemId,
  onSkip,
  enabled = true,
  children,
}: SwipeToSkipCardProps) {
  const translateX = useSharedValue(0);
  const reducedMotion = useReducedMotion();

  // The recycling fix. useRecyclingState runs this reset inside a useMemo keyed on
  // itemId -- i.e. during the render that hands this cell to a new cluster, before
  // it paints. A useEffect would land a frame too late and flash the previous
  // cluster's drag offset, which is the bug being fixed.
  useRecyclingState(0, [itemId], () => {
    translateX.value = 0;
  });

  const commitSkip = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Close the gap in a single layout settle. The card is already off-screen, so
    // removing it from the list is invisible; this animates the rows below up into
    // the space it left.
    LayoutAnimation.configureNext({
      duration: GAP_MS,
      update: { type: LayoutAnimation.Types.easeInEaseOut },
    });
    onSkip();
  }, [onSkip]);

  const pan = Gesture.Pan()
    .enabled(enabled)
    // Horizontal intent only. activeOffsetX keeps a vertical flick scrolling the
    // list; failOffsetY makes a diagonal drag resolve to a scroll rather than a
    // half-swipe. A tap travels ~0px, so the pan never claims it and the hero
    // photo / chevrons / action buttons keep working.
    .activeOffsetX([-12, 12])
    .failOffsetY([-8, 8])
    .onUpdate((e) => {
      // Left-only: clamp any rightward drag so the card can't leave the other edge.
      translateX.value = Math.min(0, e.translationX);
    })
    .onEnd((e) => {
      const traversed = translateX.value < -SCREEN_WIDTH * COMMIT_FRACTION;
      const flung = e.velocityX < FLING_VELOCITY;

      if (!traversed && !flung) {
        translateX.value = withSpring(0, { damping: 20, stiffness: 220 });
        return;
      }

      // Slide fully off-screen and only THEN drop the item from state, so the
      // removal never races the animation.
      translateX.value = withTiming(
        -SCREEN_WIDTH,
        { duration: reducedMotion ? 0 : EXIT_MS },
        (finished) => {
          if (finished) runOnJS(commitSkip)();
        }
      );
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  // Skip panel revealed behind the card, intensifying as the card is dragged clear.
  const panelStyle = useAnimatedStyle(() => {
    const progress = Math.min(1, -translateX.value / (SCREEN_WIDTH * COMMIT_FRACTION));
    return { opacity: interpolate(progress, [0, 0.25, 1], [0, 0.6, 1]) };
  });

  return (
    <View style={localStyles.container}>
      <Animated.View style={[localStyles.skipPanel, panelStyle]} pointerEvents="none">
        <Ionicons name="close-circle" size={28} color={colors.white} />
        <Text style={localStyles.skipText}>Skip</Text>
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={cardStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const localStyles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  skipPanel: {
    ...StyleSheet.absoluteFillObject,
    bottom: CARD_MARGIN_BOTTOM,
    backgroundColor: colors.adobeBrick,
    borderRadius: CARD_RADIUS,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 32,
  },
  skipText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
});
