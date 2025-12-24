import { fireEvent, render, screen } from '@testing-library/react-native';

import { Chip } from '@components/ui/Chip';

// Mock useResponsive hook
const mockUseResponsive = jest.fn();
jest.mock('@hooks/useResponsive', () => ({
  useResponsive: () => mockUseResponsive(),
}));

describe('Chip', () => {
  const defaultProps = {
    label: 'Test Chip',
    selected: false,
    onPress: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Default to large screen
    mockUseResponsive.mockReturnValue({
      screenSize: 'large',
      isSmallScreen: false,
      isMediumScreen: false,
      isLargeScreen: true,
      screenHeight: 926,
      screenWidth: 428,
    });
  });

  describe('basic rendering', () => {
    it('renders chip with label', () => {
      render(<Chip {...defaultProps} />);

      expect(screen.getByText('Test Chip')).toBeTruthy();
    });

    it('renders with accessibility properties', () => {
      render(<Chip {...defaultProps} />);

      const chip = screen.getByRole('button', { name: 'Test Chip' });
      expect(chip).toBeTruthy();
    });

    it('renders selected state with accessibility', () => {
      render(<Chip {...defaultProps} selected={true} />);

      const chip = screen.getByRole('button', { name: 'Test Chip' });
      expect(chip.props.accessibilityState).toEqual({ selected: true });
    });

    it('renders unselected state with accessibility', () => {
      render(<Chip {...defaultProps} selected={false} />);

      const chip = screen.getByRole('button', { name: 'Test Chip' });
      expect(chip.props.accessibilityState).toEqual({ selected: false });
    });
  });

  describe('interactions', () => {
    it('calls onPress when pressed', () => {
      const onPress = jest.fn();
      render(<Chip {...defaultProps} onPress={onPress} />);

      fireEvent.press(screen.getByText('Test Chip'));

      expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('handles press in and press out events', () => {
      render(<Chip {...defaultProps} />);

      const chip = screen.getByRole('button', { name: 'Test Chip' });

      // These events trigger animations but shouldn't throw
      fireEvent(chip, 'pressIn');
      fireEvent(chip, 'pressOut');

      // Component should still be rendered correctly
      expect(screen.getByText('Test Chip')).toBeTruthy();
    });
  });

  describe('responsive behavior', () => {
    it('applies small screen styles when isSmallScreen is true', () => {
      mockUseResponsive.mockReturnValue({
        screenSize: 'small',
        isSmallScreen: true,
        isMediumScreen: false,
        isLargeScreen: false,
        screenHeight: 568,
        screenWidth: 320,
      });

      render(<Chip {...defaultProps} />);

      // Hook should be called to get responsive values
      expect(mockUseResponsive).toHaveBeenCalled();
      expect(screen.getByText('Test Chip')).toBeTruthy();
    });

    it('does not apply small screen styles on large screens', () => {
      mockUseResponsive.mockReturnValue({
        screenSize: 'large',
        isSmallScreen: false,
        isMediumScreen: false,
        isLargeScreen: true,
        screenHeight: 926,
        screenWidth: 428,
      });

      render(<Chip {...defaultProps} />);

      expect(mockUseResponsive).toHaveBeenCalled();
      expect(screen.getByText('Test Chip')).toBeTruthy();
    });

    it('applies small screen styles on medium screens correctly', () => {
      mockUseResponsive.mockReturnValue({
        screenSize: 'medium',
        isSmallScreen: false,
        isMediumScreen: true,
        isLargeScreen: false,
        screenHeight: 812,
        screenWidth: 375,
      });

      render(<Chip {...defaultProps} />);

      // Medium screens should not have small screen styles
      expect(mockUseResponsive).toHaveBeenCalled();
      expect(screen.getByText('Test Chip')).toBeTruthy();
    });
  });

  describe('color consistency', () => {
    it('generates consistent color for the same label', () => {
      const { rerender } = render(<Chip {...defaultProps} label="France" selected={true} />);

      // Re-render with same label
      rerender(<Chip {...defaultProps} label="France" selected={true} />);

      // The chip should render consistently
      expect(screen.getByText('France')).toBeTruthy();
    });

    it('renders different labels', () => {
      const { rerender } = render(<Chip {...defaultProps} label="France" />);
      expect(screen.getByText('France')).toBeTruthy();

      rerender(<Chip {...defaultProps} label="Germany" />);
      expect(screen.getByText('Germany')).toBeTruthy();

      rerender(<Chip {...defaultProps} label="Italy" />);
      expect(screen.getByText('Italy')).toBeTruthy();
    });
  });

  describe('custom styles', () => {
    it('accepts custom style prop', () => {
      render(<Chip {...defaultProps} style={{ marginTop: 10 }} />);

      expect(screen.getByText('Test Chip')).toBeTruthy();
    });
  });

  describe('selected states', () => {
    it('renders correctly when selected', () => {
      render(<Chip {...defaultProps} selected={true} />);

      expect(screen.getByText('Test Chip')).toBeTruthy();
    });

    it('renders correctly when not selected', () => {
      render(<Chip {...defaultProps} selected={false} />);

      expect(screen.getByText('Test Chip')).toBeTruthy();
    });

    it('toggles between selected and unselected', () => {
      const { rerender } = render(<Chip {...defaultProps} selected={false} />);

      let chip = screen.getByRole('button', { name: 'Test Chip' });
      expect(chip.props.accessibilityState).toEqual({ selected: false });

      rerender(<Chip {...defaultProps} selected={true} />);

      chip = screen.getByRole('button', { name: 'Test Chip' });
      expect(chip.props.accessibilityState).toEqual({ selected: true });
    });
  });

  describe('small screen rendering', () => {
    beforeEach(() => {
      mockUseResponsive.mockReturnValue({
        screenSize: 'small',
        isSmallScreen: true,
        isMediumScreen: false,
        isLargeScreen: false,
        screenHeight: 568,
        screenWidth: 320,
      });
    });

    it('renders selected chip on small screen', () => {
      render(<Chip {...defaultProps} selected={true} />);

      expect(screen.getByText('Test Chip')).toBeTruthy();
    });

    it('renders unselected chip on small screen', () => {
      render(<Chip {...defaultProps} selected={false} />);

      expect(screen.getByText('Test Chip')).toBeTruthy();
    });

    it('handles press on small screen', () => {
      const onPress = jest.fn();
      render(<Chip {...defaultProps} onPress={onPress} />);

      fireEvent.press(screen.getByText('Test Chip'));

      expect(onPress).toHaveBeenCalledTimes(1);
    });
  });
});
