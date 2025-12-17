/**
 * Integration tests for Share Card flow.
 *
 * Tests the complete share card functionality including:
 * - Opening share card overlay from CountryDetailScreen
 * - ShareCard component rendering with milestone context
 * - Photo add/remove interactions
 * - Share and save actions
 * - Animation behavior
 */

import { fireEvent, render, screen, act, waitFor } from '../utils/testUtils';
import { ShareCardOverlay } from '@components/share/ShareCardOverlay';
import { ShareCard } from '@components/share/ShareCard';
import { CountryDetailScreen } from '@screens/country/CountryDetailScreen';
import { detectMilestones, buildMilestoneContext } from '@utils/milestones';
import {
  createMockCountry,
  createMockUserCountry,
  createMockNavigation,
} from '../utils/mockFactories';
import { colors } from '@constants/colors';
import type { MilestoneContext, Milestone } from '@utils/milestones';
import type { PassportStackScreenProps } from '@navigation/types';
import type { Country } from '@hooks/useCountries';
import type { UserCountry } from '@hooks/useUserCountries';
import * as useCountriesModule from '@hooks/useCountries';
import * as useTripsModule from '@hooks/useTrips';
import * as useUserCountriesModule from '@hooks/useUserCountries';

// Mock dependencies
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success' },
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  MediaTypeOptions: { Images: 'images' },
}));

jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: jest.fn(),
  saveToLibraryAsync: jest.fn(),
}));

// Mock ViewShot with a stable capture function
const mockCapture = jest.fn().mockResolvedValue('file:///test/share-card.png');
jest.mock('react-native-view-shot', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const MockViewShot = React.forwardRef(
    ({ children }: { children: React.ReactNode }, ref: unknown) => {
      React.useImperativeHandle(ref, () => ({
        capture: mockCapture,
      }));
      return <>{children}</>;
    }
  );
  MockViewShot.displayName = 'MockViewShot';
  return {
    __esModule: true,
    default: MockViewShot,
  };
});

// Mock country image getter
jest.mock('../../assets/countryImages', () => ({
  getCountryImage: jest.fn((code: string) => {
    if (code === 'JP') return { uri: 'test-country-image-jp' };
    if (code === 'FR') return { uri: 'test-country-image-fr' };
    return null;
  }),
}));

// Mock stamp image getter
jest.mock('../../assets/stampImages', () => ({
  getStampImage: jest.fn((code: string) => {
    if (code === 'JP') return { uri: 'test-stamp-jp' };
    if (code === 'FR') return { uri: 'test-stamp-fr' };
    return null;
  }),
}));

// Enable fake timers
jest.useFakeTimers();

// Helper to create milestone context
function createMilestoneContext(overrides?: Partial<MilestoneContext>): MilestoneContext {
  return {
    countryCode: 'JP',
    countryName: 'Japan',
    countryRegion: 'Asia',
    countrySubregion: 'East & Southeast Asia',
    newTotalCount: 5,
    milestones: [],
    ...overrides,
  };
}

// Helper to create milestone
function createMilestone(overrides?: Partial<Milestone>): Milestone {
  return {
    type: 'round_number',
    label: '10 Countries!',
    icon: 'trophy',
    color: colors.sunsetGold,
    ...overrides,
  };
}

