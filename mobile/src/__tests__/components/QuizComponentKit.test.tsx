/**
 * Tests for the quiz component kit (design elevation Unit 0.1).
 *
 * Covers:
 * - SerifScore renders the score and total numerals (both sizes)
 * - VerdictMark renders distinguishable correct/incorrect badges with
 *   accessibility labels and the glyph marks
 * - PhotoHero renders its children above the photo + scrim
 * - QuizTopBar renders the frame every quiz screen wears: the feature title
 *   and a close button, in the same place on every screen
 */

import { Text } from 'react-native';

import { fireEvent, render, screen } from '../utils/testUtils';

import { PhotoHero, QuizTopBar, SerifScore, VerdictMark } from '@screens/quiz/components';

describe('SerifScore', () => {
  it('renders the score and total numerals', () => {
    render(<SerifScore score={8} total={10} testID="serif-score" />);

    expect(screen.getByTestId('serif-score')).toBeTruthy();
    expect(screen.getByText('8')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
  });

  it('renders at the small size', () => {
    render(<SerifScore score={3} total={5} size="small" />);

    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
  });
});

describe('VerdictMark', () => {
  it('renders the correct verdict as a labeled check', () => {
    render(<VerdictMark verdict="correct" testID="verdict-correct" />);

    expect(screen.getByLabelText('Correct')).toBeTruthy();
    expect(screen.getByText('✓')).toBeTruthy();
  });

  it('renders the incorrect verdict as a labeled X', () => {
    render(<VerdictMark verdict="incorrect" testID="verdict-incorrect" />);

    expect(screen.getByLabelText('Incorrect')).toBeTruthy();
    expect(screen.getByText('✕')).toBeTruthy();
  });
});

describe('PhotoHero', () => {
  it('renders children above the photo and scrim', () => {
    render(
      <PhotoHero source="https://cdn.example/photo.jpg" testID="photo-hero">
        <Text>Overlaid title</Text>
      </PhotoHero>
    );

    expect(screen.getByTestId('photo-hero')).toBeTruthy();
    expect(screen.getByText('Overlaid title')).toBeTruthy();
  });

  it('renders without children', () => {
    render(<PhotoHero source="https://cdn.example/photo.jpg" scrim="full" testID="photo-hero" />);

    expect(screen.getByTestId('photo-hero')).toBeTruthy();
  });
});

describe('QuizTopBar', () => {
  it('renders the title and a close button that reports the tap', () => {
    const onClose = jest.fn();
    render(<QuizTopBar title="Guess Where" onClose={onClose} testID="top-bar" />);

    expect(screen.getByText('Guess Where')).toBeTruthy();
    const close = screen.getByTestId('top-bar-close');
    fireEvent.press(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('labels the close button for assistive tech', () => {
    render(<QuizTopBar title="Guess Where" onClose={jest.fn()} />);

    expect(screen.getByLabelText('Close')).toBeTruthy();
  });

  it('renders over a light background too', () => {
    render(<QuizTopBar title="Guess Where" onClose={jest.fn()} variant="light" testID="bar" />);

    expect(screen.getByTestId('bar')).toBeTruthy();
    expect(screen.getByText('Guess Where')).toBeTruthy();
  });
});
