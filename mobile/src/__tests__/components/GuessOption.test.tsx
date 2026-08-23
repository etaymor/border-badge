/**
 * Tests for GuessOption - the play screen answer card.
 *
 * The settled product decision (Q8) is an end-only reveal: the tapped option
 * gets a NEUTRAL acknowledgment - warm-cream card compresses to a solid
 * midnight-navy card - and must never take on verdict styling (no green, no
 * correct/incorrect treatment) while the game is in flight.
 */

import { StyleSheet } from 'react-native';

import { render, screen } from '../utils/testUtils';

import { colors } from '@constants/colors';
import { GuessOption, GuessOptionGrid } from '@screens/quiz/components/GuessOption';

function flattenedStyle(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style);
}

describe('GuessOption', () => {
  it('rests as a warm-cream card with navy text', () => {
    render(<GuessOption label="France" onPress={jest.fn()} testID="opt" />);

    const style = flattenedStyle('opt');
    expect(style.backgroundColor).toBe(colors.warmCream);
    expect(StyleSheet.flatten(screen.getByText('France').props.style).color).toBe(
      colors.midnightNavy
    );
    expect(screen.getByTestId('opt').props.accessibilityState.selected).toBe(false);
  });

  it('acknowledges selection with a neutral navy card - never a verdict color', () => {
    render(<GuessOption label="France" onPress={jest.fn()} selected testID="opt" />);

    const style = flattenedStyle('opt');
    // Neutral acknowledgment: solid midnight navy with warm-cream text.
    expect(style.backgroundColor).toBe(colors.midnightNavy);
    expect(StyleSheet.flatten(screen.getByText('France').props.style).color).toBe(colors.warmCream);
    // No verdict styling leaks into the selected state (end-only reveal, Q8).
    expect(style.backgroundColor).not.toBe(colors.success);
    expect(style.backgroundColor).not.toBe(colors.mossGreen);
    expect(style.backgroundColor).not.toBe(colors.error);
    expect(style.borderColor).not.toBe(colors.success);
    expect(style.borderColor).not.toBe(colors.mossGreen);
    expect(style.borderColor).not.toBe(colors.error);
    expect(screen.getByTestId('opt').props.accessibilityState.selected).toBe(true);
  });

  it('disables and reports the disabled state while an answer is locked', () => {
    const onPress = jest.fn();
    render(<GuessOption label="Spain" onPress={onPress} disabled testID="opt" />);

    expect(screen.getByTestId('opt').props.accessibilityState.disabled).toBe(true);
  });

  it('stretches to fill its cell so a wrapping neighbour can equalise the row', () => {
    render(<GuessOption label="France" onPress={jest.fn()} testID="opt" />);

    expect(flattenedStyle('opt').flex).toBe(1);
  });
});

describe('GuessOptionGrid', () => {
  it('pairs options into stretch rows', () => {
    render(
      <GuessOptionGrid testID="grid">
        <GuessOption label="France" onPress={jest.fn()} />
        <GuessOption label="Bosnia and Herzegovina" onPress={jest.fn()} />
        <GuessOption label="Italy" onPress={jest.fn()} />
        <GuessOption label="Spain" onPress={jest.fn()} />
      </GuessOptionGrid>
    );

    const grid = screen.getByTestId('grid');
    expect(grid.children).toHaveLength(2);
    const firstRow = grid.children[0];
    if (typeof firstRow === 'string') {
      throw new Error('expected a row view');
    }
    const firstRowStyle = StyleSheet.flatten(firstRow.props.style);
    expect(firstRowStyle.flexDirection).toBe('row');
    expect(firstRowStyle.alignItems).toBe('stretch');
  });
});