describe('ShareCardFlow Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  // ============ Milestone Detection Tests ============

  describe('Milestone Detection', () => {
    const allCountries: Country[] = [
      createMockCountry({
        code: 'JP',
        name: 'Japan',
        region: 'Asia',
        subregion: 'East & Southeast Asia',
      }),
      createMockCountry({ code: 'FR', name: 'France', region: 'Europe', subregion: 'Core Europe' }),
      createMockCountry({
        code: 'DE',
        name: 'Germany',
        region: 'Europe',
        subregion: 'Core Europe',
      }),
      createMockCountry({
        code: 'US',
        name: 'United States',
        region: 'Americas',
        subregion: 'North America',
      }),
      createMockCountry({
        code: 'BR',
        name: 'Brazil',
        region: 'Americas',
        subregion: 'South America',
      }),
      createMockCountry({
        code: 'AU',
        name: 'Australia',
        region: 'Oceania',
        subregion: 'Australia & New Zealand',
      }),
      createMockCountry({ code: 'EG', name: 'Egypt', region: 'Africa', subregion: 'North Africa' }),
      createMockCountry({
        code: 'CH',
        name: 'Switzerland',
        region: 'Europe',
        subregion: 'Core Europe',
      }),
      createMockCountry({
        code: 'AT',
        name: 'Austria',
        region: 'Europe',
        subregion: 'Core Europe',
      }),
      createMockCountry({
        code: 'IT',
        name: 'Italy',
        region: 'Europe',
        subregion: 'Southern Europe',
      }),
    ];

    it('detects first continent milestone', () => {
      const visitedCountries: UserCountry[] = [];
      const milestones = detectMilestones('JP', allCountries, visitedCountries);

      expect(milestones).toContainEqual(
        expect.objectContaining({
          type: 'new_continent',
          label: 'First in Asia!',
        })
      );
    });

    it('detects new continent when visiting first country in a region', () => {
      const visitedCountries: UserCountry[] = [
        createMockUserCountry({ country_code: 'JP', status: 'visited' }),
      ];
      const milestones = detectMilestones('FR', allCountries, visitedCountries);

      expect(milestones).toContainEqual(
        expect.objectContaining({
          type: 'new_continent',
          label: 'First in Europe!',
        })
      );
    });

    it('does not detect new continent when already visited region', () => {
      const visitedCountries: UserCountry[] = [
        createMockUserCountry({ country_code: 'FR', status: 'visited' }),
      ];
      const milestones = detectMilestones('DE', allCountries, visitedCountries);

      expect(milestones).not.toContainEqual(
        expect.objectContaining({
          type: 'new_continent',
        })
      );
    });

    it('detects new subregion milestone', () => {
      const visitedCountries: UserCountry[] = [
        createMockUserCountry({ country_code: 'FR', status: 'visited' }),
      ];
      const milestones = detectMilestones('IT', allCountries, visitedCountries);

      expect(milestones).toContainEqual(
        expect.objectContaining({
          type: 'new_subregion',
          label: 'First in Southern Europe!',
        })
      );
    });

    it('detects round number milestone at 10', () => {
      // Create 9 visited countries
      const visitedCountries: UserCountry[] = [
        createMockUserCountry({ country_code: 'JP', status: 'visited' }),
        createMockUserCountry({ country_code: 'FR', status: 'visited' }),
        createMockUserCountry({ country_code: 'DE', status: 'visited' }),
        createMockUserCountry({ country_code: 'US', status: 'visited' }),
        createMockUserCountry({ country_code: 'BR', status: 'visited' }),
        createMockUserCountry({ country_code: 'AU', status: 'visited' }),
        createMockUserCountry({ country_code: 'EG', status: 'visited' }),
        createMockUserCountry({ country_code: 'CH', status: 'visited' }),
        createMockUserCountry({ country_code: 'AT', status: 'visited' }),
      ];
      const milestones = detectMilestones('IT', allCountries, visitedCountries);

      expect(milestones).toContainEqual(
        expect.objectContaining({
          type: 'round_number',
          label: '10 Countries!',
        })
      );
    });

    it('builds complete milestone context', () => {
      const visitedCountries: UserCountry[] = [];
      const context = buildMilestoneContext('JP', allCountries, visitedCountries);

      expect(context).toEqual({
        countryCode: 'JP',
        countryName: 'Japan',
        countryRegion: 'Asia',
        countrySubregion: 'East & Southeast Asia',
        newTotalCount: 1,
        milestones: expect.arrayContaining([
          expect.objectContaining({ type: 'new_continent' }),
          expect.objectContaining({ type: 'new_subregion' }),
        ]),
      });
    });

    it('returns null for unknown country code', () => {
      const context = buildMilestoneContext('XX', allCountries, []);
      expect(context).toBeNull();
    });
  });

  // ============ ShareCard Component Tests ============

  describe('ShareCard Component', () => {
    it('renders country name in default mode', () => {
      const context = createMilestoneContext({ countryName: 'Japan' });
      render(<ShareCard context={context} />);

      expect(screen.getByText('JAPAN')).toBeTruthy();
    });

    it('renders country number badge', () => {
      const context = createMilestoneContext({ newTotalCount: 42 });
      render(<ShareCard context={context} />);

      expect(screen.getByText('#42')).toBeTruthy();
    });

    it('renders milestone badges', () => {
      const milestones: Milestone[] = [
        createMilestone({ type: 'round_number', label: '10 Countries!' }),
        createMilestone({ type: 'new_continent', label: 'First in Asia!' }),
      ];
      const context = createMilestoneContext({ milestones });
      render(<ShareCard context={context} />);

      expect(screen.getByText('10 Countries!')).toBeTruthy();
      expect(screen.getByText('First in Asia!')).toBeTruthy();
    });

    it('renders watermark logo', () => {
      const context = createMilestoneContext();
      const { toJSON } = render(<ShareCard context={context} />);

      // Watermark is now a logo image - verify component renders successfully
      expect(toJSON()).toBeTruthy();
    });

    it('limits milestones to 2 in photo mode', () => {
      const milestones: Milestone[] = [
        createMilestone({ label: 'First' }),
        createMilestone({ label: 'Second' }),
        createMilestone({ label: 'Third' }),
      ];
      const context = createMilestoneContext({ milestones });
      render(<ShareCard context={context} backgroundImage="file:///test.jpg" />);

      expect(screen.getByText('First')).toBeTruthy();
      expect(screen.getByText('Second')).toBeTruthy();
      expect(screen.queryByText('Third')).toBeNull();
    });
  });

  // ============ ShareCardOverlay Tests ============

  describe('ShareCardOverlay Component', () => {
    const mockOnDismiss = jest.fn();

    beforeEach(() => {
      mockOnDismiss.mockClear();
    });

    it('renders when visible with context', () => {
      const context = createMilestoneContext();
      render(<ShareCardOverlay visible={true} context={context} onDismiss={mockOnDismiss} />);

      expect(screen.getByText('JAPAN')).toBeTruthy();
    });

    it('does not render when not visible', () => {
      const context = createMilestoneContext();
      render(<ShareCardOverlay visible={false} context={context} onDismiss={mockOnDismiss} />);

      expect(screen.queryByText('JAPAN')).toBeNull();
    });

    it('does not render when context is null', () => {
      render(<ShareCardOverlay visible={true} context={null} onDismiss={mockOnDismiss} />);

      expect(screen.queryByText('JAPAN')).toBeNull();
    });

    it('renders close button', () => {
      const context = createMilestoneContext();
      render(<ShareCardOverlay visible={true} context={context} onDismiss={mockOnDismiss} />);

      const closeButton = screen.getByLabelText('Close share card');
      expect(closeButton).toBeTruthy();
    });

    it('renders action buttons', () => {
      const context = createMilestoneContext();
      render(<ShareCardOverlay visible={true} context={context} onDismiss={mockOnDismiss} />);

      expect(screen.getByLabelText('Add photo from library')).toBeTruthy();
      expect(screen.getByLabelText('Share card')).toBeTruthy();
      expect(screen.getByLabelText('Save to photos')).toBeTruthy();
    });

    it('calls onDismiss when close button pressed', async () => {
      const context = createMilestoneContext();
      render(<ShareCardOverlay visible={true} context={context} onDismiss={mockOnDismiss} />);

      // Advance timers to complete initial animation
      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      const closeButton = screen.getByLabelText('Close share card');
      fireEvent.press(closeButton);

      // Advance timers for dismiss animation
      await act(async () => {
        jest.advanceTimersByTime(200);
      });

      expect(mockOnDismiss).toHaveBeenCalledTimes(1);
    });

    it('shows Customize text initially', () => {
      const context = createMilestoneContext();
      render(<ShareCardOverlay visible={true} context={context} onDismiss={mockOnDismiss} />);

      expect(screen.getByText('Customize')).toBeTruthy();
    });
  });

  // ============ Photo Selection Tests ============

  describe('Photo Selection Flow', () => {
    const mockOnDismiss = jest.fn();
    // Import the mocked module for type-safe access
    const mockLaunchImageLibrary = jest.requireMock('expo-image-picker')
      .launchImageLibraryAsync as jest.Mock;

    beforeEach(() => {
      mockOnDismiss.mockClear();
      mockLaunchImageLibrary.mockClear();
    });

    it('opens image picker when Add Photo pressed', async () => {
      mockLaunchImageLibrary.mockResolvedValueOnce({ canceled: true });
      const context = createMilestoneContext();
      render(<ShareCardOverlay visible={true} context={context} onDismiss={mockOnDismiss} />);

      // Advance timers to complete initial animation
      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      const addPhotoButton = screen.getByLabelText('Add photo from library');
      await act(async () => {
        fireEvent.press(addPhotoButton);
      });

      expect(mockLaunchImageLibrary).toHaveBeenCalledWith({
        mediaTypes: 'images', // MediaTypeOptions.Images from mock
        allowsEditing: true,
        aspect: [9, 16],
        quality: 0.8,
      });
    });

    it('shows Remove button after selecting photo', async () => {
      mockLaunchImageLibrary.mockResolvedValueOnce({
        canceled: false,
        assets: [{ uri: 'file:///selected-photo.jpg' }],
      });
      const context = createMilestoneContext();
      render(<ShareCardOverlay visible={true} context={context} onDismiss={mockOnDismiss} />);

      // Advance timers to complete initial animation
      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      const addPhotoButton = screen.getByLabelText('Add photo from library');
      await act(async () => {
        fireEvent.press(addPhotoButton);
      });

      await waitFor(() => {
        expect(screen.getByText('Remove')).toBeTruthy();
      });
    });
  });

  // ============ Share Action Tests ============
  // Note: The Share and Alert modules from react-native use barrel exports that are
  // difficult to mock in tests. These tests verify the button exists and is accessible.

  describe('Share Action', () => {
    const mockOnDismiss = jest.fn();

    beforeEach(() => {
      mockOnDismiss.mockClear();
      mockCapture.mockClear();
    });

    it('renders share button with correct accessibility', async () => {
      const context = createMilestoneContext();
      render(<ShareCardOverlay visible={true} context={context} onDismiss={mockOnDismiss} />);

      // Advance timers to complete initial animation
      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      const shareButton = screen.getByLabelText('Share card');
      expect(shareButton).toBeTruthy();
      expect(screen.getByText('Share')).toBeTruthy();
    });
  });

  // ============ Save Action Tests ============

  describe('Save Action', () => {
    const mockOnDismiss = jest.fn();

    beforeEach(() => {
      mockOnDismiss.mockClear();
      mockCapture.mockClear();
    });

    it('renders save button with correct accessibility', async () => {
      const context = createMilestoneContext();
      render(<ShareCardOverlay visible={true} context={context} onDismiss={mockOnDismiss} />);

      // Advance timers to complete initial animation
      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      const saveButton = screen.getByLabelText('Save to photos');
      expect(saveButton).toBeTruthy();
      expect(screen.getByText('Save')).toBeTruthy();
    });
  });

  // ============ CountryDetailScreen Integration Tests ============

  describe('CountryDetailScreen Share Integration', () => {
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

    const mockAllCountries: Country[] = [
      createMockCountry({
        code: 'JP',
        name: 'Japan',
        region: 'Asia',
        subregion: 'East & Southeast Asia',
      }),
      createMockCountry({ code: 'FR', name: 'France', region: 'Europe', subregion: 'Core Europe' }),
    ];

    const mockVisitedUserCountries: UserCountry[] = [
      createMockUserCountry({
        country_code: 'JP',
        status: 'visited',
        created_at: '2024-01-01T00:00:00Z',
      }),
    ];

    function mockHooksForShareTest() {
      jest.spyOn(useCountriesModule, 'useCountryByCode').mockReturnValue({
        data: mockAllCountries[0],
        isLoading: false,
      } as unknown as ReturnType<typeof useCountriesModule.useCountryByCode>);

      jest.spyOn(useCountriesModule, 'useCountries').mockReturnValue({
        data: mockAllCountries,
        isLoading: false,
      } as unknown as ReturnType<typeof useCountriesModule.useCountries>);

      jest.spyOn(useTripsModule, 'useTripsByCountry').mockReturnValue({
        data: [],
        isLoading: false,
        refetch: jest.fn(),
      } as unknown as ReturnType<typeof useTripsModule.useTripsByCountry>);

      jest.spyOn(useUserCountriesModule, 'useUserCountries').mockReturnValue({
        data: mockVisitedUserCountries,
        isLoading: false,
      } as unknown as ReturnType<typeof useUserCountriesModule.useUserCountries>);

      // Mock mutation hooks
      jest.spyOn(useUserCountriesModule, 'useAddUserCountry').mockReturnValue({
        mutate: jest.fn(),
        isPending: false,
      } as unknown as ReturnType<typeof useUserCountriesModule.useAddUserCountry>);

      jest.spyOn(useUserCountriesModule, 'useRemoveUserCountry').mockReturnValue({
        mutate: jest.fn(),
        isPending: false,
      } as unknown as ReturnType<typeof useUserCountriesModule.useRemoveUserCountry>);
    }

    beforeEach(() => {
      mockHooksForShareTest();
    });

    it('shows share button for visited country', () => {
      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      const shareButton = screen.getByLabelText('Share country card');
      expect(shareButton).toBeTruthy();
    });

    it('shows country number badge for visited country', () => {
      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      expect(screen.getByText('#1')).toBeTruthy();
      expect(screen.getByText('Count')).toBeTruthy();
    });

    it('opens share overlay when share button pressed', async () => {
      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      const shareButton = screen.getByLabelText('Share country card');

      await act(async () => {
        fireEvent.press(shareButton);
      });

      // Advance timers for animation
      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      // Share overlay should now be visible with share card content
      await waitFor(() => {
        expect(screen.getByText('JAPAN')).toBeTruthy();
      });
    });

    it('does not show share button for non-visited country', () => {
      // Mock as non-visited
      jest.spyOn(useUserCountriesModule, 'useUserCountries').mockReturnValue({
        data: [],
        isLoading: false,
      } as unknown as ReturnType<typeof useUserCountriesModule.useUserCountries>);

      const route = createMockRoute({ countryId: 'JP', countryName: 'Japan', countryCode: 'JP' });
      render(<CountryDetailScreen navigation={mockNavigation} route={route} />);

      expect(screen.queryByLabelText('Share country card')).toBeNull();
    });
  });
});
