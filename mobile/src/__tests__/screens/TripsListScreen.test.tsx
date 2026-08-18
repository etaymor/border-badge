/**
 * Tests for TripsListScreen component.
 * Tests section categorization (My Trips vs Planned Trips), rendering, navigation,
 * and tab filtering (My Trips vs Tagged).
 */

import { fireEvent, render, screen } from '../utils/testUtils';
import {
  createMockTrip,
  createMockTripWithTags,
  createMockCountry,
  createMockUserCountry,
  createMockNavigation,
} from '../utils/mockFactories';
import { TripsListScreen } from '@screens/trips/TripsListScreen';
import type { TripsStackScreenProps } from '@navigation/types';
import * as useTripsModule from '@hooks/useTrips';
import * as useCountriesModule from '@hooks/useCountries';
import * as useUserCountriesModule from '@hooks/useUserCountries';
import * as authStoreModule from '@stores/authStore';

// Tab filtering (My Trips / Tagged) and the notification bell are social
// features; enable the flag so they render in these tests.
jest.mock('@config/features', () => ({
  features: { enableSocial: true, enableFriends: true },
  isFeatureEnabled: () => true,
}));

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

// Mock current user ID - must match the default user_id in createMockTrip ('user-123')
const CURRENT_USER_ID = 'user-123';
const FRIEND_USER_ID = 'friend-user-456';

