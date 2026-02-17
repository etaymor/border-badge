import { renderHook, act, waitFor } from '@testing-library/react-native';

import type { SelectedPlace } from '../../services/placesApi';
import { useNearbyPhotos } from '../../hooks/useNearbyPhotos';

// Mock the photoCacheDb module
const mockHasCachedPhotos = jest.fn();
const mockGetPhotosNearLocation = jest.fn();

jest.mock('../../services/photoImport/photoCacheDb', () => ({
  hasCachedPhotos: (...args: unknown[]) => mockHasCachedPhotos(...args),
  getPhotosNearLocation: (...args: unknown[]) => mockGetPhotosNearLocation(...args),
}));

describe('useNearbyPhotos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasCachedPhotos.mockResolvedValue(true);
    mockGetPhotosNearLocation.mockResolvedValue([]);
  });

  /**
   * Bug #3: hasCachedPhotos called without error handling.
   *
   * If the SQLite DB has not been initialized yet (first app launch, before
   * any photo scan), hasCachedPhotos may throw. Without a .catch(), this
   * results in an unhandled promise rejection.
   */
  it('should handle hasCachedPhotos rejection gracefully (bug #3)', async () => {
    mockHasCachedPhotos.mockRejectedValue(new Error('DB not initialized'));

    const { result } = renderHook(() => useNearbyPhotos(null));

    await waitFor(() => {
      // Should default to false instead of crashing with unhandled rejection
      expect(result.current.cacheExists).toBe(false);
    });
  });

  /**
   * Bug #4: Loading state flashes section label before photos are found.
   *
   * When a place with coordinates is selected, isLoading becomes true immediately,
   * causing the "PHOTOS FROM YOUR LIBRARY" label to render. If no nearby photos
   * are found, the component returns null, causing a visible flash of the label.
   *
   * The fix: don't set isLoading=true until we know the cache exists, so the
   * section label never flashes when there's nothing to show.
   */
  it('should not flash isLoading=true when no place is selected', () => {
    const { result } = renderHook(() => useNearbyPhotos(null));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.photos).toEqual([]);
  });

  it('should set isLoading while searching for nearby photos', async () => {
    let resolveSearch: (value: unknown[]) => void;
    mockGetPhotosNearLocation.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSearch = resolve;
        })
    );

    const place = { latitude: 35.6762, longitude: 139.6503 } as SelectedPlace;
    const { result } = renderHook(() => useNearbyPhotos(place));

    // isLoading should be true while search is in progress
    await waitFor(() => {
      expect(result.current.isLoading).toBe(true);
    });

    // Resolve the search
    await act(async () => {
      resolveSearch!([]);
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.photos).toEqual([]);
    });
  });
});
