import { fireEvent, render, screen } from '../utils/testUtils';

import { VisitedCountryCard } from '@components/ui/VisitedCountryCard';
import { getStampImage } from '../../assets/stampImages';
import { getFlagEmoji } from '@utils/flags';

// Mock the modules
jest.mock('../../assets/stampImages', () => ({
  getStampImage: jest.fn(),
}));

jest.mock('@utils/flags', () => ({
  getFlagEmoji: jest.fn(),
}));

const mockGetStampImage = getStampImage as jest.MockedFunction<typeof getStampImage>;
const mockGetFlagEmoji = getFlagEmoji as jest.MockedFunction<typeof getFlagEmoji>;

describe('VisitedCountryCard', () => {
  const defaultProps = {
    code: 'US',
    name: 'United States',
    region: 'Americas',
    onPress: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Default to returning a mock stamp image
    mockGetStampImage.mockReturnValue(1 as never); // Jest returns numbers for require()
    mockGetFlagEmoji.mockReturnValue('🇺🇸');
  });

  describe('rendering', () => {
    it('renders country name', () => {
      render(<VisitedCountryCard {...defaultProps} />);

      expect(screen.getByText('United States')).toBeTruthy();
    });

    it('renders country region', () => {
      render(<VisitedCountryCard {...defaultProps} />);

      expect(screen.getByText('Americas')).toBeTruthy();
    });

    it('renders stamp image when available', () => {
      render(<VisitedCountryCard {...defaultProps} />);

      // Should not show flag emoji when stamp is available
      expect(screen.queryByText('🇺🇸')).toBeNull();
    });

    it('falls back to flag emoji when no stamp image', () => {
      mockGetStampImage.mockReturnValue(null);

      render(<VisitedCountryCard {...defaultProps} />);

      expect(screen.getByText('🇺🇸')).toBeTruthy();
    });

    it('calls getStampImage with the country code', () => {
      render(<VisitedCountryCard {...defaultProps} code="FR" />);

      expect(mockGetStampImage).toHaveBeenCalledWith('FR');
    });

    it('calls getFlagEmoji with the country code', () => {
      render(<VisitedCountryCard {...defaultProps} code="JP" />);

      expect(mockGetFlagEmoji).toHaveBeenCalledWith('JP');
    });
  });

  describe('interaction', () => {
    it('calls onPress when pressed', () => {
      render(<VisitedCountryCard {...defaultProps} />);

      fireEvent.press(screen.getByTestId('visited-country-card-US'));

      expect(defaultProps.onPress).toHaveBeenCalledTimes(1);
    });
  });

  describe('testID', () => {
    it('uses default testID with country code', () => {
      render(<VisitedCountryCard {...defaultProps} code="JP" />);

      expect(screen.getByTestId('visited-country-card-JP')).toBeTruthy();
    });

    it('uses custom testID when provided', () => {
      render(<VisitedCountryCard {...defaultProps} testID="custom-visited-card" />);

      expect(screen.getByTestId('custom-visited-card')).toBeTruthy();
    });
  });

  describe('accessibility', () => {
    it('has correct accessibility role', () => {
      render(<VisitedCountryCard {...defaultProps} />);

      const card = screen.getByTestId('visited-country-card-US');
      expect(card.props.accessibilityRole).toBe('button');
    });

    it('has correct accessibility label', () => {
      render(<VisitedCountryCard {...defaultProps} name="France" />);

      const card = screen.getByTestId('visited-country-card-US');
      expect(card.props.accessibilityLabel).toBe('France, tap to view details');
    });
  });

  describe('styling', () => {
    it('applies custom style', () => {
      const customStyle = { marginTop: 20 };
      render(<VisitedCountryCard {...defaultProps} style={customStyle} />);

      const card = screen.getByTestId('visited-country-card-US');
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
