/**
 * Tests for ShareCaptureScreen utility functions.
 *
 * Tests provider detection, entry type inference, error handling,
 * and place conversion functions.
 */

import {
  detectProviderFromUrl,
  getProviderDisplayName,
  inferEntryTypeFromPlaceTypes,
  getErrorDetails,
  detectedPlaceToSelectedPlace,
  selectedPlaceToDetectedPlace,
  PROVIDER_COLORS,
} from '@screens/share/shareCaptureUtils';

describe('shareCaptureUtils', () => {
  describe('detectProviderFromUrl', () => {
    it('detects TikTok URLs', () => {
      expect(detectProviderFromUrl('https://www.tiktok.com/@user/video/123')).toBe('tiktok');
      expect(detectProviderFromUrl('https://tiktok.com/@user/video/123')).toBe('tiktok');
      expect(detectProviderFromUrl('https://vm.tiktok.com/ABC123/')).toBe('tiktok');
    });

    it('detects Instagram URLs', () => {
      expect(detectProviderFromUrl('https://www.instagram.com/p/ABC123/')).toBe('instagram');
      expect(detectProviderFromUrl('https://instagram.com/reel/ABC123/')).toBe('instagram');
    });

    it('returns null for unsupported URLs', () => {
      expect(detectProviderFromUrl('https://youtube.com/watch?v=abc')).toBeNull();
      expect(detectProviderFromUrl('https://google.com')).toBeNull();
    });

    it('handles case-insensitive URLs', () => {
      expect(detectProviderFromUrl('HTTPS://WWW.TIKTOK.COM/@user/video/123')).toBe('tiktok');
      expect(detectProviderFromUrl('HTTPS://INSTAGRAM.COM/p/ABC123/')).toBe('instagram');
    });
  });

  describe('getProviderDisplayName', () => {
    it('returns correct display names', () => {
      expect(getProviderDisplayName('tiktok')).toBe('TikTok');
      expect(getProviderDisplayName('instagram')).toBe('Instagram');
      expect(getProviderDisplayName(null)).toBe('the link');
    });
  });

  describe('PROVIDER_COLORS', () => {
    it('has colors for all providers', () => {
      expect(PROVIDER_COLORS.tiktok).toBe('#000000');
      expect(PROVIDER_COLORS.instagram).toBe('#E1306C');
    });
  });

  describe('inferEntryTypeFromPlaceTypes', () => {
    describe('food detection', () => {
      it('detects restaurants as food', () => {
        expect(inferEntryTypeFromPlaceTypes('restaurant', [])).toBe('food');
        expect(inferEntryTypeFromPlaceTypes(null, ['restaurant'])).toBe('food');
      });

      it('detects cafes and bakeries as food', () => {
        expect(inferEntryTypeFromPlaceTypes('cafe', [])).toBe('food');
        expect(inferEntryTypeFromPlaceTypes('bakery', [])).toBe('food');
        expect(inferEntryTypeFromPlaceTypes('coffee_shop', [])).toBe('food');
      });

      it('detects specific restaurant types as food', () => {
        expect(inferEntryTypeFromPlaceTypes('pizza_restaurant', [])).toBe('food');
        expect(inferEntryTypeFromPlaceTypes('sushi_restaurant', [])).toBe('food');
        expect(inferEntryTypeFromPlaceTypes('ramen_restaurant', [])).toBe('food');
      });
    });

    describe('stay detection', () => {
      it('detects hotels as stay', () => {
        expect(inferEntryTypeFromPlaceTypes('hotel', [])).toBe('stay');
        expect(inferEntryTypeFromPlaceTypes('lodging', [])).toBe('stay');
      });

      it('detects various accommodation types as stay', () => {
        expect(inferEntryTypeFromPlaceTypes('hostel', [])).toBe('stay');
        expect(inferEntryTypeFromPlaceTypes('bed_and_breakfast', [])).toBe('stay');
        expect(inferEntryTypeFromPlaceTypes('resort_hotel', [])).toBe('stay');
        expect(inferEntryTypeFromPlaceTypes('campground', [])).toBe('stay');
      });
    });

    describe('experience detection', () => {
      it('detects attractions as experience', () => {
        expect(inferEntryTypeFromPlaceTypes('tourist_attraction', [])).toBe('experience');
        expect(inferEntryTypeFromPlaceTypes('amusement_park', [])).toBe('experience');
      });

      it('detects cultural venues as experience', () => {
        expect(inferEntryTypeFromPlaceTypes('museum', [])).toBe('experience');
        expect(inferEntryTypeFromPlaceTypes('art_gallery', [])).toBe('experience');
        expect(inferEntryTypeFromPlaceTypes('zoo', [])).toBe('experience');
        expect(inferEntryTypeFromPlaceTypes('aquarium', [])).toBe('experience');
      });

      it('detects entertainment venues as experience', () => {
        expect(inferEntryTypeFromPlaceTypes('night_club', [])).toBe('experience');
        expect(inferEntryTypeFromPlaceTypes('spa', [])).toBe('experience');
        expect(inferEntryTypeFromPlaceTypes('ski_resort', [])).toBe('experience');
      });
    });

    describe('place detection (default)', () => {
      it('returns place for unknown types', () => {
        expect(inferEntryTypeFromPlaceTypes('park', [])).toBe('place');
        expect(inferEntryTypeFromPlaceTypes('street_address', [])).toBe('place');
        expect(inferEntryTypeFromPlaceTypes(null, [])).toBe('place');
      });

      it('returns place for general establishment', () => {
        expect(inferEntryTypeFromPlaceTypes('establishment', [])).toBe('place');
        expect(inferEntryTypeFromPlaceTypes('point_of_interest', [])).toBe('place');
      });
    });

    describe('priority handling', () => {
      it('uses primary_type over types array', () => {
        // Primary is restaurant, types has hotel
        expect(inferEntryTypeFromPlaceTypes('restaurant', ['hotel'])).toBe('food');
      });

      it('checks all types in array', () => {
        expect(inferEntryTypeFromPlaceTypes(null, ['establishment', 'cafe'])).toBe('food');
      });

      it('handles case-insensitive matching', () => {
        expect(inferEntryTypeFromPlaceTypes('RESTAURANT', [])).toBe('food');
        expect(inferEntryTypeFromPlaceTypes(null, ['HOTEL'])).toBe('stay');
      });
    });
  });

  describe('getErrorDetails', () => {
    describe('network errors', () => {
      it('handles network errors', () => {
        const result = getErrorDetails('Network request failed');
        expect(result.title).toBe('Connection Error');
        expect(result.canRetry).toBe(true);
        expect(result.isOffline).toBe(true);
        expect(result.showManualEntry).toBe(false);
      });

      it('handles timeout errors', () => {
        const result = getErrorDetails('Request timeout');
        expect(result.title).toBe('Connection Error');
        expect(result.isOffline).toBe(true);
      });
    });

    describe('rate limiting', () => {
      it('handles rate limit errors', () => {
        const result = getErrorDetails('Rate limit exceeded');
        expect(result.title).toBe('Too Many Requests');
        expect(result.canRetry).toBe(true);
        expect(result.isOffline).toBe(false);
      });

      it('handles 429 status codes', () => {
        const result = getErrorDetails('Error 429: too many requests');
        expect(result.title).toBe('Too Many Requests');
      });
    });

    describe('provider errors', () => {
      it('handles TikTok unavailable errors', () => {
        const result = getErrorDetails('TikTok service unavailable');
        expect(result.title).toBe('TikTok Unavailable');
        expect(result.showManualEntry).toBe(true);
        expect(result.canRetry).toBe(false);
      });

      it('handles Instagram unavailable errors', () => {
        const result = getErrorDetails('Instagram service unavailable');
        expect(result.title).toBe('Instagram Unavailable');
        expect(result.showManualEntry).toBe(true);
      });
    });

    describe('invalid URL errors', () => {
      it('handles invalid URL errors', () => {
        const result = getErrorDetails('Invalid URL format');
        expect(result.title).toBe('Invalid Link');
        expect(result.canRetry).toBe(false);
        expect(result.showManualEntry).toBe(false);
      });
    });

    describe('unsupported provider errors', () => {
      it('handles unsupported provider errors', () => {
        const result = getErrorDetails('Unsupported provider');
        expect(result.title).toBe('Unsupported Link');
        expect(result.showManualEntry).toBe(false);
      });
    });

    describe('generic errors', () => {
      it('handles unknown errors with manual entry option', () => {
        const result = getErrorDetails('Something went wrong');
        expect(result.title).toBe("Couldn't Process Link");
        expect(result.message).toBe('Something went wrong');
        expect(result.canRetry).toBe(true);
        expect(result.showManualEntry).toBe(true);
      });
    });
  });

  describe('detectedPlaceToSelectedPlace', () => {
    it('converts all fields correctly', () => {
      const detected = {
        google_place_id: 'ChIJ123',
        name: 'Test Place',
        address: '123 Main St',
        latitude: 41.3275,
        longitude: 19.8187,
        city: 'Tirana',
        country: 'Albania',
        country_code: 'AL',
        confidence: 0.85,
        primary_type: 'restaurant',
        types: ['restaurant', 'food'],
        google_photo_url: 'https://photo.url',
      };

      const result = detectedPlaceToSelectedPlace(detected);

      expect(result).toEqual({
        google_place_id: 'ChIJ123',
        name: 'Test Place',
        address: '123 Main St',
        latitude: 41.3275,
        longitude: 19.8187,
        google_photo_url: 'https://photo.url',
        website_url: null,
        country_code: 'AL',
      });
    });

    it('generates google_place_id when null', () => {
      const detected = {
        google_place_id: null,
        name: 'Test Place',
        address: null,
        latitude: null,
        longitude: null,
        city: null,
        country: null,
        country_code: null,
        confidence: 0.5,
        primary_type: null,
        types: [],
        google_photo_url: null,
      };

      const result = detectedPlaceToSelectedPlace(detected);
      expect(result.google_place_id).toMatch(/^detected_\d+$/);
    });

    it('handles null country_code', () => {
      const detected = {
        google_place_id: 'ChIJ123',
        name: 'Test Place',
        address: null,
        latitude: null,
        longitude: null,
        city: null,
        country: null,
        country_code: null,
        confidence: 0.5,
        primary_type: null,
        types: [],
        google_photo_url: null,
      };

      const result = detectedPlaceToSelectedPlace(detected);
      expect(result.country_code).toBeNull();
    });
  });

  describe('selectedPlaceToDetectedPlace', () => {
    it('converts all fields correctly', () => {
      const selected = {
        google_place_id: 'ChIJ123',
        name: 'Test Place',
        address: '123 Main St',
        latitude: 41.3275,
        longitude: 19.8187,
        google_photo_url: 'https://photo.url',
        website_url: 'https://test.com',
        country_code: 'AL',
      };

      const result = selectedPlaceToDetectedPlace(selected);

      expect(result).toEqual({
        google_place_id: 'ChIJ123',
        name: 'Test Place',
        address: '123 Main St',
        latitude: 41.3275,
        longitude: 19.8187,
        city: null,
        country: null,
        country_code: 'AL',
        confidence: 1.0, // User confirmed
        primary_type: null,
        types: [],
        google_photo_url: 'https://photo.url',
      });
    });

    it('sets confidence to 1.0 (user confirmed)', () => {
      const selected = {
        google_place_id: 'ChIJ123',
        name: 'Test',
        address: null,
        latitude: null,
        longitude: null,
        google_photo_url: null,
        website_url: null,
        country_code: null,
      };

      const result = selectedPlaceToDetectedPlace(selected);
      expect(result.confidence).toBe(1.0);
    });

    it('handles null country_code', () => {
      const selected = {
        google_place_id: 'ChIJ123',
        name: 'Test',
        address: null,
        latitude: null,
        longitude: null,
        google_photo_url: null,
        website_url: null,
        country_code: null,
      };

      const result = selectedPlaceToDetectedPlace(selected);
      expect(result.country_code).toBeNull();
    });
  });
});
