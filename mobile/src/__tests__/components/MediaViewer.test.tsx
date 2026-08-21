/**
 * MediaViewer + PinchZoomView (Unit 1.2 extraction).
 *
 * PinchZoomView is the app's single pinch-to-zoom implementation, extracted
 * from MediaViewer's per-photo item so the quiz PhotoInspector can share the
 * exact same math. The gesture handlers are driven through the Gesture.Pinch /
 * Gesture.Pan stubs from jest.setup.js - the only way to exercise a gesture
 * without a real touch system - so these tests verify the zoom/pan wiring and
 * clamping, not on-thread feel (that is an on-device check).
 */

import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Gesture } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';

import { MediaViewer, PinchZoomView } from '@components/media';
import type { MediaFile } from '@hooks/useMedia';

type GestureStub = {
  _onUpdate?: (e: Record<string, number>) => void;
  _onEnd?: (e?: Record<string, number>) => void;
};

/** The chainable stub returned by the most recent Gesture.<kind>() call. */
const latestGesture = (kind: 'Pinch' | 'Pan'): GestureStub => {
  const results = (Gesture[kind] as jest.Mock).mock.results;
  return results[results.length - 1].value as GestureStub;
};

/**
 * The shared values backing PinchZoomView, in declaration order:
 * scale, translateX, translateY. Index from the FIRST render - the mocked
 * useSharedValue returns the same object across re-renders.
 */
const sharedValues = () => {
  const results = (useSharedValue as unknown as jest.Mock).mock.results;
  return {
    scale: results[0].value as { value: number },
    translateX: results[1].value as { value: number },
    translateY: results[2].value as { value: number },
  };
};

function makeMedia(overrides?: Partial<MediaFile>): MediaFile {
  return {
    id: 'media-1',
    owner_id: 'user-1',
    file_path: 'user-1/media-1.jpg',
    status: 'uploaded',
    created_at: '2024-06-01T00:00:00Z',
    url: 'https://cdn.example/media-1.jpg',
    thumbnail_url: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('PinchZoomView', () => {
  it('renders its children', () => {
    render(
      <PinchZoomView testID="pinch-zoom">
        <Text>photo</Text>
      </PinchZoomView>
    );

    expect(screen.getByTestId('pinch-zoom')).toBeTruthy();
    expect(screen.getByText('photo')).toBeTruthy();
  });

  it('pinch scales the content, clamped between 1x and the max zoom', () => {
    render(
      <PinchZoomView>
        <Text>photo</Text>
      </PinchZoomView>
    );
    const pinch = latestGesture('Pinch');
    const { scale } = sharedValues();

    pinch._onUpdate?.({ scale: 2 });
    expect(scale.value).toBe(2);

    // Overshoot clamps rather than letting the photo blow out.
    pinch._onUpdate?.({ scale: 40 });
    expect(scale.value).toBeLessThanOrEqual(6);

    // Pinching inward never shrinks below the fitted size.
    pinch._onUpdate?.({ scale: 0.3 });
    expect(scale.value).toBe(1);
  });

  it('the zoom springs back to the fitted size when the pinch ends', () => {
    render(
      <PinchZoomView>
        <Text>photo</Text>
      </PinchZoomView>
    );
    const pinch = latestGesture('Pinch');
    const { scale } = sharedValues();

    pinch._onUpdate?.({ scale: 3 });
    expect(scale.value).toBe(3);

    // The mocked withSpring settles immediately.
    pinch._onEnd?.();
    expect(scale.value).toBe(1);
  });

  it('pan moves the photo only while zoomed, and springs home on release', () => {
    render(
      <PinchZoomView>
        <Text>photo</Text>
      </PinchZoomView>
    );
    const pinch = latestGesture('Pinch');
    const pan = latestGesture('Pan');
    const { scale, translateX, translateY } = sharedValues();

    // Not zoomed: a drag does not move the photo (the outer surface keeps
    // its own swipe/tap semantics).
    pan._onUpdate?.({ translationX: 40, translationY: 18 });
    expect(translateX.value).toBe(0);
    expect(translateY.value).toBe(0);

    // Zoomed: the drag pans the photo.
    pinch._onUpdate?.({ scale: 2 });
    expect(scale.value).toBe(2);
    pan._onUpdate?.({ translationX: 40, translationY: 18 });
    expect(translateX.value).toBe(40);
    expect(translateY.value).toBe(18);

    // Release springs the photo back home (mocked springs settle immediately).
    pan._onEnd?.();
    expect(translateX.value).toBe(0);
    expect(translateY.value).toBe(0);
  });
});

describe('MediaViewer', () => {
  it('shows the photo with the pinch-to-zoom surface and closes from the header', () => {
    const onClose = jest.fn();
    render(<MediaViewer visible media={[makeMedia()]} onClose={onClose} />);

    // The photo item keeps its long-standing zoom affordance label.
    expect(screen.getByLabelText('Photo. Swipe up or down to dismiss, pinch to zoom')).toBeTruthy();
    expect(screen.getByLabelText('Image 1 of 1')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Close image viewer'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('delete reports the current media id and closes when it was the last photo', () => {
    const onClose = jest.fn();
    const onDelete = jest.fn();
    render(<MediaViewer visible media={[makeMedia()]} onClose={onClose} onDelete={onDelete} />);

    fireEvent.press(screen.getByLabelText('Delete this image'));
    expect(onDelete).toHaveBeenCalledWith('media-1');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
