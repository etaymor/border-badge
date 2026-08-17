/**
 * Golden-value stats test for usePassportData (U11).
 *
 * The O(n^2) stats recompute (repeated `countries.find(...)` inside filters)
 * was replaced with a single code->country Map + O(1) lookups. The stats output
 * MUST be identical. This test builds a 227-country fixture, marks a spread of
 * visited/wishlist countries across regions and recognition types, and asserts
 * the resulting `stats` object equals a value derived independently from the
 * same real constants/helpers the hook uses.
 */

import { renderHook } from '@testing-library/react-native';

import { usePassportData } from '@hooks/usePassportData';
import * as useCountriesModule from '@hooks/useCountries';
import * as useUserCountriesModule from '@hooks/useUserCountries';
import * as useTripsModule from '@hooks/useTrips';
import * as useProfileModule from '@hooks/useProfile';
import { useAuthStore } from '@stores/authStore';
import type { Country } from '@hooks/useCountries';
import type { UserCountry } from '@hooks/useUserCountries';

import {
  getCountryCountForPreference,
  isCountryAllowedByPreference,
} from '@constants/trackingPreferences';
import { getTravelStatus } from '@utils/travelTier';

const REGIONS = ['Asia', 'Europe', 'Africa', 'Americas', 'Oceania'] as const;
const RECOGNITIONS = ['un_member', 'observer', 'disputed', 'territory'] as const;

// Build a deterministic 227-country fixture spread across regions and
// recognition types so the preference filtering path is meaningfully exercised.
function buildCountries(): Country[] {
  const list: Country[] = [];
  for (let i = 0; i < 227; i++) {
    const code = `C${i.toString().padStart(3, '0')}`;
    list.push({
      code,
      name: `Country ${i}`,
      region: REGIONS[i % REGIONS.length],
      subregion: `Sub ${i % 12}`,
      recognition: RECOGNITIONS[i % RECOGNITIONS.length],
    } as Country);
  }
  return list;
}

function makeUserCountry(code: string, status: 'visited' | 'wishlist'): UserCountry {
  return {
    id: `uc-${code}-${status}`,
    country_code: code,
    status,
    created_at: '2024-01-01T00:00:00Z',
  } as unknown as UserCountry;
}

function mockHooks({
  countries,
  userCountries,
}: {
  countries: Country[];
  userCountries: UserCountry[];
}) {
  jest.spyOn(useCountriesModule, 'useCountries').mockReturnValue({
    data: countries,
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useCountriesModule.useCountries>);

  jest.spyOn(useUserCountriesModule, 'useUserCountries').mockReturnValue({
    data: userCountries,
    isLoading: false,
  } as ReturnType<typeof useUserCountriesModule.useUserCountries>);

  jest.spyOn(useTripsModule, 'useTrips').mockReturnValue({
    data: [],
    isLoading: false,
  } as unknown as ReturnType<typeof useTripsModule.useTrips>);

  jest.spyOn(useProfileModule, 'useProfile').mockReturnValue({
    data: { tracking_preference: 'full_atlas' },
    isLoading: false,
  } as unknown as ReturnType<typeof useProfileModule.useProfile>);

  jest.spyOn(useUserCountriesModule, 'useAddUserCountry').mockReturnValue({
    mutate: jest.fn(),
  } as unknown as ReturnType<typeof useUserCountriesModule.useAddUserCountry>);

  jest.spyOn(useUserCountriesModule, 'useRemoveUserCountry').mockReturnValue({
    mutate: jest.fn(),
  } as unknown as ReturnType<typeof useUserCountriesModule.useRemoveUserCountry>);
}

/**
 * Independent (naive) reference implementation of the stats computation, using
 * the SAME real constants/helpers the hook relies on. If the hook's optimized
 * Set/Map-based version drifts from this, the golden value breaks.
 */
function expectedStats(countries: Country[], userCountries: UserCountry[]) {
  const pref = 'full_atlas';
  const visited = userCountries.filter((uc) => uc.status === 'visited');
  const wishlist = userCountries.filter((uc) => uc.status === 'wishlist');

  const allowedVisited = visited.filter((uc) => {
    const c = countries.find((cc) => cc.code === uc.country_code);
    return c && isCountryAllowedByPreference(c.recognition, pref);
  });
  const allowedWishlist = wishlist.filter((uc) => {
    const c = countries.find((cc) => cc.code === uc.country_code);
    return c && isCountryAllowedByPreference(c.recognition, pref);
  });

  const stampedCount = allowedVisited.length;
  const dreamsCount = allowedWishlist.length;
  const totalCountries = getCountryCountForPreference(pref);
  const worldPercentage =
    totalCountries > 0 ? Math.round((stampedCount / totalCountries) * 100) : 0;

  const visitedCodes = new Set(allowedVisited.map((uc) => uc.country_code));
  const regions = new Set(countries.filter((c) => visitedCodes.has(c.code)).map((c) => c.region));

  return {
    stampedCount,
    dreamsCount,
    totalCountries,
    worldPercentage,
    regionsCount: regions.size,
    travelStatus: getTravelStatus(stampedCount).status,
  };
}

describe('usePassportData stats (golden value, 227 countries)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({ isMigrating: false });
  });

  it('produces stats identical to the reference implementation', () => {
    const countries = buildCountries();
    // Visit every 3rd country, wishlist every 7th (disjoint from visited).
    const userCountries: UserCountry[] = [];
    countries.forEach((c, i) => {
      if (i % 3 === 0) {
        userCountries.push(makeUserCountry(c.code, 'visited'));
      } else if (i % 7 === 0) {
        userCountries.push(makeUserCountry(c.code, 'wishlist'));
      }
    });

    mockHooks({ countries, userCountries });
    const { result } = renderHook(() => usePassportData());

    // Sanity: fixture is the full 227.
    expect(countries).toHaveLength(227);

    expect(result.current.stats).toEqual(expectedStats(countries, userCountries));
  });

  it('matches the reference for an empty visited/wishlist set', () => {
    const countries = buildCountries();
    const userCountries: UserCountry[] = [];

    mockHooks({ countries, userCountries });
    const { result } = renderHook(() => usePassportData());

    expect(result.current.stats).toEqual(expectedStats(countries, userCountries));
  });

  it('matches the reference when all countries are visited', () => {
    const countries = buildCountries();
    const userCountries = countries.map((c) => makeUserCountry(c.code, 'visited'));

    mockHooks({ countries, userCountries });
    const { result } = renderHook(() => usePassportData());

    expect(result.current.stats).toEqual(expectedStats(countries, userCountries));
  });
});
