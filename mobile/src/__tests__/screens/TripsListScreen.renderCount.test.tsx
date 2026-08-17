/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Render-count probe for TripsListScreen (U11).
 *
 * A parent re-render (e.g. typing in the search box, which does not change the
 * filtered result set) must NOT re-render the TripCard memo components. Before
 * U11 the inline `onPress={() => handleTripPress(item.id)}` closure gave each
 * card a fresh prop identity on every render, defeating TripCard's React.memo.
 * With stable per-id callbacks the memo holds.
 */

import { act, fireEvent, render, screen } from '../utils/testUtils';
import { createMockTrip, createMockNavigation } from '../utils/mockFactories';
import { TripsListScreen } from '@screens/trips/TripsListScreen';

import * as useTripsModule from '@hooks/useTrips';
import * as useCountriesModule from '@hooks/useCountries';
import * as useUserCountriesModule from '@hooks/useUserCountries';
import * as authStoreModule from '@stores/authStore';
import type { TripsStackScreenProps } from '@navigation/types';

// Must match the default user_id in createMockTrip so the "My Trips" tab shows them
const CURRENT_USER_ID = 'user-123';

// --- Mock TripCard to count renders per trip id -------------------------------

const renderCounts: Record<string, number> = {};

jest.mock('@components/ui', () => {
  const actual = jest.requireActual('@components/ui');
  const ReactLocal = require('react');
  const { Pressable, Text } = require('react-native');

  function MockTripCard({
    trip,
    onPress,
  }: {
    trip: { id: string; name: string };
    onPress: () => void;
  }) {
    renderCounts[trip.id] = (renderCounts[trip.id] ?? 0) + 1;
    return ReactLocal.createElement(
      Pressable,
      { testID: `trip-card-${trip.id}`, onPress },
      ReactLocal.createElement(Text, null, trip.name)
    );
  }

  // memo so the probe measures whether STABLE props let the memo hold.
  const MemoTripCard = ReactLocal.memo(MockTripCard);

  return {
    ...actual,
    TripCard: MemoTripCard,
  };
});

const mockNavigation =
  createMockNavigation() as unknown as TripsStackScreenProps<'TripsList'>['navigation'];
const mockRoute = {
  key: 'test',
  name: 'TripsList',
} as TripsStackScreenProps<'TripsList'>['route'];

function mockData() {
  const trips = [
    // Shared "Trip" substring so a search for "trip" keeps BOTH in the same
    // section — the result set is unchanged, only the parent re-renders.
    createMockTrip({ id: 'trip-1', name: 'Trip Alpha', country_code: 'JP', country_id: 'JP' }),
    createMockTrip({ id: 'trip-2', name: 'Trip Beta', country_code: 'FR', country_id: 'FR' }),
  ];

  jest.spyOn(useTripsModule, 'useTrips').mockReturnValue({
    data: trips,
    isLoading: false,
    isRefetching: false,
    refetch: jest.fn(),
    error: null,
  } as unknown as ReturnType<typeof useTripsModule.useTrips>);

  jest.spyOn(useCountriesModule, 'useCountries').mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useCountriesModule.useCountries>);

  jest.spyOn(useUserCountriesModule, 'useUserCountries').mockReturnValue({
    data: [],
    isLoading: false,
  } as unknown as ReturnType<typeof useUserCountriesModule.useUserCountries>);

  jest.spyOn(authStoreModule, 'useAuthStore').mockImplementation((selector) => {
    const state = {
      session: { user: { id: CURRENT_USER_ID } },
    } as authStoreModule.AuthState;
    return (selector as (s: authStoreModule.AuthState) => unknown)(state);
  });
}

describe('TripsListScreen render-count hygiene', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(renderCounts)) delete renderCounts[key];
  });

  it('TripCard memo holds across a parent re-render', () => {
    mockData();
    render(<TripsListScreen navigation={mockNavigation} route={mockRoute} />);

    expect(renderCounts['trip-1']).toBeGreaterThanOrEqual(1);
    expect(renderCounts['trip-2']).toBeGreaterThanOrEqual(1);

    const before1 = renderCounts['trip-1'];
    const before2 = renderCounts['trip-2'];

    // Trigger a parent re-render that does NOT change the visible trip set:
    // searching "trip" keeps BOTH "Trip Alpha" and "Trip Beta". The parent
    // re-renders, but TripCard receives the same stable `trip` object and the
    // same stable per-id `onPress`, so its memo must hold.
    act(() => {
      fireEvent.changeText(screen.getByPlaceholderText('Find a trip or country...'), 'trip');
    });

    expect(renderCounts['trip-1']).toBe(before1);
    expect(renderCounts['trip-2']).toBe(before2);
  });
});
