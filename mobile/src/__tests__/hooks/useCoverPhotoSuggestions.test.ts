/**
 * Tests for useCoverPhotoSuggestions.
 *
 * Covers the four behaviors that make the strip safe to open a form with:
 *  - the ranking pool is capped (and evenly sampled) at COVER_RANK_POOL_MAX
 *  - a trip with both dates ranks only photos inside the window
 *  - a library with no tag rows in EITHER table bails instead of ranking blind
 *  - a stale request (country changed mid-flight) never overwrites the current
 */

import { renderHook, waitFor } from '@testing-library/react-native';

import {
  COVER_RANK_POOL_MAX,
  COVER_SUGGESTION_LIMIT,
  useCoverPhotoSuggestions,
} from '../../hooks/useCoverPhotoSuggestions';
import type { CachedPhoto } from '../../services/photoImport/types';

const mockHasCachedPhotos = jest.fn();
const mockGetCachedPhotosByCountry = jest.fn();
const mockGetTagsForIds = jest.fn();
const mockGetIntentTagsForIds = jest.fn();
const mockRankBestPhotos = jest.fn();

jest.mock('../../services/photoImport/photoCacheDb', () => ({
  hasCachedPhotos: (...args: unknown[]) => mockHasCachedPhotos(...args),
  getCachedPhotosByCountry: (...args: unknown[]) => mockGetCachedPhotosByCountry(...args),
}));

jest.mock('../../services/photoImport/photoTagDb', () => ({
  getTagsForIds: (...args: unknown[]) => mockGetTagsForIds(...args),
  getIntentTagsForIds: (...args: unknown[]) => mockGetIntentTagsForIds(...args),
}));

jest.mock('../../services/photoSignals/bestPhotos', () => ({
  rankBestPhotos: (...args: unknown[]) => mockRankBestPhotos(...args),
}));

const DAY_MS = 24 * 60 * 60 * 1000;

function photo(index: number, creationTime: number): CachedPhoto {
  return {
    id: `photo-${index}`,
    uri: `ph://photo-${index}`,
    filename: `IMG_${index}.HEIC`,
    creationTime,
    latitude: 35.01,
    longitude: 135.76,
    geohash: 'xn0m7ky',
    countryCode: 'JP',
  };
}

function makePhotos(count: number, startTime = 1_700_000_000_000): CachedPhoto[] {
  return Array.from({ length: count }, (_, i) => photo(i, startTime + i * 1000));
}

/** A non-empty tag map is enough to clear the no-tags bail. */
function tagMap(ids: string[]): Map<string, unknown> {
  return new Map(ids.map((id) => [id, { id }]));
}

