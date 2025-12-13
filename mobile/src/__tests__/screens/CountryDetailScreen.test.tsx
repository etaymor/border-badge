/**
 * Tests for CountryDetailScreen component.
 * Tests dynamic button text (Plan a Trip vs Add New Trip) and rendering.
 */

import { fireEvent, render, screen } from '../utils/testUtils';
import { createMockTrip, createMockCountry, createMockNavigation } from '../utils/mockFactories';
import { CountryDetailScreen } from '@screens/country/CountryDetailScreen';
import type { PassportStackScreenProps } from '@navigation/types';
import * as useCountriesModule from '@hooks/useCountries';
import * as useTripsModule from '@hooks/useTrips';

// Create mock navigation with getParent
const mockParentNavigate = jest.fn();
const mockNavigation = {
  ...createMockNavigation(),
  getParent: jest.fn().mockReturnValue({
    navigate: mockParentNavigate,
  }),
} as unknown as PassportStackScreenProps<'CountryDetail'>['navigation'];

const createMockRoute = (params: {
  countryId: string;
  countryName?: string;
  countryCode?: string;
}) =>
  ({
    key: 'test',
    name: 'CountryDetail',
    params,
  }) as PassportStackScreenProps<'CountryDetail'>['route'];

// Helper to mock hooks
interface MockHooksOptions {
  country?: ReturnType<typeof createMockCountry> | null;
  trips?: ReturnType<typeof createMockTrip>[];
  isLoading?: boolean;
  refetch?: jest.Mock;
}

function mockHooksWithData({
  country = null,
  trips = [],
  isLoading = false,
  refetch = jest.fn(),
}: MockHooksOptions = {}) {
  jest.spyOn(useCountriesModule, 'useCountryByCode').mockReturnValue({
    data: country ?? undefined,
    isLoading: false,
  } as unknown as ReturnType<typeof useCountriesModule.useCountryByCode>);

  jest.spyOn(useTripsModule, 'useTripsByCountry').mockReturnValue({
    data: trips,
    isLoading,
    refetch,
  } as unknown as ReturnType<typeof useTripsModule.useTripsByCountry>);
}

describe('CountryDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Button Text', () => {
    it('shows "Plan a Trip" button when no trips exist for country', () => {
      const country = createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' });
      mockHooksWithData({ country, trips: [] });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      expect(screen.getByText('Plan a Trip')).toBeTruthy();
    });

    it('shows "Add Another Trip" button when trips exist for country', () => {
      const country = createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' });
      const trips = [createMockTrip({ id: 'trip-1', name: 'Tokyo Trip', country_code: 'JP' })];
      mockHooksWithData({ country, trips });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      expect(screen.getByText('Add Another Trip')).toBeTruthy();
    });
  });

  describe('Rendering', () => {
    it('displays country name and region', () => {
      const country = createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' });
      mockHooksWithData({ country, trips: [] });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      expect(screen.getByText('Japan')).toBeTruthy();
      expect(screen.getByText('Asia')).toBeTruthy();
    });

    it('shows trip count badge in section header when trips exist', () => {
      const country = createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' });
      const trips = [
        createMockTrip({ id: 'trip-1', name: 'Tokyo Trip', country_code: 'JP' }),
        createMockTrip({ id: 'trip-2', name: 'Osaka Trip', country_code: 'JP' }),
      ];
      mockHooksWithData({ country, trips });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      // Section header shows "Your Trips" with a badge showing count
      expect(screen.getByText('Your Trips')).toBeTruthy();
      expect(screen.getByText('2')).toBeTruthy();
    });

    it('shows trip count badge for one trip', () => {
      const country = createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' });
      const trips = [createMockTrip({ id: 'trip-1', name: 'Tokyo Trip', country_code: 'JP' })];
      mockHooksWithData({ country, trips });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      expect(screen.getByText('Your Trips')).toBeTruthy();
      expect(screen.getByText('1')).toBeTruthy();
    });

    it('shows empty state message when no trips', () => {
      const country = createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' });
      mockHooksWithData({ country, trips: [] });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      expect(screen.getByText('No adventures yet')).toBeTruthy();
      expect(screen.getByText('Start planning your trip to Japan')).toBeTruthy();
    });

    it('renders trip cards with trip name', () => {
      const country = createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' });
      const trips = [createMockTrip({ id: 'trip-1', name: 'Tokyo Adventure', country_code: 'JP' })];
      mockHooksWithData({ country, trips });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      expect(screen.getByText('Tokyo Adventure')).toBeTruthy();
    });
  });

  describe('Navigation', () => {
    it('navigates to TripForm with country info when button is pressed', () => {
      const country = createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' });
      mockHooksWithData({ country, trips: [] });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      fireEvent.press(screen.getByText('Plan a Trip'));

      expect(mockParentNavigate).toHaveBeenCalledWith('Trips', {
        screen: 'TripForm',
        params: {
          countryId: 'JP',
          countryName: 'Japan',
        },
      });
    });

    it('navigates to TripDetail when trip card is pressed', () => {
      const country = createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' });
      const trips = [createMockTrip({ id: 'trip-123', name: 'Tokyo Trip', country_code: 'JP' })];
      mockHooksWithData({ country, trips });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      fireEvent.press(screen.getByText('Tokyo Trip'));

      expect(mockParentNavigate).toHaveBeenCalledWith('Trips', {
        screen: 'TripDetail',
        params: { tripId: 'trip-123' },
      });
    });
  });
});
