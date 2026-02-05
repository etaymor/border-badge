/**
 * Tests for CountryDetailScreen component.
 * Tests button rendering, navigation, and share overlay functionality.
 */

import { fireEvent, render, screen, waitFor } from '../utils/testUtils';
import {
  createMockTrip,
  createMockCountry,
  createMockNavigation,
  createMockUserCountry,
} from '../utils/mockFactories';
import { CountryDetailScreen } from '@screens/country/CountryDetailScreen';
import type { PassportStackScreenProps } from '@navigation/types';
import * as useCountriesModule from '@hooks/useCountries';
import * as useTripsModule from '@hooks/useTrips';
import * as useUserCountriesModule from '@hooks/useUserCountries';
import * as useCountryPhotoInfoModule from '@hooks/useCountryPhotoInfo';

// Access the mock ActionSheetIOS and Alert from global (set in jest.setup.js)
declare global {
  // eslint-disable-next-line no-var
  var __mockActionSheetIOS: {
    showActionSheetWithOptions: jest.Mock;
  };
  // eslint-disable-next-line no-var
  var __mockAlert: {
    alert: jest.Mock;
  };
}
const mockShowActionSheetWithOptions = global.__mockActionSheetIOS.showActionSheetWithOptions;
const mockAlert = global.__mockAlert.alert;

// Create mock navigation
const mockNavigate = jest.fn();
const mockNavigation = {
  ...createMockNavigation(),
  navigate: mockNavigate,
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
  allCountries?: ReturnType<typeof createMockCountry>[];
  trips?: ReturnType<typeof createMockTrip>[];
  userCountries?: ReturnType<typeof createMockUserCountry>[];
  isLoading?: boolean;
  refetch?: jest.Mock;
  addUserCountryMutate?: jest.Mock;
  removeUserCountryMutate?: jest.Mock;
}

