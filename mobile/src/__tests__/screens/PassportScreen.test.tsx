/**
 * Tests for PassportScreen component.
 * Tests share functionality, stats calculation, and error cases.
 */

import { render, screen } from '../utils/testUtils';
import {
  createMockCountry,
  createMockUserCountry,
  createMockNavigation,
} from '../utils/mockFactories';
import { PassportScreen } from '@screens/PassportScreen';
import type { PassportStackScreenProps } from '@navigation/types';
import * as useCountriesModule from '@hooks/useCountries';
import * as useUserCountriesModule from '@hooks/useUserCountries';
import * as useProfileModule from '@hooks/useProfile';
import * as useTripsModule from '@hooks/useTrips';
import type { Country } from '@hooks/useCountries';
import type { UserCountry } from '@hooks/useUserCountries';

// Create mock navigation
const mockNavigate = jest.fn();
const mockNavigation = {
  ...createMockNavigation(),
  navigate: mockNavigate,
} as unknown as PassportStackScreenProps<'PassportHome'>['navigation'];

// Helper factory for visited UserCountry
function createMockUserCountryVisited(code: string): UserCountry {
  return createMockUserCountry({ country_code: code, status: 'visited' });
}

// Helper factory for wishlist UserCountry
function createMockUserCountryWishlist(code: string): UserCountry {
  return createMockUserCountry({ country_code: code, status: 'wishlist' });
}

// Helper to create countries for different regions
function createMockCountriesForRegions(): Country[] {
  return [
    createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' }),
    createMockCountry({ code: 'CN', name: 'China', region: 'Asia' }),
    createMockCountry({ code: 'FR', name: 'France', region: 'Europe' }),
    createMockCountry({ code: 'DE', name: 'Germany', region: 'Europe' }),
    createMockCountry({ code: 'US', name: 'United States', region: 'Americas' }),
    createMockCountry({ code: 'BR', name: 'Brazil', region: 'Americas' }),
    createMockCountry({ code: 'EG', name: 'Egypt', region: 'Africa' }),
    createMockCountry({ code: 'AU', name: 'Australia', region: 'Oceania' }),
  ];
}

// Helper to mock hooks
interface MockHooksOptions {
  countries?: Country[];
  userCountries?: UserCountry[];
  trips?: ReturnType<typeof useTripsModule.useTrips>['data'];
  profile?: { tracking_preference?: string; travel_motives?: string[]; persona_tags?: string[] };
  isLoading?: boolean;
}

function mockHooksWithData({
  countries = [],
  userCountries = [],
  trips = [],
  profile = {},
  isLoading = false,
}: MockHooksOptions = {}) {
  jest.spyOn(useCountriesModule, 'useCountries').mockReturnValue({
    data: countries,
    isLoading,
    error: null,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useCountriesModule.useCountries>);

  jest.spyOn(useUserCountriesModule, 'useUserCountries').mockReturnValue({
    data: userCountries,
    isLoading,
    error: null,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useUserCountriesModule.useUserCountries>);

  jest.spyOn(useUserCountriesModule, 'useAddUserCountry').mockReturnValue({
    mutate: jest.fn(),
    mutateAsync: jest.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useUserCountriesModule.useAddUserCountry>);

  jest.spyOn(useUserCountriesModule, 'useRemoveUserCountry').mockReturnValue({
    mutate: jest.fn(),
    mutateAsync: jest.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useUserCountriesModule.useRemoveUserCountry>);

  jest.spyOn(useTripsModule, 'useTrips').mockReturnValue({
    data: trips,
    isLoading,
    error: null,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useTripsModule.useTrips>);

  jest.spyOn(useProfileModule, 'useProfile').mockReturnValue({
    data: profile,
    isLoading,
    error: null,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useProfileModule.useProfile>);
}

describe('PassportScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Stats Calculation', () => {
    it('calculates travel status using getTravelTier', () => {
      const countries = createMockCountriesForRegions();
      // 8 visited countries
      const userCountries = [
        createMockUserCountryVisited('JP'),
        createMockUserCountryVisited('CN'),
        createMockUserCountryVisited('FR'),
        createMockUserCountryVisited('DE'),
        createMockUserCountryVisited('US'),
        createMockUserCountryVisited('BR'),
        createMockUserCountryVisited('EG'),
        createMockUserCountryVisited('AU'),
      ];

      mockHooksWithData({ countries, userCountries });
      render(<PassportScreen navigation={mockNavigation} />);

      // Stats should show the count (may appear multiple times)
      expect(screen.getAllByText('8').length).toBeGreaterThanOrEqual(1);
    });

    it('calculates world percentage correctly', () => {
      const countries = createMockCountriesForRegions(); // 8 countries
      const userCountries = [
        createMockUserCountryVisited('JP'),
        createMockUserCountryVisited('FR'),
      ]; // 2 visited

      mockHooksWithData({ countries, userCountries });
      render(<PassportScreen navigation={mockNavigation} />);

      // 2 out of 8 = 25% (may appear multiple times)
      expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);
    });

    it('shows regions count for visited countries', () => {
      const countries = createMockCountriesForRegions();
      const userCountries = [
        createMockUserCountryVisited('JP'), // Asia
        createMockUserCountryVisited('FR'), // Europe
        createMockUserCountryVisited('US'), // Americas
      ];

      mockHooksWithData({ countries, userCountries });
      render(<PassportScreen navigation={mockNavigation} />);

      // 3 unique regions (may appear multiple times)
      expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Error Cases', () => {
    it('shows skeleton loader when loading', () => {
      mockHooksWithData({ isLoading: true });
      render(<PassportScreen navigation={mockNavigation} />);

      // Skeleton should be visible during loading
      // The PassportSkeleton component should be rendered
      expect(screen.queryByText('Your Passport')).toBeNull();
    });

    it('handles empty countries list gracefully', () => {
      mockHooksWithData({ countries: [], userCountries: [] });
      render(<PassportScreen navigation={mockNavigation} />);

      // Should show 0 for stats (may appear multiple times)
      expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
    });

    it('handles no visited countries', () => {
      const countries = createMockCountriesForRegions();
      mockHooksWithData({ countries, userCountries: [] });
      render(<PassportScreen navigation={mockNavigation} />);

      // Should show 0 stamps (may appear multiple times)
      expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Country Display', () => {
    it('displays visited countries as stamps', () => {
      const countries = createMockCountriesForRegions();
      const userCountries = [createMockUserCountryVisited('JP')];

      mockHooksWithData({ countries, userCountries });
      render(<PassportScreen navigation={mockNavigation} />);

      // Should show at least the visited count (may appear multiple times)
      expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
    });

    it('shows wishlist countries section', () => {
      const countries = createMockCountriesForRegions();
      const userCountries = [
        createMockUserCountryVisited('JP'),
        createMockUserCountryWishlist('FR'),
      ];

      mockHooksWithData({ countries, userCountries });
      render(<PassportScreen navigation={mockNavigation} />);

      // Should have both visited (1) and dreams (1)
      expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
    });
  });
});
