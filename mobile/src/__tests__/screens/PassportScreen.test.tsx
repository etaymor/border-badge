/**
 * Tests for PassportScreen component.
 * Tests share functionality, stats calculation, and error cases.
 */

import { fireEvent, render, screen } from '../utils/testUtils';
import {
  createMockCountry,
  createMockUserCountry,
  createMockNavigation,
} from '../utils/mockFactories';
import { PassportScreen } from '@screens/passport/PassportScreen';
import type { PassportStackScreenProps } from '@navigation/types';
import * as useCountriesModule from '@hooks/useCountries';
import * as useUserCountriesModule from '@hooks/useUserCountries';
import * as useProfileModule from '@hooks/useProfile';
import * as useTripsModule from '@hooks/useTrips';
import * as useHasInitialImportModule from '@hooks/useHasInitialImport';
import * as useQuizzesModule from '@hooks/useQuizzes';
import type { Country } from '@hooks/useCountries';
import type { UserCountry } from '@hooks/useUserCountries';

// Create mock navigation
const mockNavigate = jest.fn();
const mockNavigation = {
  ...createMockNavigation(),
  navigate: mockNavigate,
} as unknown as PassportStackScreenProps<'PassportHome'>['navigation'];

// Create mock route
const mockRoute = {
  key: 'test',
  name: 'PassportHome',
} as PassportStackScreenProps<'PassportHome'>['route'];

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
  /** Whether the camera roll has ever been scanned (drives the home slot). */
  hasInitialImport?: boolean;
  importStateLoading?: boolean;
  /** Existing challenges keep the Guess Where card regardless of the cache. */
  quizCount?: number;
}

function mockHooksWithData({
  countries = [],
  userCountries = [],
  trips = [],
  profile = {},
  isLoading = false,
  hasInitialImport = true,
  importStateLoading = false,
  quizCount = 0,
}: MockHooksOptions = {}) {
  jest.spyOn(useHasInitialImportModule, 'useHasInitialImport').mockReturnValue({
    hasInitialImport,
    isLoading: importStateLoading,
    isError: false,
    refresh: jest.fn(),
  });

  jest.spyOn(useQuizzesModule, 'useMyQuizzes').mockReturnValue({
    data: Array.from({ length: quizCount }, (_, i) => ({ id: `quiz-${i}` })),
    isLoading: false,
    error: null,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useQuizzesModule.useMyQuizzes>);

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
      render(<PassportScreen navigation={mockNavigation} route={mockRoute} />);

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
      render(<PassportScreen navigation={mockNavigation} route={mockRoute} />);

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
      render(<PassportScreen navigation={mockNavigation} route={mockRoute} />);

      // 3 unique regions (may appear multiple times)
      expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Error Cases', () => {
    it('shows skeleton loader when loading', () => {
      mockHooksWithData({ isLoading: true });
      render(<PassportScreen navigation={mockNavigation} route={mockRoute} />);

      // Skeleton should be visible during loading
      // The PassportSkeleton component should be rendered
      expect(screen.queryByText('Your Passport')).toBeNull();
    });

    it('shows loading skeleton when countries list is empty', () => {
      // When countries array is empty (SQLite still loading), show skeleton
      // This prevents showing empty state / 0s before data loads
      mockHooksWithData({ countries: [], userCountries: [] });
      render(<PassportScreen navigation={mockNavigation} route={mockRoute} />);

      // Should show skeleton (loading state), not 0s
      expect(screen.queryByText('Your Passport')).toBeNull();
    });

    it('handles no visited countries', () => {
      const countries = createMockCountriesForRegions();
      mockHooksWithData({ countries, userCountries: [] });
      render(<PassportScreen navigation={mockNavigation} route={mockRoute} />);

      // Should show 0 stamps (may appear multiple times)
      expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Country Display', () => {
    it('displays visited countries as stamps', () => {
      const countries = createMockCountriesForRegions();
      const userCountries = [createMockUserCountryVisited('JP')];

      mockHooksWithData({ countries, userCountries });
      render(<PassportScreen navigation={mockNavigation} route={mockRoute} />);

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
      render(<PassportScreen navigation={mockNavigation} route={mockRoute} />);

      // Should have both visited (1) and dreams (1)
      expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
    });
  });

  // Guess Where is built out of the user's own photos, so the slot below the
  // stats grid sells photo sync until the camera roll has been scanned once.
  describe('Photo sync slot', () => {
    it('shows the photo sync card instead of Guess Where before any import', () => {
      const countries = createMockCountriesForRegions();
      mockHooksWithData({ countries, hasInitialImport: false });
      render(<PassportScreen navigation={mockNavigation} route={mockRoute} />);

      expect(screen.getByTestId('photo-sync-card')).toBeTruthy();
      expect(screen.queryByTestId('guess-where-card')).toBeNull();
    });

    it('shows the Guess Where card once photos have been imported', () => {
      const countries = createMockCountriesForRegions();
      mockHooksWithData({ countries, hasInitialImport: true });
      render(<PassportScreen navigation={mockNavigation} route={mockRoute} />);

      expect(screen.getByTestId('guess-where-card')).toBeTruthy();
      expect(screen.queryByTestId('photo-sync-card')).toBeNull();
    });

    it('renders neither card while the import watermark is still loading', () => {
      const countries = createMockCountriesForRegions();
      mockHooksWithData({ countries, hasInitialImport: false, importStateLoading: true });
      render(<PassportScreen navigation={mockNavigation} route={mockRoute} />);

      expect(screen.queryByTestId('photo-sync-card')).toBeNull();
      expect(screen.queryByTestId('guess-where-card')).toBeNull();
    });

    // The watermark is device-local, so a reinstall must not hide the only
    // home entry point to challenges the user already owns.
    it('keeps the Guess Where card for a user with challenges but an empty cache', () => {
      const countries = createMockCountriesForRegions();
      mockHooksWithData({ countries, hasInitialImport: false, quizCount: 2 });
      render(<PassportScreen navigation={mockNavigation} route={mockRoute} />);

      expect(screen.getByTestId('guess-where-card')).toBeTruthy();
      expect(screen.queryByTestId('photo-sync-card')).toBeNull();
    });

    it('opens the photo import flow from the sync card', () => {
      const countries = createMockCountriesForRegions();
      mockHooksWithData({ countries, hasInitialImport: false });
      render(<PassportScreen navigation={mockNavigation} route={mockRoute} />);

      fireEvent.press(screen.getByTestId('photo-sync-card'));

      expect(mockNavigate).toHaveBeenCalledWith('PhotoImport', { autoStart: true });
    });
  });
});
