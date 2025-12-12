import { fireEvent, render, screen } from '../utils/testUtils';

import { TripCard, TripCardTrip } from '@components/ui/TripCard';

// Mock LinearGradient
jest.mock('expo-linear-gradient', () => ({
  LinearGradient: 'LinearGradient',
}));

describe('TripCard', () => {
  const mockTrip: TripCardTrip = {
    id: 'trip-1',
    name: 'Adventure in Paris',
    date_range: '[2024-03-15,2024-03-22]',
    cover_image_url: 'https://example.com/paris.jpg',
  };

  const mockOnPress = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders trip name', () => {
    render(<TripCard trip={mockTrip} flagEmoji="🇫🇷" onPress={mockOnPress} />);

    expect(screen.getByText('Adventure in Paris')).toBeTruthy();
  });

  it('renders flag emoji in placeholder when no cover image', () => {
    const tripWithoutImage = { ...mockTrip, cover_image_url: null };
    render(<TripCard trip={tripWithoutImage} flagEmoji="🇫🇷" onPress={mockOnPress} />);

    expect(screen.getByText('🇫🇷')).toBeTruthy();
  });

  it('calls onPress when pressed', () => {
    render(<TripCard trip={mockTrip} flagEmoji="🇫🇷" onPress={mockOnPress} testID="trip-card" />);

    fireEvent.press(screen.getByTestId('trip-card'));

    expect(mockOnPress).toHaveBeenCalledTimes(1);
  });

  it('formats date range correctly for same month', () => {
    const tripSameMonth: TripCardTrip = {
      id: 'trip-2',
      name: 'Quick Trip',
      date_range: '[2024-03-15,2024-03-20]',
    };

    render(<TripCard trip={tripSameMonth} flagEmoji="🇫🇷" onPress={mockOnPress} />);

    expect(screen.getByText('Mar 2024')).toBeTruthy();
  });

  it('formats date range correctly for different months', () => {
    const tripDifferentMonths: TripCardTrip = {
      id: 'trip-3',
      name: 'Long Trip',
      date_range: '[2024-03-15,2024-04-22]',
    };

    render(<TripCard trip={tripDifferentMonths} flagEmoji="🇫🇷" onPress={mockOnPress} />);

    expect(screen.getByText('Mar 2024 - Apr 2024')).toBeTruthy();
  });

  it('handles missing date range gracefully', () => {
    const tripNoDate: TripCardTrip = {
      id: 'trip-4',
      name: 'Undated Trip',
    };

    render(<TripCard trip={tripNoDate} flagEmoji="🇫🇷" onPress={mockOnPress} />);

    expect(screen.getByText('Undated Trip')).toBeTruthy();
    // No date should be displayed
    expect(screen.queryByText(/\d{4}/)).toBeNull();
  });

  it('handles invalid date range gracefully', () => {
    const tripInvalidDate: TripCardTrip = {
      id: 'trip-5',
      name: 'Invalid Date Trip',
      date_range: 'invalid-date',
    };

    render(<TripCard trip={tripInvalidDate} flagEmoji="🇫🇷" onPress={mockOnPress} />);

    expect(screen.getByText('Invalid Date Trip')).toBeTruthy();
  });

  it('has correct accessibility attributes', () => {
    render(<TripCard trip={mockTrip} flagEmoji="🇫🇷" onPress={mockOnPress} testID="trip-card" />);

    const card = screen.getByTestId('trip-card');
    expect(card.props.accessibilityRole).toBe('button');
    expect(card.props.accessibilityLabel).toBe('View trip: Adventure in Paris');
  });
});
