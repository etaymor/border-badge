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
 *    open state leaked into whatever cluster came next.
 *
 * HOW THE RECYCLE RESET WORKS, AND WHY IT IS NOT `useRecyclingState`. That hook
 * runs its reset inside a `useMemo`, i.e. DURING RENDER, and the reset here has
 * to clear a Reanimated shared value. Writing to `.value` in the render phase is
 * exactly what Reanimated's strict mode forbids and what the React Compiler may
 * memoize around (CLAUDE.md note 10); on the suggestions list it fired ~1,350
 * times per screen, each one serializing a stack trace to the console.
 *
 * So nothing is written during render. The offset carries an OWNER tag, and the
 * animated styles ignore it whenever the owner is not the item currently in the
 * cell. `useAnimatedStyle` re-evaluates when `itemId` changes, so a recycled cell
 * paints at zero on the same frame the reset used to happen - without a write.
 * The stale value is cleared on the UI thread when the next drag claims the cell.
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
  /** Which item `translateX` belongs to. See the recycle note in the header. */
  const ownerId = useSharedValue(itemId);
  const reducedMotion = useReducedMotion();

  /** Read the offset only when it belongs to the item currently in this cell. */
  const ownedOffset = (): number => {
    'worklet';
    return ownerId.value === itemId ? translateX.value : 0;
  };

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
      // Claim the pooled cell, on the UI thread. A recycled cell may still be
      // holding the previous cluster's offset - the styles already mask it, and
      // this is where it is actually cleared.
      ownerId.value = itemId;
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

  const cardStyle = useAnimatedStyle(
    () => ({ transform: [{ translateX: ownedOffset() }] }),
    [itemId]
  );

  // Skip panel revealed behind the card, intensifying as the card is dragged clear.
  const panelStyle = useAnimatedStyle(() => {
    const progress = Math.min(1, -ownedOffset() / (SCREEN_WIDTH * COMMIT_FRACTION));
    return { opacity: interpolate(progress, [0, 0.25, 1], [0, 0.6, 1]) };
  }, [itemId]);

  return (
    // R28: rows do NOT announce. A large import resolves dozens of rows within a
    // second or two, and a live region on each one would flood a screen reader
    // with overlapping announcements. The progress header is the single
    // announcing surface; the cards stay readable on focus, just not automatic.
    <View style={localStyles.container} accessibilityLiveRegion="none">
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
