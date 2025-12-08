import { fireEvent, render, screen } from '../utils/testUtils';

import { StampCard } from '@components/ui/StampCard';
import { getStampImage } from '../../assets/stampImages';

// Mock the stampImages module
jest.mock('../../assets/stampImages', () => ({
  getStampImage: jest.fn(),
}));

const mockGetStampImage = getStampImage as jest.MockedFunction<typeof getStampImage>;

describe('StampCard', () => {
  const defaultProps = {
    code: 'US',
    onPress: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Default to returning a mock image
    mockGetStampImage.mockReturnValue(1 as never); // Jest returns numbers for require()
  });

  describe('rendering', () => {
    it('renders stamp image when valid code provided', () => {
      render(<StampCard {...defaultProps} />);

      expect(screen.getByTestId('stamp-card-US')).toBeTruthy();
    });

    it('returns null when stamp image not found', () => {
      mockGetStampImage.mockReturnValue(null);

      render(<StampCard {...defaultProps} />);

      // When no stamp image, component returns null so testID won't be found
      expect(screen.queryByTestId('stamp-card-US')).toBeNull();
    });

    it('calls getStampImage with the country code', () => {
      render(<StampCard {...defaultProps} code="FR" />);

      expect(mockGetStampImage).toHaveBeenCalledWith('FR');
    });
  });

  describe('interaction', () => {
    it('calls onPress when pressed', () => {
      render(<StampCard {...defaultProps} />);

      fireEvent.press(screen.getByTestId('stamp-card-US'));

      expect(defaultProps.onPress).toHaveBeenCalledTimes(1);
    });
  });

  describe('testID', () => {
    it('uses default testID with country code', () => {
      render(<StampCard {...defaultProps} code="JP" />);

      expect(screen.getByTestId('stamp-card-JP')).toBeTruthy();
    });

    it('uses custom testID when provided', () => {
      render(<StampCard {...defaultProps} testID="custom-stamp-card" />);

      expect(screen.getByTestId('custom-stamp-card')).toBeTruthy();
    });
  });

  describe('accessibility', () => {
    it('has correct accessibility role', () => {
      render(<StampCard {...defaultProps} />);

      const card = screen.getByTestId('stamp-card-US');
      expect(card.props.accessibilityRole).toBe('button');
    });

    it('has correct accessibility label', () => {
      render(<StampCard {...defaultProps} code="FR" />);

      const card = screen.getByTestId('stamp-card-FR');
      expect(card.props.accessibilityLabel).toBe('View FR country details');
    });
  });

  describe('styling', () => {
    it('applies custom style', () => {
      const customStyle = { marginTop: 20 };
      render(<StampCard {...defaultProps} style={customStyle} />);

      const card = screen.getByTestId('stamp-card-US');
      const flattenedStyle = Array.isArray(card.props.style)
        ? card.props.style.flat()
        : [card.props.style];

      const hasCustomStyle = flattenedStyle.some(
        (style: Record<string, unknown>) => style?.marginTop === 20
      );
      expect(hasCustomStyle).toBe(true);
    });
  });
});