describe('TripsListScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock authStore to return current user ID
    jest.spyOn(authStoreModule, 'useAuthStore').mockImplementation((selector) => {
      const state = {
        session: { user: { id: CURRENT_USER_ID } },
      } as authStoreModule.AuthState;
      return selector(state);
    });
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

      expect(screen.getByText('The World Awaits')).toBeTruthy();
      expect(screen.getByText('Plan a New Adventure')).toBeTruthy();
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
    });
  });

  describe('Section Categorization', () => {
    it('shows "My Adventures" section header for visited country trips', () => {
      const trips = [createMockTrip({ id: 'trip-1', name: 'Tokyo Trip', country_code: 'JP' })];
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      const userCountries = [createMockUserCountry({ country_code: 'JP', status: 'visited' })];

      mockHooksWithData({ trips, countries, userCountries });

      render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

      expect(screen.getByText('My Adventures')).toBeTruthy();
      expect(screen.queryByText('Upcoming Plans')).toBeNull();
    });

    it('shows "Upcoming Plans" section header for non-visited country trips', () => {
      const trips = [createMockTrip({ id: 'trip-1', name: 'Paris Trip', country_code: 'FR' })];
      const countries = [createMockCountry({ code: 'FR', name: 'France' })];
      // User has not visited France (no userCountry entry or wishlist status)
      const userCountries = [createMockUserCountry({ country_code: 'FR', status: 'wishlist' })];

      mockHooksWithData({ trips, countries, userCountries });

      render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

      expect(screen.getByText('Upcoming Plans')).toBeTruthy();
      expect(screen.queryByText('My Adventures')).toBeNull();
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

      expect(screen.getByText('My Adventures')).toBeTruthy();
      expect(screen.getByText('Upcoming Plans')).toBeTruthy();
      expect(screen.getByText('Tokyo Trip')).toBeTruthy();
      expect(screen.getByText('Paris Trip')).toBeTruthy();
    });

    it('shows only "My Adventures" when all trips are for visited countries', () => {
      const trips = [
        createMockTrip({ id: 'trip-1', name: 'Tokyo Trip', country_code: 'JP' }),
        createMockTrip({ id: 'trip-2', name: 'Osaka Trip', country_code: 'JP' }),
      ];
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      const userCountries = [createMockUserCountry({ country_code: 'JP', status: 'visited' })];

      mockHooksWithData({ trips, countries, userCountries });

      render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

      expect(screen.getByText('My Adventures')).toBeTruthy();
      expect(screen.queryByText('Upcoming Plans')).toBeNull();
    });

    it('shows only "Upcoming Plans" when all trips are for non-visited countries', () => {
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

      expect(screen.getByText('Upcoming Plans')).toBeTruthy();
      expect(screen.queryByText('My Adventures')).toBeNull();
    });

    it('treats all trips as "Upcoming Plans" when userCountries data is undefined', () => {
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

      expect(screen.getByText('Upcoming Plans')).toBeTruthy();
      expect(screen.queryByText('My Adventures')).toBeNull();
    });
  });

  describe('Navigation', () => {
    it('navigates to TripDetail when trip card is pressed', () => {
      const trips = [createMockTrip({ id: 'trip-123', name: 'Tokyo Trip', country_code: 'JP' })];
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      const userCountries = [createMockUserCountry({ country_code: 'JP', status: 'visited' })];

      mockHooksWithData({ trips, countries, userCountries });

      render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

      fireEvent.press(screen.getByLabelText('View trip: Tokyo Trip'));
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

  describe('Tab Filtering (My Trips / Tagged)', () => {
    it('renders tabs for My Trips and Tagged', () => {
      mockHooksWithData({ trips: [] });

      render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

      expect(screen.getByTestId('trip-tabs')).toBeTruthy();
      expect(screen.getByRole('tab', { name: 'My Trips' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: 'Tagged' })).toBeTruthy();
    });

    it('shows My Trips tab as selected by default', () => {
      mockHooksWithData({ trips: [] });

      render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

      const myTripsTab = screen.getByRole('tab', { name: 'My Trips' });
      expect(myTripsTab.props.accessibilityState).toEqual({ selected: true });
    });

    it('filters to show only user-owned trips on My Trips tab', () => {
      const trips = [
        createMockTripWithTags({
          id: 'my-trip-1',
          name: 'My Tokyo Trip',
          country_code: 'JP',
          user_id: CURRENT_USER_ID,
        }),
        createMockTripWithTags({
          id: 'friend-trip-1',
          name: 'Friend Paris Trip',
          country_code: 'FR',
          user_id: FRIEND_USER_ID,
        }),
      ];
      const countries = [
        createMockCountry({ code: 'JP', name: 'Japan' }),
        createMockCountry({ code: 'FR', name: 'France' }),
      ];
      const userCountries = [
        createMockUserCountry({ country_code: 'JP', status: 'visited' }),
        createMockUserCountry({ country_code: 'FR', status: 'visited' }),
      ];

      mockHooksWithData({ trips, countries, userCountries });

      render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

      // My Trips tab is selected by default, should only show user's trip
      expect(screen.getByText('My Tokyo Trip')).toBeTruthy();
      expect(screen.queryByText('Friend Paris Trip')).toBeNull();
    });

    it('filters to show only tagged trips on Tagged tab', () => {
      const trips = [
        createMockTripWithTags({
          id: 'my-trip-1',
          name: 'My Tokyo Trip',
          country_code: 'JP',
          user_id: CURRENT_USER_ID,
        }),
        createMockTripWithTags({
          id: 'friend-trip-1',
          name: 'Friend Paris Trip',
          country_code: 'FR',
          user_id: FRIEND_USER_ID,
        }),
      ];
      const countries = [
        createMockCountry({ code: 'JP', name: 'Japan' }),
        createMockCountry({ code: 'FR', name: 'France' }),
      ];
      const userCountries = [
        createMockUserCountry({ country_code: 'JP', status: 'visited' }),
        createMockUserCountry({ country_code: 'FR', status: 'visited' }),
      ];

      mockHooksWithData({ trips, countries, userCountries });

      render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

      // Switch to Tagged tab
      fireEvent.press(screen.getByText('Tagged'));

      // Should only show friend's trip
      expect(screen.queryByText('My Tokyo Trip')).toBeNull();
      expect(screen.getByText('Friend Paris Trip')).toBeTruthy();
    });

    it('shows empty state for Tagged tab when no tagged trips exist', () => {
      const trips = [
        createMockTripWithTags({
          id: 'my-trip-1',
          name: 'My Tokyo Trip',
          country_code: 'JP',
          user_id: CURRENT_USER_ID,
        }),
      ];
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      const userCountries = [createMockUserCountry({ country_code: 'JP', status: 'visited' })];

      mockHooksWithData({ trips, countries, userCountries });

      render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

      // Switch to Tagged tab
      fireEvent.press(screen.getByText('Tagged'));

      // Should show Tagged empty state
      expect(screen.getByText('No Tagged Trips')).toBeTruthy();
      expect(
        screen.getByText("When friends tag you on their adventures, they'll appear here.")
      ).toBeTruthy();
    });

    it('shows empty state for My Trips tab when user has no trips', () => {
      const trips = [
        createMockTripWithTags({
          id: 'friend-trip-1',
          name: 'Friend Paris Trip',
          country_code: 'FR',
          user_id: FRIEND_USER_ID,
        }),
      ];
      const countries = [createMockCountry({ code: 'FR', name: 'France' })];
      const userCountries = [createMockUserCountry({ country_code: 'FR', status: 'visited' })];

      mockHooksWithData({ trips, countries, userCountries });

      render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

      // My Trips tab is selected by default
      expect(screen.getByText('The World Awaits')).toBeTruthy();
      expect(screen.getByText('Plan a New Adventure')).toBeTruthy();
    });

    it('maintains section headers within each tab', () => {
      const trips = [
        createMockTripWithTags({
          id: 'my-trip-visited',
          name: 'My Visited Trip',
          country_code: 'JP',
          user_id: CURRENT_USER_ID,
        }),
        createMockTripWithTags({
          id: 'my-trip-planned',
          name: 'My Planned Trip',
          country_code: 'DE',
          user_id: CURRENT_USER_ID,
        }),
      ];
      const countries = [
        createMockCountry({ code: 'JP', name: 'Japan' }),
        createMockCountry({ code: 'DE', name: 'Germany' }),
      ];
      const userCountries = [createMockUserCountry({ country_code: 'JP', status: 'visited' })];

      mockHooksWithData({ trips, countries, userCountries });

      render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

      // Should show both section headers in My Trips tab
      expect(screen.getByText('My Adventures')).toBeTruthy();
      expect(screen.getByText('Upcoming Plans')).toBeTruthy();
      expect(screen.getByText('My Visited Trip')).toBeTruthy();
      expect(screen.getByText('My Planned Trip')).toBeTruthy();
    });

    it('switches back to My Trips tab after viewing Tagged', () => {
      const trips = [
        createMockTripWithTags({
          id: 'my-trip-1',
          name: 'My Tokyo Trip',
          country_code: 'JP',
          user_id: CURRENT_USER_ID,
        }),
        createMockTripWithTags({
          id: 'friend-trip-1',
          name: 'Friend Paris Trip',
          country_code: 'FR',
          user_id: FRIEND_USER_ID,
        }),
      ];
      const countries = [
        createMockCountry({ code: 'JP', name: 'Japan' }),
        createMockCountry({ code: 'FR', name: 'France' }),
      ];
      const userCountries = [
        createMockUserCountry({ country_code: 'JP', status: 'visited' }),
        createMockUserCountry({ country_code: 'FR', status: 'visited' }),
      ];

      mockHooksWithData({ trips, countries, userCountries });

      render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

      // Initially on My Trips
      expect(screen.getByText('My Tokyo Trip')).toBeTruthy();

      // Switch to Tagged
      fireEvent.press(screen.getByText('Tagged'));
      expect(screen.getByText('Friend Paris Trip')).toBeTruthy();
      expect(screen.queryByText('My Tokyo Trip')).toBeNull();

      // Switch back to My Trips
      fireEvent.press(screen.getByRole('tab', { name: 'My Trips' }));
      expect(screen.getByText('My Tokyo Trip')).toBeTruthy();
      expect(screen.queryByText('Friend Paris Trip')).toBeNull();
    });
  });
});