describe('useCoverPhotoSuggestions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasCachedPhotos.mockResolvedValue(true);
    mockGetCachedPhotosByCountry.mockResolvedValue([]);
    mockGetTagsForIds.mockImplementation(async (ids: string[]) => tagMap(ids));
    mockGetIntentTagsForIds.mockImplementation(async (ids: string[]) => tagMap(ids));
    mockRankBestPhotos.mockImplementation((photos: CachedPhoto[]) =>
      photos.slice(0, COVER_SUGGESTION_LIMIT)
    );
  });

  it('returns nothing and never touches the photo database without a country', async () => {
    const { result } = renderHook(() => useCoverPhotoSuggestions(null));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.photos).toEqual([]);
    expect(result.current.cacheExists).toBe(false);
    expect(mockGetCachedPhotosByCountry).not.toHaveBeenCalled();
    expect(mockHasCachedPhotos).not.toHaveBeenCalled();
  });

  it('reports cacheExists=false when the cache probe rejects', async () => {
    mockHasCachedPhotos.mockRejectedValue(new Error('DB not initialized'));

    const { result } = renderHook(() => useCoverPhotoSuggestions('JP'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.cacheExists).toBe(false);
  });

  it('caps the ranking pool at COVER_RANK_POOL_MAX and samples it evenly', async () => {
    const all = makePhotos(1200);
    mockGetCachedPhotosByCountry.mockResolvedValue(all);

    const { result } = renderHook(() => useCoverPhotoSuggestions('JP'));

    await waitFor(() => expect(mockRankBestPhotos).toHaveBeenCalled());

    const pool = mockRankBestPhotos.mock.calls[0][0] as CachedPhoto[];
    expect(pool).toHaveLength(COVER_RANK_POOL_MAX);
    // Evenly spaced, not a prefix: 1200 / 300 = every 4th photo.
    expect(pool[0].id).toBe('photo-0');
    expect(pool[1].id).toBe('photo-4');
    expect(pool[COVER_RANK_POOL_MAX - 1].id).toBe('photo-1196');
    // Tag reads are bounded by the same sample.
    expect((mockGetTagsForIds.mock.calls[0][0] as string[]).length).toBe(COVER_RANK_POOL_MAX);

    expect(result.current.photos).toHaveLength(COVER_SUGGESTION_LIMIT);
  });

  it('ranks only photos inside the trip window when both dates are given', async () => {
    const tripStart = 1_700_000_000_000;
    const inside = [photo(1, tripStart + DAY_MS), photo(2, tripStart + 2 * DAY_MS)];
    const outside = [photo(90, tripStart - 30 * DAY_MS), photo(91, tripStart + 30 * DAY_MS)];
    mockGetCachedPhotosByCountry.mockResolvedValue([...outside, ...inside]);

    renderHook(() => useCoverPhotoSuggestions('JP', tripStart, tripStart + 5 * DAY_MS));

    await waitFor(() => expect(mockRankBestPhotos).toHaveBeenCalled());

    const pool = mockRankBestPhotos.mock.calls[0][0] as CachedPhoto[];
    expect(pool.map((p) => p.id)).toEqual(['photo-1', 'photo-2']);
  });

  it('keeps the whole country pool when the trip has no dates', async () => {
    const all = makePhotos(5);
    mockGetCachedPhotosByCountry.mockResolvedValue(all);

    renderHook(() => useCoverPhotoSuggestions('JP', null, null));

    await waitFor(() => expect(mockRankBestPhotos).toHaveBeenCalled());
    expect((mockRankBestPhotos.mock.calls[0][0] as CachedPhoto[]).length).toBe(5);
  });

  it('bails without ranking when BOTH tag tables are empty', async () => {
    mockGetCachedPhotosByCountry.mockResolvedValue(makePhotos(20));
    mockGetTagsForIds.mockResolvedValue(new Map());
    mockGetIntentTagsForIds.mockResolvedValue(new Map());

    const { result } = renderHook(() => useCoverPhotoSuggestions('JP'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockRankBestPhotos).not.toHaveBeenCalled();
    expect(result.current.photos).toEqual([]);
  });

  it('still ranks when only one tag table has rows', async () => {
    mockGetCachedPhotosByCountry.mockResolvedValue(makePhotos(20));
    mockGetTagsForIds.mockResolvedValue(new Map());

    const { result } = renderHook(() => useCoverPhotoSuggestions('JP'));

    await waitFor(() => expect(mockRankBestPhotos).toHaveBeenCalled());
    expect(result.current.photos.length).toBeGreaterThan(0);
  });

  it('discards a stale request when the country changes mid-flight', async () => {
    const jpPhotos = makePhotos(3, 1_600_000_000_000);
    const frPhotos = makePhotos(2, 1_700_000_000_000).map((p) => ({
      ...p,
      id: `fr-${p.id}`,
      countryCode: 'FR',
    }));

    let releaseJp: (photos: CachedPhoto[]) => void = () => {};
    mockGetCachedPhotosByCountry.mockImplementation((code: string) => {
      if (code === 'JP') {
        return new Promise<CachedPhoto[]>((resolve) => {
          releaseJp = resolve;
        });
      }
      return Promise.resolve(frPhotos);
    });

    const { result, rerender } = renderHook(
      ({ code }: { code: string }) => useCoverPhotoSuggestions(code),
      { initialProps: { code: 'JP' } }
    );

    // Switch countries before the JP read resolves.
    rerender({ code: 'FR' });
    await waitFor(() =>
      expect(result.current.photos.map((p) => p.id)).toEqual(frPhotos.map((p) => p.id))
    );

    // The late JP result must not overwrite the current (FR) suggestions.
    releaseJp(jpPhotos);
    await new Promise((resolve) => setImmediate(resolve));

    expect(result.current.photos.map((p) => p.id)).toEqual(frPhotos.map((p) => p.id));
  });

  it('degrades silently to empty when the cache read throws', async () => {
    mockGetCachedPhotosByCountry.mockRejectedValue(new Error('sqlite blew up'));

    const { result } = renderHook(() => useCoverPhotoSuggestions('JP'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.photos).toEqual([]);
  });
});
