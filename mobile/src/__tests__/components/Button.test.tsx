import { fireEvent, render, screen } from '../utils/testUtils';

import { Button } from '@components/ui/Button';

describe('Button', () => {
  it('renders with title (primary variant uppercases)', () => {
    render(<Button title="Press me" onPress={jest.fn()} />);

    // Primary variant (default) uppercases the title
    expect(screen.getByText('PRESS ME')).toBeTruthy();
  });

  it('calls onPress when pressed', () => {
    const onPress = jest.fn();
    render(<Button title="Press me" onPress={onPress} />);

    fireEvent.press(screen.getByText('PRESS ME'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress when disabled', () => {
    const onPress = jest.fn();
    render(<Button title="Press me" onPress={onPress} disabled />);

    fireEvent.press(screen.getByText('PRESS ME'));

    expect(onPress).not.toHaveBeenCalled();
  });

  it('shows loading indicator when loading', () => {
    render(<Button title="Press me" onPress={jest.fn()} loading />);

    // Button text should not be visible when loading
    expect(screen.queryByText('PRESS ME')).toBeNull();
    expect(screen.queryByText('Press me')).toBeNull();
  });

  it('renders different variants', () => {
    // Primary variant uppercases
    const { rerender } = render(<Button title="Primary" onPress={jest.fn()} variant="primary" />);
    expect(screen.getByText('PRIMARY')).toBeTruthy();

    // Non-primary variants keep original case
    rerender(<Button title="Secondary" onPress={jest.fn()} variant="secondary" />);
    expect(screen.getByText('Secondary')).toBeTruthy();

    rerender(<Button title="Outline" onPress={jest.fn()} variant="outline" />);
    expect(screen.getByText('Outline')).toBeTruthy();

    rerender(<Button title="Ghost" onPress={jest.fn()} variant="ghost" />);
    expect(screen.getByText('Ghost')).toBeTruthy();
  });
});
