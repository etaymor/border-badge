/**
 * Tests for milestone detection logic.
 *
 * Covers:
 * - Round number milestones (10, 25, 50, 100)
 * - New continent detection
 * - New subregion detection
 * - Region completion detection
 * - Edge cases (country not found, empty data, re-visit)
 * - buildMilestoneContext function
 */

import { detectMilestones, buildMilestoneContext } from '@utils/milestones';
import { createMockCountry, createMockUserCountry } from './mockFactories';
import { colors } from '@constants/colors';

import type { Country } from '@hooks/useCountries';
import type { UserCountry } from '@hooks/useUserCountries';

describe('detectMilestones', () => {
  // ============ Round Number Milestones ============

  describe('Round Number Milestones', () => {
    it('detects 10th country milestone', () => {
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      // 9 previously visited
      const visited: UserCountry[] = Array.from({ length: 9 }, (_, i) =>
        createMockUserCountry({ country_code: `C${i}`, status: 'visited' })
      );

      const milestones = detectMilestones('JP', countries, visited);

      expect(milestones).toContainEqual(
        expect.objectContaining({
          type: 'round_number',
          label: '10 Countries!',
          icon: 'trophy',
          color: colors.sunsetGold,
        })
      );
    });

    it('detects 25th country milestone', () => {
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      const visited: UserCountry[] = Array.from({ length: 24 }, (_, i) =>
        createMockUserCountry({ country_code: `C${i}`, status: 'visited' })
      );

      const milestones = detectMilestones('JP', countries, visited);

      expect(milestones).toContainEqual(
        expect.objectContaining({
          type: 'round_number',
          label: '25 Countries!',
        })
      );
    });

    it('detects 50th country milestone', () => {
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      const visited: UserCountry[] = Array.from({ length: 49 }, (_, i) =>
        createMockUserCountry({ country_code: `C${i}`, status: 'visited' })
      );

      const milestones = detectMilestones('JP', countries, visited);

      expect(milestones).toContainEqual(
        expect.objectContaining({
          type: 'round_number',
          label: '50 Countries!',
        })
      );
    });

    it('detects 100th country milestone', () => {
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      const visited: UserCountry[] = Array.from({ length: 99 }, (_, i) =>
        createMockUserCountry({ country_code: `C${i}`, status: 'visited' })
      );

      const milestones = detectMilestones('JP', countries, visited);

      expect(milestones).toContainEqual(
        expect.objectContaining({
          type: 'round_number',
          label: '100 Countries!',
        })
      );
    });

    it('does not detect milestone for non-round numbers', () => {
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      // 4 previously visited = 5th country (not a round number)
      const visited: UserCountry[] = Array.from({ length: 4 }, (_, i) =>
        createMockUserCountry({ country_code: `C${i}`, status: 'visited' })
      );

      const milestones = detectMilestones('JP', countries, visited);

      expect(milestones.find((m) => m.type === 'round_number')).toBeUndefined();
    });
  });

  // ============ New Continent Milestones ============

  describe('New Continent Milestones', () => {
    it('detects first country in new continent', () => {
      const countries = [
        createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' }),
        createMockCountry({ code: 'FR', name: 'France', region: 'Europe' }),
      ];
      // Previously only visited Europe
      const visited: UserCountry[] = [
        createMockUserCountry({ country_code: 'FR', status: 'visited' }),
      ];

      const milestones = detectMilestones('JP', countries, visited);

      expect(milestones).toContainEqual(
        expect.objectContaining({
          type: 'new_continent',
          label: 'First in Asia!',
          icon: 'globe',
          color: colors.mossGreen,
        })
      );
    });

    it('does not detect milestone when continent already visited', () => {
      const countries = [
        createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' }),
        createMockCountry({ code: 'CN', name: 'China', region: 'Asia' }),
      ];
      // Previously visited China (same continent)
      const visited: UserCountry[] = [
        createMockUserCountry({ country_code: 'CN', status: 'visited' }),
      ];

      const milestones = detectMilestones('JP', countries, visited);

      expect(milestones.find((m) => m.type === 'new_continent')).toBeUndefined();
    });

    it('detects new continent when first country ever visited', () => {
      const countries = [createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' })];
      const visited: UserCountry[] = [];

      const milestones = detectMilestones('JP', countries, visited);

      expect(milestones).toContainEqual(
        expect.objectContaining({
          type: 'new_continent',
          label: 'First in Asia!',
        })
      );
    });
  });

  // ============ New Subregion Milestones ============

  describe('New Subregion Milestones', () => {
    it('detects first country in new subregion', () => {
      const countries = [
        createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia', subregion: 'East Asia' }),
        createMockCountry({
          code: 'TH',
          name: 'Thailand',
          region: 'Asia',
          subregion: 'Southeast Asia',
        }),
      ];
      // Previously visited Southeast Asia
      const visited: UserCountry[] = [
        createMockUserCountry({ country_code: 'TH', status: 'visited' }),
      ];

      const milestones = detectMilestones('JP', countries, visited);

      expect(milestones).toContainEqual(
        expect.objectContaining({
          type: 'new_subregion',
          label: 'First in East Asia!',
          icon: 'flag',
          color: colors.lakeBlue,
        })
      );
    });

    it('does not detect milestone when subregion already visited', () => {
      const countries = [
        createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia', subregion: 'East Asia' }),
        createMockCountry({
          code: 'KR',
          name: 'South Korea',
          region: 'Asia',
          subregion: 'East Asia',
        }),
      ];
      // Previously visited South Korea (same subregion)
      const visited: UserCountry[] = [
        createMockUserCountry({ country_code: 'KR', status: 'visited' }),
      ];

      const milestones = detectMilestones('JP', countries, visited);

      expect(milestones.find((m) => m.type === 'new_subregion')).toBeUndefined();
    });

    it('handles country with no subregion', () => {
      const countries = [
        createMockCountry({
          code: 'AQ',
          name: 'Antarctica',
          region: 'Antarctica',
          subregion: null,
        }),
      ];
      const visited: UserCountry[] = [];

      const milestones = detectMilestones('AQ', countries, visited);

      // Should not have subregion milestone
      expect(milestones.find((m) => m.type === 'new_subregion')).toBeUndefined();
    });
  });

  // ============ Region Completion Milestones ============

  describe('Region Completion Milestones', () => {
    it('detects when all countries in subregion are visited', () => {
      // Small subregion with 2 countries
      const countries = [
        createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia', subregion: 'East Asia' }),
        createMockCountry({
          code: 'KR',
          name: 'South Korea',
          region: 'Asia',
          subregion: 'East Asia',
        }),
      ];
      // Previously visited all except Japan
      const visited: UserCountry[] = [
        createMockUserCountry({ country_code: 'KR', status: 'visited' }),
      ];

      const milestones = detectMilestones('JP', countries, visited);

      expect(milestones).toContainEqual(
        expect.objectContaining({
          type: 'region_complete',
          label: 'All of East Asia!',
          icon: 'checkmark-circle',
          color: colors.adobeBrick,
        })
      );
    });

    it('does not detect completion when subregion is not fully visited', () => {
      const countries = [
        createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia', subregion: 'East Asia' }),
        createMockCountry({
          code: 'KR',
          name: 'South Korea',
          region: 'Asia',
          subregion: 'East Asia',
        }),
        createMockCountry({ code: 'CN', name: 'China', region: 'Asia', subregion: 'East Asia' }),
      ];
      // Missing China
      const visited: UserCountry[] = [
        createMockUserCountry({ country_code: 'KR', status: 'visited' }),
      ];

      const milestones = detectMilestones('JP', countries, visited);

      expect(milestones.find((m) => m.type === 'region_complete')).toBeUndefined();
    });

    it('does not detect completion for country with no subregion', () => {
      const countries = [
        createMockCountry({
          code: 'AQ',
          name: 'Antarctica',
          region: 'Antarctica',
          subregion: null,
        }),
      ];
      const visited: UserCountry[] = [];

      const milestones = detectMilestones('AQ', countries, visited);

      expect(milestones.find((m) => m.type === 'region_complete')).toBeUndefined();
    });
  });

  // ============ Edge Cases ============

  describe('Edge Cases', () => {
    it('returns empty array when country not found', () => {
      const countries: Country[] = [];
      const visited: UserCountry[] = [];

      const milestones = detectMilestones('XX', countries, visited);

      expect(milestones).toEqual([]);
    });

    it('excludes wishlist countries from visited count', () => {
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      // 8 visited + 1 wishlist = should still be 9th country (not 10th)
      const userCountries: UserCountry[] = [
        ...Array.from({ length: 8 }, (_, i) =>
          createMockUserCountry({ country_code: `C${i}`, status: 'visited' })
        ),
        createMockUserCountry({ country_code: 'WL', status: 'wishlist' }),
      ];

      const milestones = detectMilestones('JP', countries, userCountries);

      // 9th country - no round number milestone
      expect(milestones.find((m) => m.type === 'round_number')).toBeUndefined();
    });

    it('handles re-visiting same country (no duplicate count)', () => {
      const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
      // JP is already in visited list
      const visited: UserCountry[] = Array.from({ length: 9 }, (_, i) =>
        createMockUserCountry({ country_code: i === 0 ? 'JP' : `C${i}`, status: 'visited' })
      );

      const milestones = detectMilestones('JP', countries, visited);

      // Should be 9th country (JP excluded from previous), not 10th
      expect(milestones.find((m) => m.type === 'round_number')).toBeUndefined();
    });

    it('can detect multiple milestones at once', () => {
      const countries = [
        createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia', subregion: 'East Asia' }),
        // Add another East Asia country so region_complete doesn't trigger
        createMockCountry({
          code: 'KR',
          name: 'South Korea',
          region: 'Asia',
          subregion: 'East Asia',
        }),
        ...Array.from({ length: 9 }, (_, i) =>
          createMockCountry({
            code: `C${i}`,
            name: `Country${i}`,
            region: 'Europe',
            subregion: 'Western Europe',
          })
        ),
      ];
      // 9 previously visited, all in Europe
      const visited: UserCountry[] = Array.from({ length: 9 }, (_, i) =>
        createMockUserCountry({ country_code: `C${i}`, status: 'visited' })
      );

      const milestones = detectMilestones('JP', countries, visited);

      // Should get: round_number (10), new_continent (Asia), new_subregion (East Asia)
      // NOT region_complete because South Korea is also in East Asia and not visited
      expect(milestones).toHaveLength(3);
      expect(milestones.map((m) => m.type)).toContain('round_number');
      expect(milestones.map((m) => m.type)).toContain('new_continent');
      expect(milestones.map((m) => m.type)).toContain('new_subregion');
      expect(milestones.map((m) => m.type)).not.toContain('region_complete');
    });
  });
});

describe('buildMilestoneContext', () => {
  it('returns null when country not found', () => {
    const result = buildMilestoneContext('XX', [], []);

    expect(result).toBeNull();
  });

  it('builds complete context with country info', () => {
    const countries = [
      createMockCountry({
        code: 'JP',
        name: 'Japan',
        region: 'Asia',
        subregion: 'East Asia',
      }),
    ];
    const visited: UserCountry[] = [];

    const result = buildMilestoneContext('JP', countries, visited);

    expect(result).toEqual({
      countryCode: 'JP',
      countryName: 'Japan',
      countryRegion: 'Asia',
      countrySubregion: 'East Asia',
      newTotalCount: 1,
      milestones: expect.any(Array),
    });
  });

  it('calculates correct newTotalCount', () => {
    const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
    const visited: UserCountry[] = Array.from({ length: 5 }, (_, i) =>
      createMockUserCountry({ country_code: `C${i}`, status: 'visited' })
    );

    const result = buildMilestoneContext('JP', countries, visited);

    expect(result?.newTotalCount).toBe(6);
  });

  it('excludes current country from previous count (re-visit scenario)', () => {
    const countries = [createMockCountry({ code: 'JP', name: 'Japan' })];
    // JP is already visited - shouldn't double count
    const visited: UserCountry[] = [
      createMockUserCountry({ country_code: 'JP', status: 'visited' }),
      createMockUserCountry({ country_code: 'FR', status: 'visited' }),
    ];

    const result = buildMilestoneContext('JP', countries, visited);

    // Should be 2nd country (FR + JP), not 3rd
    expect(result?.newTotalCount).toBe(2);
  });

  it('includes detected milestones', () => {
    const countries = [
      createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia', subregion: 'East Asia' }),
    ];
    const visited: UserCountry[] = [];

    const result = buildMilestoneContext('JP', countries, visited);

    expect(result?.milestones).toContainEqual(
      expect.objectContaining({
        type: 'new_continent',
        label: 'First in Asia!',
      })
    );
  });

  it('handles country with null subregion', () => {
    const countries = [
      createMockCountry({
        code: 'AQ',
        name: 'Antarctica',
        region: 'Antarctica',
        subregion: null,
      }),
    ];
    const visited: UserCountry[] = [];

    const result = buildMilestoneContext('AQ', countries, visited);

    expect(result?.countrySubregion).toBeNull();
  });
});
