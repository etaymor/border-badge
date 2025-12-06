/**
 * Tests for DreamsScreen
 *
 * Covers:
 * - Rendering states (loading, empty, with data)
 * - Sorting/filtering (wishlisted first, exclude visited, alphabetical)
 * - Search functionality
 * - User interactions (navigation, add visited, toggle wishlist)
 * - Animation timing with fake timers
 * - Snackbar undo functionality
 * - Error handling
 */

import { act, fireEvent, render, screen } from '../utils/testUtils';
import { createMockCountry, createMockNavigation, createMockUserCountry } from '../utils/mockFactories';

import { DreamsScreen } from '@screens/DreamsScreen';
import * as useCountriesModule from '@hooks/useCountries';
import * as useUserCountriesModule from '@hooks/useUserCountries';

import type { Country } from '@hooks/useCountries';
import type { UserCountry } from '@hooks/useUserCountries';
import type { DreamsStackScreenProps } from '@navigation/types';

// Mock navigation and route
const mockNavigation = createMockNavigation() as unknown as DreamsStackScreenProps<'DreamsHome'>['navigation'];
const mockRoute = { key: 'test', name: 'DreamsHome', params: {} } as DreamsStackScreenProps<'DreamsHome'>['route'];

// Helper to mock all hooks with provided data
function mockHooksWithData({
  countries,
  userCountries,
  addMutate = jest.fn(),
  removeMutate = jest.fn(),
}: {
  countries: Country[];
  userCountries: UserCountry[];
  addMutate?: jest.Mock;
  removeMutate?: jest.Mock;
}) {
  jest.spyOn(useCountriesModule, 'useCountries').mockReturnValue({
    data: countries,
    isLoading: false,
    error: null,
  });

  jest.spyOn(useUserCountriesModule, 'useUserCountries').mockReturnValue({
    data: userCountries,
    isLoading: false,
  } as ReturnType<typeof useUserCountriesModule.useUserCountries>);

  jest.spyOn(useUserCountriesModule, 'useAddUserCountry').mockReturnValue({
    mutate: addMutate,
  } as unknown as ReturnType<typeof useUserCountriesModule.useAddUserCountry>);

  jest.spyOn(useUserCountriesModule, 'useRemoveUserCountry').mockReturnValue({
    mutate: removeMutate,
  } as unknown as ReturnType<typeof useUserCountriesModule.useRemoveUserCountry>);
}

