import { fireEvent, render, screen } from '../utils/testUtils';

import { CountryCard } from '@components/ui/CountryCard';

describe('CountryCard', () => {
  const defaultProps = {
    code: 'JP',
    name: 'Japan',
    region: 'Asia',
    onPress: jest.fn(),
    onAddVisited: jest.fn(),
    onToggleWishlist: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders country name and region', () => {
    render(<CountryCard {...defaultProps} />);

    expect(screen.getByText('Japan')).toBeTruthy();
    expect(screen.getByText('Asia')).toBeTruthy();
  });

  it('renders without region when not provided', () => {
    render(<CountryCard {...defaultProps} region={undefined} />);

    expect(screen.getByText('Japan')).toBeTruthy();
    expect(screen.queryByText('Asia')).toBeNull();
  });

  it('calls onPress when card body is tapped', () => {
    render(<CountryCard {...defaultProps} />);

    fireEvent.press(screen.getByTestId('country-card-JP'));

    expect(defaultProps.onPress).toHaveBeenCalledTimes(1);
  });

  it('calls onAddVisited when plus button is tapped', () => {
    render(<CountryCard {...defaultProps} />);

    fireEvent.press(screen.getByTestId('country-card-visited-JP'));

    expect(defaultProps.onAddVisited).toHaveBeenCalledTimes(1);
  });

  it('calls onToggleWishlist when heart button is tapped', () => {
    render(<CountryCard {...defaultProps} />);

    fireEvent.press(screen.getByTestId('country-card-wishlist-JP'));

    expect(defaultProps.onToggleWishlist).toHaveBeenCalledTimes(1);
  });

  it('has correct accessibility label when not wishlisted', () => {
    render(<CountryCard {...defaultProps} isWishlisted={false} />);

    const wishlistButton = screen.getByTestId('country-card-wishlist-JP');
    expect(wishlistButton.props.accessibilityLabel).toBe('Add to wishlist');
  });

  it('has correct accessibility label when wishlisted', () => {
    render(<CountryCard {...defaultProps} isWishlisted={true} />);

    const wishlistButton = screen.getByTestId('country-card-wishlist-JP');
    expect(wishlistButton.props.accessibilityLabel).toBe('Remove from wishlist');
  });

  it('has correct accessibility label for visited button when not visited', () => {
    render(<CountryCard {...defaultProps} isVisited={false} />);

    const visitedButton = screen.getByTestId('country-card-visited-JP');
    expect(visitedButton.props.accessibilityLabel).toBe('Mark as visited');
  });

  it('has correct accessibility label for visited button when visited', () => {
    render(<CountryCard {...defaultProps} isVisited={true} />);

    const visitedButton = screen.getByTestId('country-card-visited-JP');
    expect(visitedButton.props.accessibilityLabel).toBe('Already visited');
  });
});
