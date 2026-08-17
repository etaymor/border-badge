/**
 * PhotoInspector (Unit 1.2) - the tap-to-inspect overlay for the play screen.
 *
 * A full-screen navy layer showing the question photo aspect-fit with the
 * shared PinchZoomView zoom surface. Purely visual: it owns no game state, so
 * the play screen integration tests (QuizPlay.test.tsx) carry the proof that
 * opening/closing never disturbs selection or the answer lock. Here: the
 * overlay's own contract - aspect-fit photo, tap-to-close on the surface, the
 * glass close affordance, and the reduced-motion path.
 *
 * Recorded exception: the fade at DURATION_BASE vs. plain swap under reduce
 * motion is not observable under the jest reanimated mock (entering/exiting
 * builders are stripped); the reduced-motion test asserts the overlay still
 * functions, and the actual fade is part of the on-device pass.
 */

import { fireEvent, render, screen } from '../../utils/testUtils';

// expo-image renders through a native component; mock it to a plain RN Image
// (same approach as QuizPlay.test.tsx) so contentFit/source stay inspectable.
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
jest.mock('expo-image', () => {
  const React = require('react');
  const { Image: RNImage } = require('react-native');
  const MockImage = (props: Record<string, unknown>) => React.createElement(RNImage, props);
  MockImage.prefetch = jest.fn(() => Promise.resolve(true));
  return { Image: MockImage };
});
/* eslint-enable @typescript-eslint/no-require-imports */

jest.mock('@hooks/useReducedMotion', () => ({
  useReducedMotion: jest.fn(() => false),
}));

import { useReducedMotion } from '@hooks/useReducedMotion';
import { PhotoInspector } from '@screens/quiz/components';

const mockUseReducedMotion = useReducedMotion as jest.MockedFunction<typeof useReducedMotion>;

const URI = 'https://cdn.example/quiz/q0.jpg';

beforeEach(() => {
  jest.clearAllMocks();
  mockUseReducedMotion.mockReturnValue(false);
});

describe('PhotoInspector', () => {
  it('shows the full photo aspect-fit on the navy stage', () => {
    render(<PhotoInspector uri={URI} onClose={jest.fn()} />);

    expect(screen.getByTestId('quiz-photo-inspector')).toBeTruthy();
    const image = screen.getByTestId('quiz-photo-inspector-image');
    expect(image.props.source.uri).toBe(URI);
    // Aspect-fit: the whole photo is visible, never cropped.
    expect(image.props.contentFit).toBe('contain');
  });

  it('tapping the photo surface closes the inspector', () => {
    const onClose = jest.fn();
    render(<PhotoInspector uri={URI} onClose={onClose} />);

    fireEvent.press(screen.getByTestId('quiz-photo-inspector-surface'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the glass close affordance closes the inspector', () => {
    const onClose = jest.fn();
    render(<PhotoInspector uri={URI} onClose={onClose} />);

    fireEvent.press(screen.getByTestId('quiz-photo-inspector-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('still renders and closes under reduce motion (plain swap path)', () => {
    mockUseReducedMotion.mockReturnValue(true);
    const onClose = jest.fn();
    render(<PhotoInspector uri={URI} onClose={onClose} />);

    expect(screen.getByTestId('quiz-photo-inspector')).toBeTruthy();
    fireEvent.press(screen.getByTestId('quiz-photo-inspector-surface'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