describe('DreamsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============ Rendering Tests ============

  describe('Rendering', () => {
    it('renders loading state while data is loading', () => {
      jest.spyOn(useUserCountriesModule, 'useUserCountries').mockReturnValue({
        data: undefined,
        isLoading: true,
      } as ReturnType<typeof useUserCountriesModule.useUserCountries>);
      jest.spyOn(useCountriesModule, 'useCountries').mockReturnValue({
        data: [],
        isLoading: true,
        error: null,
      });
      jest.spyOn(useUserCountriesModule, 'useAddUserCountry').mockReturnValue({
        mutate: jest.fn(),
      } as unknown as ReturnType<typeof useUserCountriesModule.useAddUserCountry>);
      jest.spyOn(useUserCountriesModule, 'useRemoveUserCountry').mockReturnValue({
        mutate: jest.fn(),
      } as unknown as ReturnType<typeof useUserCountriesModule.useRemoveUserCountry>);

      render(<DreamsScreen navigation={mockNavigation} route={mockRoute} />);

      expect(screen.getByText('Loading...')).toBeTruthy();
    });

    it('renders empty state when no countries available', () => {
      mockHooksWithData({ countries: [], userCountries: [] });

      render(<DreamsScreen navigation={mockNavigation} route={mockRoute} />);

      expect(screen.getByText('Start dreaming!')).toBeTruthy();
    });

    it('renders search input', () => {
      mockHooksWithData({ countries: [createMockCountry()], userCountries: [] });

      render(<DreamsScreen navigation={mockNavigation} route={mockRoute} />);

      expect(screen.getByPlaceholderText('Search countries...')).toBeTruthy();
    });

    it('renders country cards for available countries', () => {
      const countries = [
        createMockCountry({ code: 'JP', name: 'Japan' }),
        createMockCountry({ code: 'FR', name: 'France' }),
      ];
      mockHooksWithData({ countries, userCountries: [] });

      render(<DreamsScreen navigation={mockNavigation} route={mockRoute} />);

      expect(screen.getByText('Japan')).toBeTruthy();
      expect(screen.getByText('France')).toBeTruthy();
    });
  });

  // ============ Sorting/Filtering Tests ============

  describe('Sorting and Filtering', () => {
    it('shows dream countries (wishlisted) before non-wishlisted', () => {
      const countries = [
        createMockCountry({ code: 'JP', name: 'Japan' }),
        createMockCountry({ code: 'FR', name: 'France' }),
        createMockCountry({ code: 'BR', name: 'Brazil' }),
      ];
      const userCountries = [createMockUserCountry({ country_code: 'BR', status: 'wishlist' })];
      mockHooksWithData({ countries, userCountries });

      render(<DreamsScreen navigation={mockNavigation} route={mockRoute} />);

      const cards = screen.getAllByTestId(/^country-card-(?!visited|wishlist)/);
      // Brazil (wishlisted) should come first
      expect(cards[0].props.testID).toBe('country-card-BR');
    });

    it('excludes visited countries from the list', () => {
      const countries = [
        createMockCountry({ code: 'JP', name: 'Japan' }),
        createMockCountry({ code: 'FR', name: 'France' }),
      ];
      const userCountries = [createMockUserCountry({ country_code: 'JP', status: 'visited' })];
      mockHooksWithData({ countries, userCountries });

      render(<DreamsScreen navigation={mockNavigation} route={mockRoute} />);

      expect(screen.queryByText('Japan')).toBeNull();
      expect(screen.getByText('France')).toBeTruthy();
    });

    it('sorts countries alphabetically within each group', () => {
      const countries = [
        createMockCountry({ code: 'US', name: 'United States' }),
        createMockCountry({ code: 'AU', name: 'Australia' }),
        createMockCountry({ code: 'CA', name: 'Canada' }),
      ];
      mockHooksWithData({ countries, userCountries: [] });

      render(<DreamsScreen navigation={mockNavigation} route={mockRoute} />);

      const cards = screen.getAllByTestId(/^country-card-(?!visited|wishlist)/);
      expect(cards[0].props.testID).toBe('country-card-AU');
      expect(cards[1].props.testID).toBe('country-card-CA');
      expect(cards[2].props.testID).toBe('country-card-US');
    });
  });

  // ============ Search Tests ============

  describe('Search Functionality', () => {
    it('filters countries by search query', () => {
      const countries = [
        createMockCountry({ code: 'JP', name: 'Japan' }),
        createMockCountry({ code: 'JM', name: 'Jamaica' }),
        createMockCountry({ code: 'FR', name: 'France' }),
      ];
      mockHooksWithData({ countries, userCountries: [] });

      render(<DreamsScreen navigation={mockNavigation} route={mockRoute} />);

      const searchInput = screen.getByPlaceholderText('Search countries...');
      fireEvent.changeText(searchInput, 'jap');

      expect(screen.getByText('Japan')).toBeTruthy();
      expect(screen.queryByText('Jamaica')).toBeNull();
      expect(screen.queryByText('France')).toBeNull();
    });

    it('shows empty state when search has no results', () => {
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      mockHooksWithData({ countries, userCountries: [] });

      render(<DreamsScreen navigation={mockNavigation} route={mockRoute} />);

      fireEvent.changeText(screen.getByPlaceholderText('Search countries...'), 'xyz');

      expect(screen.getByText('No countries found')).toBeTruthy();
    });

    it('clears search when clear button is pressed', () => {
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      mockHooksWithData({ countries, userCountries: [] });

      render(<DreamsScreen navigation={mockNavigation} route={mockRoute} />);

      const searchInput = screen.getByPlaceholderText('Search countries...');
      fireEvent.changeText(searchInput, 'jap');

      fireEvent.press(screen.getByText('Clear'));

      expect(searchInput.props.value).toBe('');
    });

    it('search is case-insensitive', () => {
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      mockHooksWithData({ countries, userCountries: [] });

      render(<DreamsScreen navigation={mockNavigation} route={mockRoute} />);

      fireEvent.changeText(screen.getByPlaceholderText('Search countries...'), 'JAPAN');

      expect(screen.getByText('Japan')).toBeTruthy();
    });
  });

  // ============ User Interaction Tests ============

  describe('User Interactions', () => {
    it('navigates to CountryDetail when card is pressed', () => {
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      mockHooksWithData({ countries, userCountries: [] });

      render(<DreamsScreen navigation={mockNavigation} route={mockRoute} />);

      fireEvent.press(screen.getByTestId('country-card-JP'));

      expect(mockNavigation.navigate).toHaveBeenCalledWith('CountryDetail', {
        countryId: 'JP',
        countryName: 'Japan',
        countryCode: 'JP',
      });
    });

    it('calls addUserCountry mutation when visited button is pressed', () => {
      const mockMutate = jest.fn();
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      mockHooksWithData({ countries, userCountries: [], addMutate: mockMutate });

      render(<DreamsScreen navigation={mockNavigation} route={mockRoute} />);

      fireEvent.press(screen.getByTestId('country-card-visited-JP'));

      expect(mockMutate).toHaveBeenCalledWith(
        { country_code: 'JP', status: 'visited' },
        expect.objectContaining({ onError: expect.any(Function) })
      );
    });
  });

  // ============ Wishlist Toggle Tests (with Animation) ============

  describe('Wishlist Toggle', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('shows snackbar when adding to wishlist', () => {
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      mockHooksWithData({ countries, userCountries: [] });

      render(<DreamsScreen navigation={mockNavigation} route={mockRoute} />);

      fireEvent.press(screen.getByTestId('country-card-wishlist-JP'));

      expect(screen.getByText('Japan added to your dreams')).toBeTruthy();
    });

    it('calls addUserCountry after animation completes', () => {
      const mockMutate = jest.fn();
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      mockHooksWithData({ countries, userCountries: [], addMutate: mockMutate });

      render(<DreamsScreen navigation={mockNavigation} route={mockRoute} />);

      fireEvent.press(screen.getByTestId('country-card-wishlist-JP'));

      // Mutation should not be called immediately (animation pending)
      expect(mockMutate).not.toHaveBeenCalled();

      // Advance through heart pulse delay (150ms) + card exit animation (250ms)
      act(() => {
        jest.advanceTimersByTime(150 + 250);
      });

      expect(mockMutate).toHaveBeenCalledWith(
        { country_code: 'JP', status: 'wishlist' },
        expect.objectContaining({ onError: expect.any(Function) })
      );
    });

    it('prevents duplicate taps on same card during animation', () => {
      const mockMutate = jest.fn();
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      mockHooksWithData({ countries, userCountries: [], addMutate: mockMutate });

      render(<DreamsScreen navigation={mockNavigation} route={mockRoute} />);

      // Tap twice quickly
      fireEvent.press(screen.getByTestId('country-card-wishlist-JP'));
      fireEvent.press(screen.getByTestId('country-card-wishlist-JP'));

      act(() => {
        jest.advanceTimersByTime(500);
      });

      // Should only mutate once
      expect(mockMutate).toHaveBeenCalledTimes(1);
    });

    it('calls removeUserCountry when removing from wishlist (no animation)', () => {
      const mockRemoveMutate = jest.fn();
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      const userCountries = [createMockUserCountry({ country_code: 'JP', status: 'wishlist' })];
      mockHooksWithData({ countries, userCountries, removeMutate: mockRemoveMutate });

      render(<DreamsScreen navigation={mockNavigation} route={mockRoute} />);

      fireEvent.press(screen.getByTestId('country-card-wishlist-JP'));

      // Remove should happen immediately (no animation)
      expect(mockRemoveMutate).toHaveBeenCalledWith(
        'JP',
        expect.objectContaining({ onError: expect.any(Function) })
      );
    });
  });

  // ============ Snackbar Undo Tests ============

  describe('Snackbar Undo', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('removes country from wishlist when undo is pressed', () => {
      const mockRemoveMutate = jest.fn();
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      mockHooksWithData({ countries, userCountries: [], removeMutate: mockRemoveMutate });

      render(<DreamsScreen navigation={mockNavigation} route={mockRoute} />);

      // Add to wishlist
      fireEvent.press(screen.getByTestId('country-card-wishlist-JP'));

      // Complete animation
      act(() => {
        jest.advanceTimersByTime(500);
      });

      // Press undo
      fireEvent.press(screen.getByText('Undo'));

      expect(mockRemoveMutate).toHaveBeenCalledWith('JP');
    });

    it('auto-dismisses snackbar after duration', () => {
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      mockHooksWithData({ countries, userCountries: [] });

      render(<DreamsScreen navigation={mockNavigation} route={mockRoute} />);

      fireEvent.press(screen.getByTestId('country-card-wishlist-JP'));

      expect(screen.getByText('Japan added to your dreams')).toBeTruthy();

      act(() => {
        jest.advanceTimersByTime(3000);
      });

      expect(screen.queryByText('Japan added to your dreams')).toBeNull();
    });
  });

  // ============ Error Handling Tests ============

  describe('Error Handling', () => {
    it('shows error snackbar when add visited fails', () => {
      const mockMutate = jest.fn((_, options) => {
        options?.onError?.(new Error('Network error'));
      });
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      mockHooksWithData({ countries, userCountries: [], addMutate: mockMutate });

      render(<DreamsScreen navigation={mockNavigation} route={mockRoute} />);

      fireEvent.press(screen.getByTestId('country-card-visited-JP'));

      expect(screen.getByText('Failed to mark Japan as visited')).toBeTruthy();
    });

    it('shows error snackbar when add to wishlist fails', () => {
      jest.useFakeTimers();

      const mockMutate = jest.fn((_, options) => {
        options?.onError?.(new Error('Network error'));
      });
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      mockHooksWithData({ countries, userCountries: [], addMutate: mockMutate });

      render(<DreamsScreen navigation={mockNavigation} route={mockRoute} />);

      fireEvent.press(screen.getByTestId('country-card-wishlist-JP'));

      // Wait for animation to complete and trigger mutation
      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(screen.getByText('Failed to add Japan to dreams')).toBeTruthy();

      jest.useRealTimers();
    });
  });
});
