/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Render-count probe for DreamsScreen (U11).
 *
 * Tapping the wishlist (airplane) button on ONE card must not re-render the
 * OTHER visible cards. Previously `animatingCards` (a Set in state) was a
 * dependency of `renderItem` and the per-card props were inline closures, so a
 * single tap re-rendered every visible CountryCard. This probe mocks CountryCard
 * to count renders per code and asserts siblings stay flat when one card is
 * tapped.
 */

import { act, fireEvent, render, screen } from '../utils/testUtils';
import { createMockCountry, createMockNavigation } from '../utils/mockFactories';
import { DreamsScreen } from '@screens/DreamsScreen';

import * as useCountriesModule from '@hooks/useCountries';
import * as useUserCountriesModule from '@hooks/useUserCountries';
import type { DreamsStackScreenProps } from '@navigation/types';

// --- Mock CountryCard to count renders per code -------------------------------

const renderCounts: Record<string, number> = {};

jest.mock('@components/ui', () => {
  const actual = jest.requireActual('@components/ui');
  const ReactLocal = require('react');
  const { Pressable, Text } = require('react-native');

  function MockCountryCard({
    code,
    name,
    onToggleWishlist,
    onPress,
  }: {
    code: string;
    name: string;
    onToggleWishlist: () => void;
    onPress: () => void;
  }) {
    renderCounts[code] = (renderCounts[code] ?? 0) + 1;
    return ReactLocal.createElement(
      Pressable,
      { testID: `country-card-${code}`, onPress },
      ReactLocal.createElement(Text, null, name),
      ReactLocal.createElement(Pressable, {
        testID: `country-card-wishlist-${code}`,
        onPress: onToggleWishlist,
      })
    );
  }

  // Wrap in memo so the probe measures whether STABLE props let the memo hold.
  const MemoCountryCard = ReactLocal.memo(MockCountryCard);

  return {
    ...actual,
    CountryCard: MemoCountryCard,
  };
});

const mockNavigation =
  createMockNavigation() as unknown as DreamsStackScreenProps<'DreamsHome'>['navigation'];
const mockRoute = {
  key: 'test',
  name: 'DreamsHome',
} as DreamsStackScreenProps<'DreamsHome'>['route'];

function mockData() {
  const countries = [
    createMockCountry({ code: 'JP', name: 'Japan' }),
    createMockCountry({ code: 'FR', name: 'France' }),
    createMockCountry({ code: 'BR', name: 'Brazil' }),
  ];

  jest.spyOn(useCountriesModule, 'useCountries').mockReturnValue({
    data: countries,
    isLoading: false,
    error: null,
    refetch: jest.fn(),
  });
  jest.spyOn(useUserCountriesModule, 'useUserCountries').mockReturnValue({
    data: [],
    isLoading: false,
  } as ReturnType<typeof useUserCountriesModule.useUserCountries>);
  jest.spyOn(useUserCountriesModule, 'useAddUserCountry').mockReturnValue({
    mutate: jest.fn(),
  } as unknown as ReturnType<typeof useUserCountriesModule.useAddUserCountry>);
  jest.spyOn(useUserCountriesModule, 'useRemoveUserCountry').mockReturnValue({
    mutate: jest.fn(),
  } as unknown as ReturnType<typeof useUserCountriesModule.useRemoveUserCountry>);
}

describe('DreamsScreen render-count hygiene', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(renderCounts)) delete renderCounts[key];
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('tapping one card does not re-render sibling cards', () => {
    mockData();
    render(<DreamsScreen navigation={mockNavigation} route={mockRoute} />);

    // Baseline: every card has rendered at least once.
    expect(renderCounts.JP).toBeGreaterThanOrEqual(1);
    expect(renderCounts.FR).toBeGreaterThanOrEqual(1);
    expect(renderCounts.BR).toBeGreaterThanOrEqual(1);

    const frBefore = renderCounts.FR;
    const brBefore = renderCounts.BR;

    // Tap the wishlist button on the JP card only.
    act(() => {
      fireEvent.press(screen.getByTestId('country-card-wishlist-JP'));
    });

    // Siblings (FR, BR) must NOT have re-rendered from the JP tap. Their memo
    // holds because they receive stable per-id callbacks and their render is no
    // longer gated on shared `animatingCards` state.
    expect(renderCounts.FR).toBe(frBefore);
    expect(renderCounts.BR).toBe(brBefore);
  });
});
