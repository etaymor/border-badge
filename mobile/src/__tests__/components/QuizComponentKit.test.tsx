/**
 * Tests for the quiz component kit (design elevation Unit 0.1).
 *
 * Covers:
 * - SerifScore renders the score and total numerals (both sizes)
 * - VerdictMark renders distinguishable correct/incorrect badges with
 *   accessibility labels and the glyph marks
 * - PhotoHero renders its children above the photo + scrim
 */

import { Text } from 'react-native';

import { render, screen } from '../utils/testUtils';

import { PhotoHero, SerifScore, VerdictMark } from '@screens/quiz/components';

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