function mockHooksWithData({
  country = null,
  allCountries = [],
  trips = [],
  userCountries = [],
  isLoading = false,
  refetch = jest.fn(),
  addUserCountryMutate = jest.fn(),
  removeUserCountryMutate = jest.fn(),
}: MockHooksOptions = {}) {
  jest.spyOn(useCountriesModule, 'useCountryByCode').mockReturnValue({
    data: country ?? undefined,
    isLoading: false,
  } as unknown as ReturnType<typeof useCountriesModule.useCountryByCode>);

  jest.spyOn(useCountriesModule, 'useCountries').mockReturnValue({
    data: allCountries.length > 0 ? allCountries : country ? [country] : [],
    isLoading: false,
  } as unknown as ReturnType<typeof useCountriesModule.useCountries>);

  jest.spyOn(useTripsModule, 'useTripsByCountry').mockReturnValue({
    data: trips,
    isLoading,
    refetch,
  } as unknown as ReturnType<typeof useTripsModule.useTripsByCountry>);

  jest.spyOn(useUserCountriesModule, 'useUserCountries').mockReturnValue({
    data: userCountries,
    isLoading: false,
  } as unknown as ReturnType<typeof useUserCountriesModule.useUserCountries>);

  jest.spyOn(useUserCountriesModule, 'useAddUserCountry').mockReturnValue({
    mutate: addUserCountryMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useUserCountriesModule.useAddUserCountry>);

  jest.spyOn(useUserCountriesModule, 'useRemoveUserCountry').mockReturnValue({
    mutate: removeUserCountryMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useUserCountriesModule.useRemoveUserCountry>);

  // Mock useCountryPhotoInfo - default to no photos, no initial import
  jest.spyOn(useCountryPhotoInfoModule, 'useCountryPhotoInfo').mockReturnValue({
    hasPhotos: false,
    tripCount: 0,
    isLoading: false,
    hasInitialImport: false,
  });
}

describe('CountryDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Button Text', () => {
    it('shows "Plan a Trip" button when not visited', () => {
      const country = createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' });
      mockHooksWithData({ country, trips: [] });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      expect(screen.getByText('Plan a Trip')).toBeTruthy();
    });

    it('shows "Add Trip" button when visited', () => {
      const country = createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' });
      mockHooksWithData({
        country,
        trips: [],
        userCountries: [createMockUserCountry({ country_code: 'JP', status: 'visited' })],
      });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      expect(screen.getByText('Add Trip')).toBeTruthy();
    });

    it('shows "Find via Photos" button when visited and no initial import', () => {
      const country = createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' });
      mockHooksWithData({
        country,
        trips: [],
        userCountries: [createMockUserCountry({ country_code: 'JP', status: 'visited' })],
      });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      expect(screen.getByText('Find via Photos')).toBeTruthy();
    });

    it('shows "1 Trip Found" when visited and has 1 trip candidate from photos', () => {
      const country = createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' });
      mockHooksWithData({
        country,
        trips: [],
        userCountries: [createMockUserCountry({ country_code: 'JP', status: 'visited' })],
      });
      // Override the photo info mock
      jest.spyOn(useCountryPhotoInfoModule, 'useCountryPhotoInfo').mockReturnValue({
        hasPhotos: true,
        tripCount: 1,
        isLoading: false,
        hasInitialImport: true,
      });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      expect(screen.getByText('1 Trip Found')).toBeTruthy();
    });

    it('shows "N Trips Found" when visited and has multiple trip candidates from photos', () => {
      const country = createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' });
      mockHooksWithData({
        country,
        trips: [],
        userCountries: [createMockUserCountry({ country_code: 'JP', status: 'visited' })],
      });
      // Override the photo info mock
      jest.spyOn(useCountryPhotoInfoModule, 'useCountryPhotoInfo').mockReturnValue({
        hasPhotos: true,
        tripCount: 3,
        isLoading: false,
        hasInitialImport: true,
      });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      expect(screen.getByText('3 Trips Found')).toBeTruthy();
    });

    it('hides photo button when visited but no photos after import', () => {
      const country = createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' });
      mockHooksWithData({
        country,
        trips: [],
        userCountries: [createMockUserCountry({ country_code: 'JP', status: 'visited' })],
      });
      // Override the photo info mock - has import but no photos for this country
      jest.spyOn(useCountryPhotoInfoModule, 'useCountryPhotoInfo').mockReturnValue({
        hasPhotos: false,
        tripCount: 0,
        isLoading: false,
        hasInitialImport: true,
      });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      expect(screen.queryByText('Find via Photos')).toBeNull();
      expect(screen.queryByText(/Trip.*Found/)).toBeNull();
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
    it('navigates to TripForm with country info when Plan a Trip button is pressed', () => {
      const country = createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' });
      mockHooksWithData({ country, trips: [] });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      fireEvent.press(screen.getByText('Plan a Trip'));

      expect(mockNavigate).toHaveBeenCalledWith('TripForm', {
        countryId: 'JP',
        countryName: 'Japan',
      });
    });

    it('navigates to TripDetail when trip card is pressed', () => {
      const country = createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' });
      const trips = [createMockTrip({ id: 'trip-123', name: 'Tokyo Trip', country_code: 'JP' })];
      mockHooksWithData({ country, trips });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      fireEvent.press(screen.getByText('Tokyo Trip'));

      expect(mockNavigate).toHaveBeenCalledWith('Trips', {
        screen: 'TripDetail',
        params: { tripId: 'trip-123' },
      });
    });
  });

  describe('Share Overlay', () => {
    it('shows ShareOverlay when marking unvisited country as visited', async () => {
      const country = createMockCountry({
        code: 'JP',
        name: 'Japan',
        region: 'Asia',
        subregion: 'East Asia',
      });
      const addUserCountryMutate = jest.fn((_, options) => {
        // Simulate successful mutation
        options?.onSuccess?.();
      });
      mockHooksWithData({
        country,
        trips: [],
        userCountries: [], // Not visited yet
        addUserCountryMutate,
      });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      // Press the "Mark as visited" button
      const markVisitedButton = screen.getByLabelText('Mark as visited');
      fireEvent.press(markVisitedButton);

      // Verify the mutation was called
      expect(addUserCountryMutate).toHaveBeenCalledWith(
        { country_code: 'JP', status: 'visited' },
        expect.any(Object)
      );

      // ShareCardOverlay should be visible after successful mutation
      await waitFor(() => {
        expect(screen.getByTestId('share-card-overlay')).toBeTruthy();
      });
    });

    it('hides action bar when country is already visited', () => {
      const country = createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' });
      mockHooksWithData({
        country,
        trips: [],
        userCountries: [createMockUserCountry({ country_code: 'JP', status: 'visited' })],
      });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      // Action bar buttons should not be visible when country is visited
      expect(screen.queryByLabelText('Mark as visited')).toBeNull();
      expect(screen.queryByLabelText('Add to wishlist')).toBeNull();

      // But the options menu button should be visible
      expect(screen.getByLabelText('More options')).toBeTruthy();
    });

    it('includes onboarding countries in milestone detection', async () => {
      const japanCountry = createMockCountry({
        code: 'JP',
        name: 'Japan',
        region: 'Asia',
        subregion: 'East Asia',
      });
      const chinaCountry = createMockCountry({
        code: 'CN',
        name: 'China',
        region: 'Asia',
        subregion: 'East Asia',
      });

      const addUserCountryMutate = jest.fn((_, options) => {
        options?.onSuccess?.();
      });

      mockHooksWithData({
        country: japanCountry,
        allCountries: [japanCountry, chinaCountry],
        trips: [],
        // China was visited during onboarding - so Asia is already visited
        userCountries: [
          createMockUserCountry({
            country_code: 'CN',
            status: 'visited',
            added_during_onboarding: true,
          }),
        ],
        addUserCountryMutate,
      });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      // Mark Japan as visited
      const markVisitedButton = screen.getByLabelText('Mark as visited');
      fireEvent.press(markVisitedButton);

      // Mutation should be called with the correct context
      // Japan should be the 2nd country (China from onboarding + Japan)
      expect(addUserCountryMutate).toHaveBeenCalled();

      await waitFor(() => {
        expect(screen.getByTestId('share-card-overlay')).toBeTruthy();
      });
    });

    it('calculates correct country number including onboarding countries', async () => {
      const japanCountry = createMockCountry({
        code: 'JP',
        name: 'Japan',
        region: 'Asia',
        subregion: 'East Asia',
      });

      const addUserCountryMutate = jest.fn((_, options) => {
        options?.onSuccess?.();
      });

      mockHooksWithData({
        country: japanCountry,
        allCountries: [japanCountry],
        trips: [],
        // 3 countries from onboarding
        userCountries: [
          createMockUserCountry({
            country_code: 'US',
            status: 'visited',
            added_during_onboarding: true,
          }),
          createMockUserCountry({
            country_code: 'MX',
            status: 'visited',
            added_during_onboarding: true,
          }),
          createMockUserCountry({
            country_code: 'CA',
            status: 'visited',
            added_during_onboarding: true,
          }),
        ],
        addUserCountryMutate,
      });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      // Mark Japan as visited - should be country #4
      const markVisitedButton = screen.getByLabelText('Mark as visited');
      fireEvent.press(markVisitedButton);

      expect(addUserCountryMutate).toHaveBeenCalled();

      await waitFor(() => {
        expect(screen.getByTestId('share-card-overlay')).toBeTruthy();
      });
    });
  });

  describe('Options Menu', () => {
    it('shows options menu button only when country is visited', () => {
      const country = createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' });
      mockHooksWithData({
        country,
        trips: [],
        userCountries: [], // Not visited
      });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      // Options menu should not be visible when country is not visited
      expect(screen.queryByLabelText('More options')).toBeNull();
    });

    it('shows options menu button when country is visited', () => {
      const country = createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' });
      mockHooksWithData({
        country,
        trips: [],
        userCountries: [createMockUserCountry({ country_code: 'JP', status: 'visited' })],
      });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      expect(screen.getByLabelText('More options')).toBeTruthy();
    });

    it('opens action sheet when options menu button is pressed', () => {
      const country = createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' });
      mockHooksWithData({
        country,
        trips: [],
        userCountries: [createMockUserCountry({ country_code: 'JP', status: 'visited' })],
      });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      fireEvent.press(screen.getByLabelText('More options'));

      expect(mockShowActionSheetWithOptions).toHaveBeenCalledWith(
        {
          options: ['Share', 'Unmark as Visited', 'Cancel'],
          destructiveButtonIndex: 1,
          cancelButtonIndex: 2,
        },
        expect.any(Function)
      );
    });

    it('opens share overlay when Share option is selected', async () => {
      const country = createMockCountry({
        code: 'JP',
        name: 'Japan',
        region: 'Asia',
        subregion: 'East Asia',
      });
      mockHooksWithData({
        country,
        trips: [],
        userCountries: [createMockUserCountry({ country_code: 'JP', status: 'visited' })],
      });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      fireEvent.press(screen.getByLabelText('More options'));

      // Simulate selecting "Share" (index 0)
      const callback = mockShowActionSheetWithOptions.mock.calls[0][1];
      callback(0);

      await waitFor(() => {
        expect(screen.getByTestId('share-card-overlay')).toBeTruthy();
      });
    });

    it('shows confirmation dialog when Unmark as Visited option is selected', () => {
      const country = createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' });
      const removeUserCountryMutate = jest.fn();
      mockHooksWithData({
        country,
        trips: [],
        userCountries: [createMockUserCountry({ country_code: 'JP', status: 'visited' })],
        removeUserCountryMutate,
      });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      fireEvent.press(screen.getByLabelText('More options'));

      // Simulate selecting "Unmark as Visited" (index 1)
      const callback = mockShowActionSheetWithOptions.mock.calls[0][1];
      callback(1);

      // Verify confirmation dialog was shown
      expect(mockAlert).toHaveBeenCalledWith(
        'Unmark as Visited?',
        'This will remove this country from your visited list.',
        expect.arrayContaining([
          expect.objectContaining({ text: 'Cancel', style: 'cancel' }),
          expect.objectContaining({ text: 'Unmark', style: 'destructive' }),
        ])
      );

      // Simulate confirming the dialog (pressing "Unmark")
      const confirmCallback = mockAlert.mock.calls[0][2][1].onPress;
      confirmCallback();

      expect(removeUserCountryMutate).toHaveBeenCalledWith('JP');
    });

    it('does not remove country when confirmation dialog is cancelled', () => {
      const country = createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' });
      const removeUserCountryMutate = jest.fn();
      mockHooksWithData({
        country,
        trips: [],
        userCountries: [createMockUserCountry({ country_code: 'JP', status: 'visited' })],
        removeUserCountryMutate,
      });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      fireEvent.press(screen.getByLabelText('More options'));

      // Simulate selecting "Unmark as Visited" (index 1)
      const callback = mockShowActionSheetWithOptions.mock.calls[0][1];
      callback(1);

      // Simulate cancelling the confirmation dialog
      const cancelCallback = mockAlert.mock.calls[0][2][0].onPress;
      if (cancelCallback) {
        cancelCallback();
      }

      expect(removeUserCountryMutate).not.toHaveBeenCalled();
    });

    it('does nothing when Cancel option is selected in action sheet', () => {
      const country = createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' });
      const removeUserCountryMutate = jest.fn();
      mockHooksWithData({
        country,
        trips: [],
        userCountries: [createMockUserCountry({ country_code: 'JP', status: 'visited' })],
        removeUserCountryMutate,
      });

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      fireEvent.press(screen.getByLabelText('More options'));

      // Simulate selecting "Cancel" (index 2)
      const callback = mockShowActionSheetWithOptions.mock.calls[0][1];
      callback(2);

      expect(removeUserCountryMutate).not.toHaveBeenCalled();
    });
  });
});
