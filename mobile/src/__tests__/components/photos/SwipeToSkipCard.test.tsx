/**
 * SwipeToSkipCard - full right-to-left swipe to skip a photo cluster.
 *
 * The headline test here is the recycling one. FlashList v2 pools cell instances
 * by item type and hands a pooled cell to a NEW item without remounting it, so any
 * gesture state held in the component survives into the next cluster. That is what
 * made a skipped card leave a "Skip" panel showing on unrelated cards further down
 * the list. `resets the drag offset when the cell is recycled` reproduces exactly
 * that, and fails against any implementation that does not reset on itemId change.
 *
 * These tests drive the pan through the Gesture.Pan() stub from jest.setup.js
 * rather than through real touches, so they verify the commit/reset wiring, not
 * the on-thread animation. Feel has to be checked on device.
 *
 * The recycle test asserts what the cell RENDERS, not what the shared value
 * holds. Those used to be the same thing, because the reset wrote `.value = 0`
 * during render - a Reanimated strict-mode violation that fired ~1,350 times on
 * one pass down the suggestions list. The offset now carries an owner tag and
 * the styles mask it, so a recycled cell paints at zero while the stale number
 * is still sitting in the shared value, untouched until the next drag.
 */

import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { SwipeToSkipCard } from '@screens/photos/components/SwipeToSkipCard';

const SCREEN_WIDTH = Dimensions.get('window').width;

/** The chainable stub returned by the most recent Gesture.Pan() call. */
type PanStub = {
  _onUpdate?: (e: { translationX: number }) => void;
  _onEnd?: (e: { velocityX: number }) => void;
  _enabled?: boolean;
};

const latestPan = (): PanStub => {
  const results = (Gesture.Pan as jest.Mock).mock.results;
  return results[results.length - 1].value as PanStub;
};

/** The shared value backing translateX (the first useSharedValue in the component). */
const translateX = (): { value: number } => {
  const results = (useSharedValue as unknown as jest.Mock).mock.results;
  return results[0].value as { value: number };
};

/**
 * The offset the card actually paints with: the first useAnimatedStyle worklet
 * is the card transform. The global mock returns `{}` without running the
 * worklet, so this file runs it.
 */
const renderedOffset = (): number => {
  const calls = (useAnimatedStyle as unknown as jest.Mock).mock.calls;
  const style = calls[calls.length - 2][0]() as { transform: [{ translateX: number }] };
  return style.transform[0].translateX;
};

const renderCard = (props: Partial<React.ComponentProps<typeof SwipeToSkipCard>> = {}) =>
  render(
    <SwipeToSkipCard itemId="cluster-a" onSkip={jest.fn()} {...props}>
      <Text>card</Text>
    </SwipeToSkipCard>
  );

describe('SwipeToSkipCard', () => {
  beforeEach(() => {
    (useAnimatedStyle as unknown as jest.Mock).mockImplementation((worklet: () => object) =>
      worklet()
    );
  });

  it('renders a recycled cell at zero without writing during render', () => {
    const { rerender } = renderCard({ itemId: 'cluster-a' });

    // Mid-drag: the user has pulled this card halfway open.
    latestPan()._onUpdate?.({ translationX: -140 });
    expect(translateX().value).toBe(-140);
    expect(renderedOffset()).toBe(-140);

    // FlashList hands this same pooled cell to a DIFFERENT cluster. No remount —
    // React reuses the instance because the pooled key and element type match.
    rerender(
      <SwipeToSkipCard itemId="cluster-b" onSkip={jest.fn()}>
        <Text>card</Text>
      </SwipeToSkipCard>
    );

    // Without a recycle-aware reset the incoming cluster inherits -140 and renders
    // already-swiped, showing a Skip panel the user never dragged.
    expect(renderedOffset()).toBe(0);
    // ...and the render phase touched no shared value to get there. This is the
    // half that regressed: a reset that "works" by writing during render trips
    // Reanimated strict mode on every recycled cell.
    expect(translateX().value).toBe(-140);
  });

  it('calls onSkip once when the swipe traverses past the commit threshold', () => {
    const onSkip = jest.fn();
    renderCard({ onSkip });

    latestPan()._onUpdate?.({ translationX: -0.9 * SCREEN_WIDTH });
    latestPan()._onEnd?.({ velocityX: 0 });

    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('commits on a fast leftward fling even when the drag is short', () => {
    const onSkip = jest.fn();
    renderCard({ onSkip });

    latestPan()._onUpdate?.({ translationX: -40 });
    latestPan()._onEnd?.({ velocityX: -1200 });

    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('does not skip on a partial drag - it springs back', () => {
    const onSkip = jest.fn();
    renderCard({ onSkip });

    latestPan()._onUpdate?.({ translationX: -40 });
    latestPan()._onEnd?.({ velocityX: 0 });

    expect(onSkip).not.toHaveBeenCalled();
    expect(translateX().value).toBe(0);
  });

  it('clamps a rightward drag so the card cannot be pulled off the other edge', () => {
    renderCard();

    latestPan()._onUpdate?.({ translationX: 120 });

    expect(translateX().value).toBe(0);
  });

  it('disables the gesture while the cluster is uploading', () => {
    renderCard({ enabled: false });

    expect(latestPan()._enabled).toBe(false);
  });
});
