/**
 * Tests for TripsListScreen component.
 * Tests section categorization (My Trips vs Planned Trips), rendering, and navigation.
 */

import { fireEvent, render, screen } from '../utils/testUtils';
import {
  createMockTrip,
  createMockCountry,
  createMockUserCountry,
  createMockNavigation,
} from '../utils/mockFactories';
import { TripsListScreen } from '@screens/trips/TripsListScreen';
import type { TripsStackScreenProps } from '@navigation/types';
import * as useTripsModule from '@hooks/useTrips';
import * as useCountriesModule from '@hooks/useCountries';
import * as useUserCountriesModule from '@hooks/useUserCountries';

// Create mock navigation and route
const mockNavigation =
  createMockNavigation() as unknown as TripsStackScreenProps<'TripsList'>['navigation'];
const mockRoute = {
  key: 'test',
  name: 'TripsList',
} as TripsStackScreenProps<'TripsList'>['route'];

// Helper to mock all hooks with provided data
interface MockHooksOptions {
  trips?: ReturnType<typeof createMockTrip>[] | null;
  countries?: ReturnType<typeof createMockCountry>[];
  userCountries?: ReturnType<typeof createMockUserCountry>[];
  isLoading?: boolean;
  isRefetching?: boolean;
  error?: Error | null;
  refetch?: jest.Mock;
}

