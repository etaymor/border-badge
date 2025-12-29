/**
 * Tests for useShareCapture hook utility functions.
 *
 * Tests the findMatchingTrips helper and country code fallback logic.
 */

import { findMatchingTrips } from '@screens/share/useShareCapture';
import { createMockTrip } from '../../utils/mockFactories';

describe('useShareCapture', () => {
  describe('findMatchingTrips', () => {
    const albaniaTrip1 = createMockTrip({
      id: 'trip-al-1',
      country_code: 'AL',
      name: 'Albania Trip 1',
      created_at: '2024-01-01T00:00:00Z',
    });

    const albaniaTrip2 = createMockTrip({
      id: 'trip-al-2',
      country_code: 'AL',
      name: 'Albania Trip 2',
      created_at: '2024-06-15T00:00:00Z',
    });

    const albaniaTrip3 = createMockTrip({
      id: 'trip-al-3',
      country_code: 'AL',
      name: 'Albania Trip 3',
      created_at: '2024-03-10T00:00:00Z',
    });

    const japanTrip = createMockTrip({
      id: 'trip-jp-1',
      country_code: 'JP',
      name: 'Japan Trip',
      created_at: '2024-02-01T00:00:00Z',
    });

    const italyTrip = createMockTrip({
      id: 'trip-it-1',
      country_code: 'IT',
      name: 'Italy Trip',
      created_at: '2024-04-01T00:00:00Z',
    });

    describe('basic filtering', () => {
      it('returns empty array for null country code', () => {
        const trips = [albaniaTrip1, japanTrip];
        expect(findMatchingTrips(trips, null)).toEqual([]);
      });

      it('returns empty array for undefined country code', () => {
        const trips = [albaniaTrip1, japanTrip];
        expect(findMatchingTrips(trips, undefined)).toEqual([]);
      });

      it('returns empty array for empty string country code', () => {
        const trips = [albaniaTrip1, japanTrip];
        // Empty string is falsy, should return empty array
        expect(findMatchingTrips(trips, '')).toEqual([]);
      });

      it('returns empty array when no trips match', () => {
        const trips = [japanTrip, italyTrip];
        expect(findMatchingTrips(trips, 'AL')).toEqual([]);
      });

      it('returns empty array for empty trips list', () => {
        expect(findMatchingTrips([], 'AL')).toEqual([]);
      });
    });

    describe('matching and sorting', () => {
      it('returns single matching trip', () => {
        const trips = [japanTrip, albaniaTrip1, italyTrip];
        const result = findMatchingTrips(trips, 'JP');

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('trip-jp-1');
      });

      it('returns all matching trips for a country', () => {
        const trips = [albaniaTrip1, japanTrip, albaniaTrip2, italyTrip, albaniaTrip3];
        const result = findMatchingTrips(trips, 'AL');

        expect(result).toHaveLength(3);
        expect(result.every((t) => t.country_code === 'AL')).toBe(true);
      });

      it('sorts matching trips by created_at descending (most recent first)', () => {
        const trips = [albaniaTrip1, japanTrip, albaniaTrip2, italyTrip, albaniaTrip3];
        const result = findMatchingTrips(trips, 'AL');

        // albaniaTrip2 (June) > albaniaTrip3 (March) > albaniaTrip1 (January)
        expect(result[0].id).toBe('trip-al-2'); // June 15 - most recent
        expect(result[1].id).toBe('trip-al-3'); // March 10
        expect(result[2].id).toBe('trip-al-1'); // January 1 - oldest
      });

      it('handles trips with same created_at timestamp', () => {
        const sameTime = '2024-05-01T00:00:00Z';
        const tripA = createMockTrip({
          id: 'trip-a',
          country_code: 'AL',
          created_at: sameTime,
        });
        const tripB = createMockTrip({
          id: 'trip-b',
          country_code: 'AL',
          created_at: sameTime,
        });

        const result = findMatchingTrips([tripA, tripB], 'AL');
        expect(result).toHaveLength(2);
        // Both should be returned, order is stable based on sort
      });
    });

    describe('country code fallback scenario', () => {
      /**
       * This tests the country code fallback logic used in useShareCapture:
       * When a place has no country_code but detected_country is available,
       * the hook uses detected_country.country_code to find matching trips.
       */

      it('simulates place with country code - finds matching trips directly', () => {
        // Scenario: Backend returns detected_place with country_code: 'AL'
        const detectedPlaceCountryCode = 'AL';
        const detectedCountryCode = null; // No fallback needed

        // Use the same logic as the hook
        const countryCode = detectedPlaceCountryCode ?? detectedCountryCode;
        const trips = [albaniaTrip1, japanTrip, albaniaTrip2];
        const result = findMatchingTrips(trips, countryCode);

        expect(result).toHaveLength(2);
        expect(result[0].id).toBe('trip-al-2');
      });

      it('simulates place detection failure with country hint fallback', () => {
        // Scenario: Backend returns no detected_place, but detected_country with country_code: 'AL'
        const detectedPlaceCountryCode = null; // Place detection failed
        const detectedCountryCode = 'AL'; // Country hint available

        // Use the same logic as the hook
        const countryCode = detectedPlaceCountryCode ?? detectedCountryCode;
        const trips = [albaniaTrip1, japanTrip, albaniaTrip2];
        const result = findMatchingTrips(trips, countryCode);

        expect(result).toHaveLength(2);
        expect(result[0].id).toBe('trip-al-2');
      });

      it('simulates neither place nor country detected', () => {
        // Scenario: Backend returns neither detected_place nor detected_country
        const detectedPlaceCountryCode = null;
        const detectedCountryCode = null;

        // Use the same logic as the hook
        const countryCode = detectedPlaceCountryCode ?? detectedCountryCode;
        const trips = [albaniaTrip1, japanTrip, albaniaTrip2];
        const result = findMatchingTrips(trips, countryCode);

        expect(result).toHaveLength(0);
      });

      it('prioritizes place country_code over country hint', () => {
        // Scenario: Both available, place says Japan, country hint says Albania
        // Place country should win
        const detectedPlaceCountryCode = 'JP';
        const detectedCountryCode = 'AL';

        const countryCode = detectedPlaceCountryCode ?? detectedCountryCode;
        const trips = [albaniaTrip1, japanTrip, albaniaTrip2];
        const result = findMatchingTrips(trips, countryCode);

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('trip-jp-1');
      });
    });

    describe('edge cases', () => {
      it('handles country codes case-sensitively', () => {
        // Country codes should be uppercase, but test that lowercase doesn't match
        const trips = [albaniaTrip1];
        expect(findMatchingTrips(trips, 'al')).toEqual([]);
        expect(findMatchingTrips(trips, 'AL')).toHaveLength(1);
      });

      it('handles trips with missing country_code', () => {
        const tripWithNoCountry = createMockTrip({
          id: 'no-country',
          country_code: undefined as unknown as string,
        });
        const trips = [tripWithNoCountry, albaniaTrip1];

        const result = findMatchingTrips(trips, 'AL');
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('trip-al-1');
      });

      it('handles very old timestamps', () => {
        const oldTrip = createMockTrip({
          id: 'old-trip',
          country_code: 'AL',
          created_at: '1990-01-01T00:00:00Z',
        });
        const trips = [oldTrip, albaniaTrip1];

        const result = findMatchingTrips(trips, 'AL');
        expect(result[0].id).toBe('trip-al-1'); // 2024 should come before 1990
        expect(result[1].id).toBe('old-trip');
      });
    });
  });
});
