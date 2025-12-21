/**
 * Google Places API service functions.
 * Handles autocomplete search and place details fetching.
 */

import Constants from 'expo-constants';
import { logger } from '@utils/logger';

const GOOGLE_PLACES_API_KEY = Constants.expoConfig?.extra?.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? '';

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 4000;

// ============ Custom Error Classes ============

/** Base error for all Places API errors */
export class PlacesApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlacesApiError';
  }
}

/** Thrown when API quota is exceeded (403/429 responses) */
export class QuotaExceededError extends PlacesApiError {
  constructor() {
    super('Google Places API quota exceeded');
    this.name = 'QuotaExceededError';
  }
}

/** Thrown when network request fails after retries */
export class NetworkError extends PlacesApiError {
  constructor(message = 'Network request failed') {
    super(message);
    this.name = 'NetworkError';
  }
}

// Helper to delay execution
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calculate exponential backoff delay with jitter.
 * Uses full jitter strategy to spread out retry attempts and prevent thundering herd.
 * @param retryCount - Current retry attempt (0-indexed)
 * @returns Delay in milliseconds with random jitter applied
 */
function getBackoffDelay(retryCount: number): number {
  // Exponential backoff: BASE_DELAY * 2^retryCount
  const exponentialDelay = BASE_DELAY_MS * Math.pow(2, retryCount);
  // Cap at maximum delay
  const cappedDelay = Math.min(exponentialDelay, MAX_DELAY_MS);
  // Full jitter: random value between 0 and cappedDelay
  return Math.random() * cappedDelay;
}

// Types for place data
export interface PlacePhoto {
  name: string; // Photo resource name (e.g., "places/PLACE_ID/photos/PHOTO_REF")
  widthPx: number;
  heightPx: number;
}

export interface PlaceResult {
  place_id: string;
  name: string;
  formatted_address: string;
  geometry?: {
    location: {
      lat: number;
      lng: number;
    };
  };
  photos?: PlacePhoto[];
  website_uri?: string;
  country_code?: string;
}

export interface SelectedPlace {
  google_place_id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  google_photo_url: string | null;
  website_url: string | null;
  country_code?: string | null;
}

export interface Prediction {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}

/**
 * Check if Google Places API key is configured
 */
export function hasApiKey(): boolean {
  return !!GOOGLE_PLACES_API_KEY;
}

/**
 * Extract the legacy photo_reference value from a Places API photo resource name.
 * The new Places API (v1) returns resource names like:
 *   places/PLACE_ID/photos/AWU5eF...
 * We need the final segment (after `/photos/`) to use the legacy photo endpoint,
 * which works without custom headers and can be rendered directly inside <Image>.
 */
function extractPhotoReference(photoName: string): string | null {
  if (!photoName) {
    return null;
  }

  const match = photoName.match(/\/photos\/([^/]+)$/);
  if (match?.[1]) {
    return match[1];
  }

  const segments = photoName.split('/');
  return segments.pop() || null;
}

/**
 * Construct a Google Places photo URL that can be consumed by React Native <Image>.
 * We fall back to the legacy photo endpoint because it allows API keys via query params.
 */
