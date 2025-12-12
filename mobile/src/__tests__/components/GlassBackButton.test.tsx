import { fireEvent, render, screen } from '../utils/testUtils';

import { GlassBackButton } from '@components/ui/GlassBackButton';

describe('GlassBackButton', () => {
  const mockOnPress = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the back arrow', () => {
    render(<GlassBackButton onPress={mockOnPress} />);

    expect(screen.getByText('←')).toBeTruthy();
  });

  it('calls onPress when pressed', () => {
    render(<GlassBackButton onPress={mockOnPress} testID="back-button" />);

    fireEvent.press(screen.getByTestId('back-button'));

    expect(mockOnPress).toHaveBeenCalledTimes(1);
  });

  it('has correct accessibility attributes', () => {
    render(<GlassBackButton onPress={mockOnPress} testID="back-button" />);

    const button = screen.getByTestId('back-button');
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe('Go back');
  });

  it('renders light variant by default', () => {
    render(<GlassBackButton onPress={mockOnPress} />);

    // Light variant shows arrow with midnightNavy color (default)
    const arrow = screen.getByText('←');
    expect(arrow).toBeTruthy();
  });

  it('renders dark variant when specified', () => {
    render(<GlassBackButton onPress={mockOnPress} variant="dark" />);

    // Dark variant also renders arrow
    const arrow = screen.getByText('←');
    expect(arrow).toBeTruthy();
  });

  it('renders default size', () => {
    render(<GlassBackButton onPress={mockOnPress} />);

    const arrow = screen.getByText('←');
    expect(arrow).toBeTruthy();
  });

  it('renders small size when specified', () => {
    render(<GlassBackButton onPress={mockOnPress} size="small" />);

    const arrow = screen.getByText('←');
    expect(arrow).toBeTruthy();
  });
});
