/**
 * Factory functions for creating mock test data.
 */

import type { Trip, TripWithTags, TripTag, CreateTripInput } from '@hooks/useTrips';
import type {
  Entry,
  EntryWithPlace,
  Place,
  PlaceInput,
  EntryType,
  CreateEntryInput,
} from '@hooks/useEntries';
import type { MediaFile, MediaStatus, LocalFile } from '@hooks/useMedia';
import type { ListDetail, ListSummary, ListEntry, CreateListInput } from '@hooks/useLists';

// ============ Trip Factories ============

export function createMockTrip(overrides?: Partial<Trip>): Trip {
  return {
    id: `trip-${Date.now()}`,
    user_id: 'user-123',
    country_id: 'JPN',
    name: 'Tokyo Adventure',
    cover_image_url: undefined,
    date_range: '[2024-01-01,2024-01-15]',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createMockTripTag(overrides?: Partial<TripTag>): TripTag {
  return {
    id: `tag-${Date.now()}`,
    trip_id: 'trip-123',
    tagged_user_id: 'user-456',
    status: 'pending',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createMockTripWithTags(overrides?: Partial<TripWithTags>): TripWithTags {
  return {
    ...createMockTrip(),
    tags: [],
    ...overrides,
  };
}

export function createMockCreateTripInput(overrides?: Partial<CreateTripInput>): CreateTripInput {
  return {
    name: 'Test Trip',
    country_id: 'JPN',
    ...overrides,
  };
}

// ============ Place Factories ============

export function createMockPlace(overrides?: Partial<Place>): Place {
  return {
    id: `place-${Date.now()}`,
    entry_id: 'entry-123',
    google_place_id: 'ChIJ123abc',
    name: 'Test Place',
    latitude: 35.6762,
    longitude: 139.6503,
    address: '123 Test Street, Tokyo',
    ...overrides,
  };
}

export function createMockPlaceInput(overrides?: Partial<PlaceInput>): PlaceInput {
  return {
    google_place_id: 'ChIJ123abc',
    name: 'Test Place',
    address: '123 Test Street, Tokyo',
    latitude: 35.6762,
    longitude: 139.6503,
    ...overrides,
  };
}

// ============ Entry Factories ============

export function createMockEntry(overrides?: Partial<Entry>): Entry {
  return {
    id: `entry-${Date.now()}`,
    trip_id: 'trip-123',
    entry_type: 'place',
    title: 'Test Entry',
    notes: 'Test notes',
    entry_date: '2024-01-10',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createMockEntryWithPlace(overrides?: Partial<EntryWithPlace>): EntryWithPlace {
  return {
    ...createMockEntry(),
    place: createMockPlace(),
    media_files: [],
    ...overrides,
  };
}

export function createMockCreateEntryInput(
  overrides?: Partial<CreateEntryInput>
): CreateEntryInput {
  return {
    trip_id: 'trip-123',
    entry_type: 'place',
    title: 'Test Entry',
    ...overrides,
  };
}

// Create entry for each type
export function createMockEntryOfType(
  type: EntryType,
  overrides?: Partial<EntryWithPlace>
): EntryWithPlace {
  const needsPlace = type !== 'experience';
  return createMockEntryWithPlace({
    entry_type: type,
    place: needsPlace ? createMockPlace() : null,
    ...overrides,
  });
}

// ============ Media Factories ============

export function createMockMediaFile(overrides?: Partial<MediaFile>): MediaFile {
  return {
    id: `media-${Date.now()}`,
    owner_id: 'user-123',
    entry_id: 'entry-123',
    trip_id: 'trip-123',
    file_path: 'media/test.jpg',
    thumbnail_path: 'media/test-thumb.jpg',
    status: 'uploaded' as MediaStatus,
    created_at: new Date().toISOString(),
    url: 'https://storage.example.com/media/test.jpg',
    thumbnail_url: 'https://storage.example.com/media/test-thumb.jpg',
    ...overrides,
  };
}

export function createMockLocalFile(overrides?: Partial<LocalFile>): LocalFile {
  return {
    uri: 'file:///test/image.jpg',
    name: 'image.jpg',
    type: 'image/jpeg',
    size: 1024 * 1024, // 1MB
    ...overrides,
  };
}

// ============ List Factories ============

export function createMockListEntry(overrides?: Partial<ListEntry>): ListEntry {
  return {
    id: `list-entry-${Date.now()}`,
    entry_id: 'entry-123',
    position: 0,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createMockListSummary(overrides?: Partial<ListSummary>): ListSummary {
  return {
    id: `list-${Date.now()}`,
    trip_id: 'trip-123',
    owner_id: 'user-123',
    name: 'Best Spots',
    slug: 'best-spots-abc123',
    description: 'My favorite places',
    is_public: true,
    entry_count: 5,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createMockListDetail(overrides?: Partial<ListDetail>): ListDetail {
  return {
    id: `list-${Date.now()}`,
    trip_id: 'trip-123',
    owner_id: 'user-123',
    name: 'Best Spots',
    slug: 'best-spots-abc123',
    description: 'My favorite places',
    is_public: true,
    entries: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createMockCreateListInput(overrides?: Partial<CreateListInput>): CreateListInput {
  return {
    name: 'Test List',
    ...overrides,
  };
}

// ============ Navigation Mocks ============

export function createMockNavigation() {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    setOptions: jest.fn(),
    canGoBack: jest.fn().mockReturnValue(true),
    reset: jest.fn(),
    dispatch: jest.fn(),
    isFocused: jest.fn().mockReturnValue(true),
    addListener: jest.fn().mockReturnValue(jest.fn()),
    removeListener: jest.fn(),
    getParent: jest.fn(),
    getState: jest.fn(),
    getId: jest.fn(),
    setParams: jest.fn(),
    push: jest.fn(),
    pop: jest.fn(),
    popToTop: jest.fn(),
    replace: jest.fn(),
  };
}

export function createMockRoute<T extends Record<string, unknown>>(params?: T) {
  return {
    key: `test-route-${Date.now()}`,
    name: 'TestScreen',
    params: params ?? {},
  };
}

// ============ API Response Helpers ============

export function createMockApiResponse<T>(data: T) {
  return { data };
}

export function createMockApiError(message: string, status = 400) {
  const error = new Error(message) as Error & { response?: { status: number; data: { message: string } } };
  error.response = { status, data: { message } };
  return error;
}

// ============ Google Places API Mocks ============

export interface MockPrediction {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}

export function createMockPrediction(overrides?: Partial<MockPrediction>): MockPrediction {
  return {
    place_id: 'ChIJ123abc',
    description: 'Test Restaurant, Tokyo, Japan',
    structured_formatting: {
      main_text: 'Test Restaurant',
      secondary_text: 'Tokyo, Japan',
    },
    ...overrides,
  };
}

export function createMockPlaceDetails() {
  return {
    place_id: 'ChIJ123abc',
    name: 'Test Restaurant',
    formatted_address: 'Tokyo, Japan',
    geometry: {
      location: {
        lat: 35.6762,
        lng: 139.6503,
      },
    },
  };
}

export function createMockPlacesApiResponse(predictions: MockPrediction[]) {
  return {
    status: 'OK',
    predictions,
  };
}

export function createMockPlaceDetailsResponse() {
  return {
    status: 'OK',
    result: createMockPlaceDetails(),
  };
}