export function getPhotoUrl(photoName: string, maxWidthPx = 400): string | null {
  if (!GOOGLE_PLACES_API_KEY) {
    logger.warn('Cannot build Google photo URL without API key');
    return null;
  }

  const photoReference = extractPhotoReference(photoName);
  if (!photoReference) {
    logger.warn('Failed to parse Google photo reference from resource name');
    return null;
  }

  const clampedWidth = Math.min(Math.max(Math.floor(maxWidthPx), 1), 1600);
  const encodedReference = encodeURIComponent(photoReference);
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${clampedWidth}&photo_reference=${encodedReference}&key=${GOOGLE_PLACES_API_KEY}`;
}

/**
 * Search for places matching the query
 */
export async function searchPlaces(
  query: string,
  countryCode?: string,
  signal?: AbortSignal,
  retryCount = 0
): Promise<Prediction[]> {
  if (!GOOGLE_PLACES_API_KEY || !query.trim()) {
    return [];
  }

  const url = 'https://places.googleapis.com/v1/places:autocomplete';
  const body: Record<string, unknown> = {
    input: query,
    includedPrimaryTypes: ['establishment'],
  };

  if (countryCode) {
    body.includedRegionCodes = [countryCode.toLowerCase()];
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        throw new QuotaExceededError();
      }
      if (retryCount < MAX_RETRIES && !signal?.aborted) {
        await delay(getBackoffDelay(retryCount));
        // Check if aborted during delay
        if (signal?.aborted) {
          return [];
        }
        return searchPlaces(query, countryCode, signal, retryCount + 1);
      }
      logger.warn(`Places API returned status ${response.status} after ${MAX_RETRIES} retries`);
      throw new NetworkError(`Places API returned status ${response.status}`);
    }

    const data = await response.json();

    const suggestions = data.suggestions ?? [];
    return suggestions
      .filter((s: { placePrediction?: unknown }) => s.placePrediction)
      .map(
        (s: {
          placePrediction: {
            placeId: string;
            text?: { text: string };
            structuredFormat?: {
              mainText?: { text: string };
              secondaryText?: { text: string };
            };
          };
        }) => ({
          place_id: s.placePrediction.placeId,
          description: s.placePrediction.text?.text ?? '',
          structured_formatting: {
            main_text: s.placePrediction.structuredFormat?.mainText?.text ?? '',
            secondary_text: s.placePrediction.structuredFormat?.secondaryText?.text ?? '',
          },
        })
      );
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return [];
    }

    // Re-throw our custom errors directly
    if (error instanceof PlacesApiError) {
      throw error;
    }

    if (retryCount < MAX_RETRIES && !signal?.aborted) {
      logger.warn(`Places fetch failed, retrying (${retryCount + 1}/${MAX_RETRIES})...`);
      await delay(getBackoffDelay(retryCount));
      // Check if aborted during delay
      if (signal?.aborted) {
        return [];
      }
      return searchPlaces(query, countryCode, signal, retryCount + 1);
    }

    logger.error('Places autocomplete error after retries:', error);
    throw new NetworkError();
  }
}

/**
 * Get detailed information about a specific place
 */
export async function getPlaceDetails(placeId: string): Promise<PlaceResult | null> {
  if (!GOOGLE_PLACES_API_KEY) {
    return null;
  }

  const url = `https://places.googleapis.com/v1/places/${placeId}`;

  try {
    const response = await fetch(url, {
      headers: {
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask':
          'id,displayName,formattedAddress,location,photos,websiteUri,addressComponents',
      },
    });

    if (!response.ok) {
      logger.error('Place details API error:', response.status);
      return null;
    }

    const data = await response.json();

    // Transform photos array if present
    const photos: PlacePhoto[] | undefined = data.photos?.map(
      (photo: { name: string; widthPx?: number; heightPx?: number }) => ({
        name: photo.name,
        widthPx: photo.widthPx ?? 0,
        heightPx: photo.heightPx ?? 0,
      })
    );

    // Extract country code from address components
    const countryComponent = data.addressComponents?.find(
      (c: { types: string[] }) =>
        c.types?.includes('country') || c.types?.includes('COUNTRY')
    );
    const countryCode = countryComponent?.shortText ?? undefined;

    return {
      place_id: data.id,
      name: data.displayName?.text ?? '',
      formatted_address: data.formattedAddress ?? '',
      geometry: data.location
        ? {
            location: {
              lat: data.location.latitude,
              lng: data.location.longitude,
            },
          }
        : undefined,
      photos,
      website_uri: data.websiteUri ?? undefined,
      country_code: countryCode,
    };
  } catch (error) {
    logger.error('Place details error:', error);
    return null;
  }
}