function mockHooksWithData({
  trips = [],
  countries = [],
  userCountries = [],
  isLoading = false,
  isRefetching = false,
  error = null,
  refetch = jest.fn(),
}: MockHooksOptions = {}) {
  jest.spyOn(useTripsModule, 'useTrips').mockReturnValue({
    data: trips ?? undefined,
    isLoading,
    isRefetching,
    refetch,
    error,
  } as unknown as ReturnType<typeof useTripsModule.useTrips>);

  jest.spyOn(useCountriesModule, 'useCountries').mockReturnValue({
    data: countries,
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useCountriesModule.useCountries>);

  jest.spyOn(useUserCountriesModule, 'useUserCountries').mockReturnValue({
    data: userCountries,
    isLoading: false,
  } as ReturnType<typeof useUserCountriesModule.useUserCountries>);
}

describe('TripsListScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('shows loading indicator while loading', () => {
      mockHooksWithData({ isLoading: true });

      render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

      // trips-list should NOT be present when loading
      expect(screen.queryByTestId('trips-list')).toBeNull();
    });

    it('shows error state with retry button on error', () => {
      mockHooksWithData({ error: new Error('Network error') });

      render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

      expect(screen.getByText('Failed to load trips')).toBeTruthy();
      expect(screen.getByText('Try Again')).toBeTruthy();
    });

    it('calls refetch when retry button is pressed', () => {
      const mockRefetch = jest.fn();
      mockHooksWithData({ error: new Error('Network error'), refetch: mockRefetch });

      render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

      fireEvent.press(screen.getByText('Try Again'));
      expect(mockRefetch).toHaveBeenCalled();
    });

    it('shows empty state when no trips exist', () => {
      mockHooksWithData({ trips: [] });

      render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

      expect(screen.getByText('No trips yet')).toBeTruthy();
      expect(screen.getByText('Add Your First Trip')).toBeTruthy();
    });

    it('renders trip cards with correct data', () => {
      const trips = [
        createMockTrip({
          id: 'trip-1',
          name: 'Tokyo Adventure',
          country_code: 'JP',
          country_id: 'JP',
        }),
      ];
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      const userCountries = [createMockUserCountry({ country_code: 'JP', status: 'visited' })];

      mockHooksWithData({ trips, countries, userCountries });

      render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

      expect(screen.getByText('Tokyo Adventure')).toBeTruthy();
      expect(screen.getByText('Japan')).toBeTruthy();
    });
  });

  describe('Section Categorization', () => {
    it('shows "My Trips" section header for visited country trips', () => {
      const trips = [createMockTrip({ id: 'trip-1', name: 'Tokyo Trip', country_code: 'JP' })];
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      const userCountries = [createMockUserCountry({ country_code: 'JP', status: 'visited' })];

      mockHooksWithData({ trips, countries, userCountries });

      render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

      expect(screen.getByText('My Trips')).toBeTruthy();
      expect(screen.queryByText('Planned Trips')).toBeNull();
    });

    it('shows "Planned Trips" section header for non-visited country trips', () => {
      const trips = [createMockTrip({ id: 'trip-1', name: 'Paris Trip', country_code: 'FR' })];
      const countries = [createMockCountry({ code: 'FR', name: 'France' })];
      // User has not visited France (no userCountry entry or wishlist status)
      const userCountries = [createMockUserCountry({ country_code: 'FR', status: 'wishlist' })];

      mockHooksWithData({ trips, countries, userCountries });

      render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

      expect(screen.getByText('Planned Trips')).toBeTruthy();
      expect(screen.queryByText('My Trips')).toBeNull();
    });

    it('separates mixed trips into correct sections', () => {
      const trips = [
        createMockTrip({ id: 'trip-1', name: 'Tokyo Trip', country_code: 'JP' }),
        createMockTrip({ id: 'trip-2', name: 'Paris Trip', country_code: 'FR' }),
      ];
      const countries = [
        createMockCountry({ code: 'JP', name: 'Japan' }),
        createMockCountry({ code: 'FR', name: 'France' }),
      ];
      // Japan is visited, France is not
      const userCountries = [createMockUserCountry({ country_code: 'JP', status: 'visited' })];

      mockHooksWithData({ trips, countries, userCountries });

      render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

      expect(screen.getByText('My Trips')).toBeTruthy();
      expect(screen.getByText('Planned Trips')).toBeTruthy();
      expect(screen.getByText('Tokyo Trip')).toBeTruthy();
      expect(screen.getByText('Paris Trip')).toBeTruthy();
    });

    it('shows only "My Trips" when all trips are for visited countries', () => {
      const trips = [
        createMockTrip({ id: 'trip-1', name: 'Tokyo Trip', country_code: 'JP' }),
        createMockTrip({ id: 'trip-2', name: 'Osaka Trip', country_code: 'JP' }),
      ];
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      const userCountries = [createMockUserCountry({ country_code: 'JP', status: 'visited' })];

      mockHooksWithData({ trips, countries, userCountries });

      render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

      expect(screen.getByText('My Trips')).toBeTruthy();
      expect(screen.queryByText('Planned Trips')).toBeNull();
    });

    it('shows only "Planned Trips" when all trips are for non-visited countries', () => {
      const trips = [
        createMockTrip({ id: 'trip-1', name: 'Paris Trip', country_code: 'FR' }),
        createMockTrip({ id: 'trip-2', name: 'Berlin Trip', country_code: 'DE' }),
      ];
      const countries = [
        createMockCountry({ code: 'FR', name: 'France' }),
        createMockCountry({ code: 'DE', name: 'Germany' }),
      ];
      // No visited countries
      const userCountries: ReturnType<typeof createMockUserCountry>[] = [];

      mockHooksWithData({ trips, countries, userCountries });

      render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

      expect(screen.getByText('Planned Trips')).toBeTruthy();
      expect(screen.queryByText('My Trips')).toBeNull();
    });

    it('treats all trips as "Planned Trips" when userCountries data is undefined', () => {
      const trips = [createMockTrip({ id: 'trip-1', name: 'Tokyo Trip', country_code: 'JP' })];
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];

      // Mock useUserCountries to return undefined
      jest.spyOn(useTripsModule, 'useTrips').mockReturnValue({
        data: trips,
        isLoading: false,
        isRefetching: false,
        refetch: jest.fn(),
        error: null,
      } as unknown as ReturnType<typeof useTripsModule.useTrips>);

      jest.spyOn(useCountriesModule, 'useCountries').mockReturnValue({
        data: countries,
        isLoading: false,
        error: null,
      } as unknown as ReturnType<typeof useCountriesModule.useCountries>);

      jest.spyOn(useUserCountriesModule, 'useUserCountries').mockReturnValue({
        data: undefined,
        isLoading: false,
      } as ReturnType<typeof useUserCountriesModule.useUserCountries>);

      render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

      expect(screen.getByText('Planned Trips')).toBeTruthy();
      expect(screen.queryByText('My Trips')).toBeNull();
    });
  });

  describe('Navigation', () => {
    it('navigates to TripDetail when trip card is pressed', () => {
      const trips = [createMockTrip({ id: 'trip-123', name: 'Tokyo Trip', country_code: 'JP' })];
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      const userCountries = [createMockUserCountry({ country_code: 'JP', status: 'visited' })];

      mockHooksWithData({ trips, countries, userCountries });

      render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

      fireEvent.press(screen.getByTestId('trip-card-trip-123'));
      expect(mockNavigation.navigate).toHaveBeenCalledWith('TripDetail', { tripId: 'trip-123' });
    });

    it('navigates to TripForm when FAB is pressed', () => {
      const trips = [createMockTrip({ id: 'trip-1', name: 'Tokyo Trip', country_code: 'JP' })];
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      const userCountries = [createMockUserCountry({ country_code: 'JP', status: 'visited' })];

      mockHooksWithData({ trips, countries, userCountries });

      render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

      fireEvent.press(screen.getByTestId('fab-add-trip'));
      expect(mockNavigation.navigate).toHaveBeenCalledWith('TripForm', {});
    });

    it('navigates to TripForm when empty state button is pressed', () => {
      mockHooksWithData({ trips: [] });

      render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

      fireEvent.press(screen.getByTestId('empty-add-trip-button'));
      expect(mockNavigation.navigate).toHaveBeenCalledWith('TripForm', {});
    });
  });
});
