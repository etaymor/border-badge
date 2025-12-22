/**
 * Utility functions for ShareCaptureScreen.
 *
 * Extracted from ShareCaptureScreen.tsx to reduce file size and improve
 * testability and reusability.
 */

import type { EntryType } from '@navigation/types';
import type { DetectedPlace, SocialProvider } from '@hooks/useSocialIngest';
import type { SelectedPlace } from '@components/places';

// Provider badge colors
export const PROVIDER_COLORS: Record<SocialProvider, string> = {
  tiktok: '#000000',
  instagram: '#E1306C',
};

/**
 * Detect social media provider from URL.
 * Used for loading state before ingest completes.
 */
export function detectProviderFromUrl(url: string): SocialProvider | null {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('tiktok.com') || lowerUrl.includes('vm.tiktok')) {
    return 'tiktok';
  }
  if (lowerUrl.includes('instagram.com')) {
    return 'instagram';
  }
  return null;
}

/**
 * Get display name for a social provider.
 */
export function getProviderDisplayName(provider: SocialProvider | null): string {
  if (provider === 'tiktok') return 'TikTok';
  if (provider === 'instagram') return 'Instagram';
  return 'the link';
}

// Google Places types for entry type inference
// See: https://developers.google.com/maps/documentation/places/web-service/place-types

const FOOD_TYPES = [
  'restaurant',
  'cafe',
  'bakery',
  'bar',
  'coffee_shop',
  'fast_food_restaurant',
  'ice_cream_shop',
  'meal_takeaway',
  'meal_delivery',
  'food',
  'pizza_restaurant',
  'steak_house',
  'sushi_restaurant',
  'seafood_restaurant',
  'brunch_restaurant',
  'breakfast_restaurant',
  'sandwich_shop',
  'hamburger_restaurant',
  'ramen_restaurant',
];

const STAY_TYPES = [
  'hotel',
  'lodging',
  'motel',
  'hostel',
  'resort_hotel',
  'bed_and_breakfast',
  'guest_house',
  'campground',
  'rv_park',
  'extended_stay_hotel',
];

const EXPERIENCE_TYPES = [
  'tourist_attraction',
  'amusement_park',
  'aquarium',
  'art_gallery',
  'museum',
  'zoo',
  'night_club',
  'bowling_alley',
  'casino',
  'movie_theater',
  'spa',
  'gym',
  'stadium',
  'concert_hall',
  'performing_arts_theater',
  'hiking_area',
  'ski_resort',
  'golf_course',
  'marina',
  'adventure_sports_center',
];

/**
 * Infer entry type from Google Places types.
 * Maps place types to our entry categories (food, stay, experience, place).
 */
export function inferEntryTypeFromPlaceTypes(
  primaryType: string | null,
  types: string[]
): EntryType {
  const allTypes = primaryType ? [primaryType, ...(types || [])] : types || [];
  const typesLower = allTypes.map((t) => t.toLowerCase());

  // Check food types
  if (typesLower.some((t) => FOOD_TYPES.some((ft) => t.includes(ft)))) {
    return 'food';
  }

  // Check stay types
  if (typesLower.some((t) => STAY_TYPES.some((st) => t.includes(st)))) {
    return 'stay';
  }

  // Check experience types
  if (typesLower.some((t) => EXPERIENCE_TYPES.some((et) => t.includes(et)))) {
    return 'experience';
  }

  // Default to 'place' for general locations (landmarks, parks, etc.)
  return 'place';
}

/**
 * Error details for user-friendly error messages.
 */
export interface ErrorDetails {
  title: string;
  message: string;
  canRetry: boolean;
  isOffline: boolean;
  showManualEntry: boolean;
}

/**
 * Parse error message and return user-friendly details with action options.
 */
export function getErrorDetails(error: string): ErrorDetails {
  const lowerError = error.toLowerCase();

  // Network/connection errors
  if (
    lowerError.includes('network') ||
    lowerError.includes('timeout') ||
    lowerError.includes('fetch') ||
    lowerError.includes('econnrefused') ||
    lowerError.includes('no internet')
  ) {
    return {
      title: 'Connection Error',
      message: 'Check your internet connection and try again, or save for later.',
      canRetry: true,
      isOffline: true,
      showManualEntry: false,
    };
  }

  // Rate limiting
  if (
    lowerError.includes('rate limit') ||
    lowerError.includes('429') ||
    lowerError.includes('too many')
  ) {
    return {
      title: 'Too Many Requests',
      message: 'Please wait a moment before trying again.',
      canRetry: true,
      isOffline: false,
      showManualEntry: false,
    };
  }

  // Provider-specific errors - allow manual entry
  if (lowerError.includes('tiktok') && lowerError.includes('unavailable')) {
    return {
      title: 'TikTok Unavailable',
      message: "We couldn't fetch details from TikTok. You can still add the place manually.",
      canRetry: false,
      isOffline: false,
      showManualEntry: true,
    };
  }

  if (lowerError.includes('instagram') && lowerError.includes('unavailable')) {
    return {
      title: 'Instagram Unavailable',
      message: "We couldn't fetch details from Instagram. You can still add the place manually.",
      canRetry: false,
      isOffline: false,
      showManualEntry: true,
    };
  }

  // Invalid URL
  if (lowerError.includes('invalid') && lowerError.includes('url')) {
    return {
      title: 'Invalid Link',
      message: 'This link format is not supported. Please share a TikTok or Instagram video URL.',
      canRetry: false,
      isOffline: false,
      showManualEntry: false,
    };
  }

  // Unsupported provider
  if (lowerError.includes('unsupported') || lowerError.includes('provider')) {
    return {
      title: 'Unsupported Link',
      message: 'Currently we only support TikTok and Instagram links.',
      canRetry: false,
      isOffline: false,
      showManualEntry: false,
    };
  }

  // Generic fallback - allow manual entry as a fallback option
  return {
    title: "Couldn't Process Link",
    message: error,
    canRetry: true,
    isOffline: false,
    showManualEntry: true,
  };
}

/**
 * Convert backend DetectedPlace to mobile SelectedPlace format.
 */
export function detectedPlaceToSelectedPlace(place: DetectedPlace): SelectedPlace {
  return {
    google_place_id: place.google_place_id ?? `detected_${Date.now()}`,
    name: place.name,
    address: place.address,
    latitude: place.latitude,
    longitude: place.longitude,
    google_photo_url: place.google_photo_url ?? null,
    website_url: null,
    country_code: place.country_code ?? null,
  };
}

/**
 * Convert mobile SelectedPlace back to DetectedPlace for API.
 */
export function selectedPlaceToDetectedPlace(place: SelectedPlace): DetectedPlace {
  return {
    google_place_id: place.google_place_id,
    name: place.name,
    address: place.address,
    latitude: place.latitude,
    longitude: place.longitude,
    city: null,
    country: null,
    country_code: place.country_code ?? null,
    confidence: 1.0, // User confirmed
    primary_type: null,
    types: [],
    google_photo_url: place.google_photo_url ?? null,
  };
}
