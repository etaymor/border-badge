/**
 * CHARACTERIZATION tests for the suggestion dispatch seam (U14).
 *
 * Recorded against the PRE-refactor implementation (the chunked React Query
 * mutation inside `useSuggestPlacesChunked`) and re-run UNCHANGED against the
 * extracted `suggestionDispatch` controller. Every assertion here is an
 * observation of behavior that must survive the extraction byte-for-byte:
 *
 *  - the exact dispatch call sequence (how many requests, and which cluster ids
 *    ride in each one) for all three fetch paths,
 *  - the claim-set transitions observable from outside — the dispatch owner
 *    count (`isFetchingSuggestions`), the retry in-flight guard, and the
 *    `failedClusterIds` map,
 *  - the cache-write set (`cacheSuggestions` arguments) for each path,
 *  - progress accounting and partial-result publication.
 *
 * "The existing suites pass unmodified" is NOT a sufficient oracle for this
 * refactor: every prior concurrency regression in this area was fixed by a later
 * commit rather than caught by those suites. Do not weaken these assertions to
 * make a change pass — a diff here is a behavior change.
 */

import { renderHook, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { AxiosError } from 'axios';
import React from 'react';

import { usePlaceSuggestions } from '../../../screens/photos/usePlaceSuggestions';
import { suggestionDispatch } from '@services/photoImport/suggestionDispatch';
import { CHUNK_SIZE, FIRST_CHUNK_SIZE, planSuggestionBatches } from '@hooks/usePhotoImport';
import { api } from '@services/api';
import { Analytics } from '@services/analytics';
import { getVisionImagesForCluster } from '@services/photoImport/visionPhoto';
import { manipulateAsync } from 'expo-image-manipulator';
import {
  getCachedSuggestions,
  cacheSuggestions,
  getFullCluster,
  type LocationCluster,
} from '@services/photoImport';

// ---- Mocks -----------------------------------------------------------------

jest.mock('@services/photoImport', () => ({
  getFullCluster: jest.fn(),
  getCachedSuggestions: jest.fn(),
  cacheSuggestions: jest.fn(),
  clusterLocationKey: jest.fn(
    (centroid: { latitude: number; longitude: number }) =>
      `loc:${centroid.latitude},${centroid.longitude}`
  ),
  computeTimeHint: jest.fn(() => 'attraction'),
}));

jest.mock('@services/photoImport/visionPhoto', () => ({
  getVisionImagesForCluster: jest.fn().mockResolvedValue([]),
}));

// Only reached by the U1/U2 block below, which routes the (otherwise mocked)
// `getVisionImagesForCluster` to the real implementation.
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('@services/photoImport/photoTagDb', () => ({
  getTagsForIds: jest.fn().mockResolvedValue(new Map()),
  getIntentTagsForIds: jest.fn().mockResolvedValue(new Map()),
}));

jest.mock('@services/analytics', () => ({
  Analytics: {
    photoImportSuggestionsCompleted: jest.fn(),
    photoImportApiError: jest.fn(),
  },
  calculateApiPercentiles: jest.fn(() => ({ p50: 100, p95: 200, p99: 300 })),
}));

jest.mock('@stores/subscriptionStore', () => ({
  useSubscriptionStore: jest.fn(() => jest.fn()),
  useIsPremium: jest.fn(() => true),
  useCanImportPhotos: jest.fn(() => true),
}));

jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

const mockedApi = api as jest.Mocked<typeof api>;
const mockedGetCachedSuggestions = getCachedSuggestions as jest.MockedFunction<
  typeof getCachedSuggestions
>;
const mockedCacheSuggestions = cacheSuggestions as jest.MockedFunction<typeof cacheSuggestions>;
const mockedGetFullCluster = getFullCluster as jest.MockedFunction<typeof getFullCluster>;

// ---- Fixed input -----------------------------------------------------------

function makeCluster(id: string, lat = 35, lng = 139): LocationCluster {
  return {
    id,
    geohash: 'gh',
    centroid: { latitude: lat, longitude: lng },
    photos: [
      {
        id: `photo-${id}`,
        uri: `file://${id}.jpg`,
        filename: `${id}.jpg`,
        creationTime: new Date('2024-01-01T00:00:00Z'),
        location: { latitude: lat, longitude: lng },
      },
    ],
    timeRange: { start: new Date('2024-01-01T00:00:00Z'), end: new Date('2024-01-01T01:00:00Z') },
    countryCode: 'JP',
  };
}

/**
 * THE fixed input: 8 clusters, which the U5 ramp splits into batches of
 * 2 / 5 / 1. Derived from the real plan so a future tuning of the ramp does not
 * silently invalidate the recording.
 */
const FIXED_CLUSTER_COUNT = FIRST_CHUNK_SIZE + CHUNK_SIZE + 1;
const FIXED_CLUSTERS = Array.from({ length: FIXED_CLUSTER_COUNT }, (_, i) =>
  makeCluster(`fx-${i}`, 35 + i * 0.01, 139 + i * 0.01)
);
const FIXED_BATCHES = planSuggestionBatches(FIXED_CLUSTERS).map((batch) => batch.map((c) => c.id));

const buildCandidate = (clusters: LocationCluster[], id = 'cand-fixed') => ({
  id,
  countryCode: 'JP',
  dateRange: { start: new Date(), end: new Date() },
  photoIds: [],
  photoCount: clusters.length,
  previewUris: [],
  previewAssetIds: [],
  locationClusterIds: clusters.map((c) => c.id),
});

const placeFor = (id: string) => ({
  place_id: `ChIJ_${id}`,
  name: `Place ${id}`,
  address: '1 St',
  location: { latitude: 35, longitude: 139 },
  category: 'place',
  distance_m: 10,
  types: ['point_of_interest'],
});

const respondFor = (ids: string[], withPlaces: boolean, failedCount = 0) => ({
  data: {
    suggestions: ids.map((id) => ({
      cluster_id: id,
      photo_ids: [`photo-${id}`],
      places: withPlaces ? [placeFor(id)] : [],
    })),
    failed_cluster_count: failedCount,
  },
});

/** Cluster ids carried by each recorded `/photos/suggest-places` request. */
const dispatchedIdSequence = () =>
  mockedApi.post.mock.calls.map((call) =>
    (call[1] as { clusters: { id: string }[] }).clusters.map((c) => c.id)
  );

/** Every cluster id written to the SQLite suggestion cache, per write. */
const cacheWriteSequence = () =>
  mockedCacheSuggestions.mock.calls.map((call) => call[0].map((row) => row.cluster_id));

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });

function setup(
  clusters: LocationCluster[],
  currentCandidateIdRef?: React.RefObject<string | null>
) {
  const lookup = new Map<string, LocationCluster>();
  for (const c of clusters) lookup.set(c.id, c);
  mockedGetFullCluster.mockImplementation((id: string) => lookup.get(id));
  const clusterLookupRef = { current: lookup } as React.RefObject<Map<string, LocationCluster>>;
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => usePlaceSuggestions({ clusterLookupRef, currentCandidateIdRef }), {
    wrapper,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // The controller is a module-level singleton (U14), so one recording's
  // leftovers would otherwise leak into the next.
  suggestionDispatch.resetForTests();
  mockedGetCachedSuggestions.mockResolvedValue(new Map());
  mockedCacheSuggestions.mockResolvedValue(undefined as never);
});

// ---- Path 1: main dispatch -------------------------------------------------

describe('CHARACTERIZATION: main dispatch (fetchSuggestions)', () => {
  it('records the batch plan for the fixed input', () => {
    expect(FIXED_BATCHES).toEqual([
      ['fx-0', 'fx-1'],
      ['fx-2', 'fx-3', 'fx-4', 'fx-5', 'fx-6'],
      ['fx-7'],
    ]);
  });

  it('dispatch sequence, cache-write set, and failure attribution for a mid-run batch failure', async () => {
    // Batch 1 matches, batch 2 throws a non-fatal error, batch 3 answers empty.
    mockedApi.post
      .mockResolvedValueOnce(respondFor(FIXED_BATCHES[0], true))
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce(respondFor(FIXED_BATCHES[2], false));

    const { result } = setup(FIXED_CLUSTERS);

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(FIXED_CLUSTERS));
    });

    // 1. Dispatch call sequence: one request per planned batch, in plan order,
    //    each carrying ONLY its own clusters.
    expect(dispatchedIdSequence()).toEqual(FIXED_BATCHES);

    // 2. Cache-write set: exactly one write, carrying the clusters with positive
    //    evidence of a response. Batch 2's clusters are excluded (R20/KTD8).
    expect(cacheWriteSequence()).toEqual([['fx-0', 'fx-1', 'fx-7']]);

    // 3. Failure attribution: exactly batch 2, retry ENABLED (non-fatal).
    const failed = result.current.suggestionDispatch.failedClusterIds;
    expect([...failed.keys()].sort()).toEqual([...FIXED_BATCHES[1]].sort());
    for (const id of FIXED_BATCHES[1]) {
      expect(failed.get(id)).toEqual({ retryDisabled: false });
    }

    // 4. Progress accounting sums ACTUAL batch sizes and counts the failed batch.
    expect(result.current.suggestionDispatch.progress).toEqual({
      clustersTotal: FIXED_CLUSTER_COUNT,
      clustersCompleted: FIXED_CLUSTER_COUNT,
      percentage: 100,
      failedChunks: 1,
      failedClusters: 0,
    });

    // 5. Partial results carry every responded cluster, in dispatch order.
    expect(result.current.suggestionDispatch.partialResults.map((s) => s.cluster_id)).toEqual([
      ...FIXED_BATCHES[0],
      ...FIXED_BATCHES[2],
    ]);

    // 6. The claim set is fully released once dispatch settles.
    expect(result.current.isFetchingSuggestions).toBe(false);
  });

  it('claim-set transition: the owner slot is held across the whole pipeline and released once', async () => {
    let releaseFirst!: (value: unknown) => void;
    mockedApi.post
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = resolve as (value: unknown) => void;
          })
      )
      .mockResolvedValue(respondFor([], false));

    const { result } = setup(FIXED_CLUSTERS);

    let done!: Promise<unknown>;
    await act(async () => {
      done = result.current.fetchSuggestions(buildCandidate(FIXED_CLUSTERS));
      await Promise.resolve();
    });

    // Claimed before the first response lands...
    expect(result.current.isFetchingSuggestions).toBe(true);

    await act(async () => {
      releaseFirst(respondFor(FIXED_BATCHES[0], true));
      await done;
    });

    // ...and released only once EVERY batch settled.
    expect(result.current.isFetchingSuggestions).toBe(false);
    expect(mockedApi.post).toHaveBeenCalledTimes(FIXED_BATCHES.length);
  });

  // RE-RECORDED at U6 (KTD6). This is the ONE characterization assertion the
  // unit deliberately changes, and only in two places, both of which were
  // artifacts of the fatal re-throw rather than properties worth preserving:
  //
  //  (a) attribution no longer spills onto the batches that never went out. The
  //      old code marked "this batch plus everything after it" retry-DISABLED by
  //      slicing the batch plan at the loop index — a dispatch frontier that only
  //      exists while dispatch is sequential. A cluster that was never sent has
  //      not been rate limited; it is left unattributed so the settle sweep
  //      renders it lookup-failed with retry ENABLED (R2).
  //  (b) the successful batch's cache row now survives. The re-throw discarded
  //      the whole result, so a rate limit halfway through an import threw away
  //      the lookups the user had already paid for and re-bought them on return.
  //
  // Everything else about this recording is unchanged: the same two requests go
  // out in the same order, the third batch is still never dispatched, and no
  // never-dispatched cluster is ever written to the cache.
  it('fatal 429 attributes only the rejected batch, keeps earlier results, then stops', async () => {
    const err = new AxiosError('rate limited');
    err.response = {
      status: 429,
      headers: { 'retry-after': '30' },
      data: {},
      statusText: '',
      config: {} as never,
    };

    mockedApi.post
      .mockResolvedValueOnce(respondFor(FIXED_BATCHES[0], true))
      .mockRejectedValueOnce(err);

    const { result } = setup(FIXED_CLUSTERS);

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(FIXED_CLUSTERS));
    });

    // Batch 3 is never dispatched. (unchanged)
    expect(dispatchedIdSequence()).toEqual([FIXED_BATCHES[0], FIXED_BATCHES[1]]);

    // Batch 2 — the batch that was actually rejected — is attributed with retry
    // DISABLED. Batch 3, which never went out, is left unattributed here; the
    // settle sweep gives it retry-ENABLED lookup-failed instead.
    const failed = result.current.suggestionDispatch.failedClusterIds;
    expect([...failed.keys()].sort()).toEqual([...FIXED_BATCHES[1]].sort());
    for (const id of FIXED_BATCHES[1]) {
      expect(failed.get(id)).toEqual({ retryDisabled: true });
    }
    for (const id of FIXED_BATCHES[2]) {
      expect(failed.has(id)).toBe(false);
    }

    // Nothing is written to cache for a never-dispatched cluster (R20) — the
    // whole point of the allow-list. Batch 1 answered, so its rows are kept.
    expect(cacheWriteSequence()).toEqual([[...FIXED_BATCHES[0]]]);
    expect(result.current.isFetchingSuggestions).toBe(false);
  });

  it('writes a cache row for every cluster when no batch reports a failure', async () => {
    mockedApi.post
      .mockResolvedValueOnce(respondFor(FIXED_BATCHES[0], true))
      .mockResolvedValueOnce(respondFor(FIXED_BATCHES[1], false))
      .mockResolvedValueOnce(respondFor(FIXED_BATCHES[2], true));

    const { result } = setup(FIXED_CLUSTERS);

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(FIXED_CLUSTERS));
    });

    expect(dispatchedIdSequence()).toEqual(FIXED_BATCHES);
    expect(cacheWriteSequence()).toEqual([FIXED_CLUSTERS.map((c) => c.id)]);
    expect(result.current.suggestionDispatch.failedClusterIds.size).toBe(0);
  });

  it('a per-cluster timeout inside a responded batch is not cached and not attributed', async () => {
    // Batch 2 responds for 4 of its 5 clusters and reports one timed out.
    const respondedInBatch2 = FIXED_BATCHES[1].slice(0, 4);
    mockedApi.post
      .mockResolvedValueOnce(respondFor(FIXED_BATCHES[0], true))
      .mockResolvedValueOnce(respondFor(respondedInBatch2, true, 1))
      .mockResolvedValueOnce(respondFor(FIXED_BATCHES[2], true));

    const { result } = setup(FIXED_CLUSTERS);

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(FIXED_CLUSTERS));
    });

    // The timed-out cluster is NOT written as an empty cache row...
    expect(cacheWriteSequence()).toEqual([
      [...FIXED_BATCHES[0], ...respondedInBatch2, ...FIXED_BATCHES[2]],
    ]);
    // ...and it is NOT attributed as a batch failure either (the batch answered).
    expect(result.current.suggestionDispatch.failedClusterIds.size).toBe(0);
    expect(result.current.suggestionDispatch.progress?.failedClusters).toBe(1);
  });
});

// ---- Path 2: manual split --------------------------------------------------

describe('CHARACTERIZATION: manual split (fetchForClusters)', () => {
  it('dispatches one request for the passed clusters and caches only responded ones', async () => {
    const a = makeCluster('sp-a', 35.1, 139.1);
    const b = makeCluster('sp-b', 35.2, 139.2);

    mockedApi.post.mockResolvedValueOnce(respondFor(['sp-a'], true, 1));

    const { result } = setup([a, b]);

    await act(async () => {
      await result.current.fetchForClusters([a, b]);
    });

    expect(dispatchedIdSequence()).toEqual([['sp-a', 'sp-b']]);
    expect(cacheWriteSequence()).toEqual([['sp-a']]);
    expect(result.current.cachedSuggestions.map((s) => s.cluster_id)).toEqual(['sp-a']);
    expect(result.current.isFetchingSuggestions).toBe(false);
  });

  it('writes nothing and attributes nothing when the whole split call throws', async () => {
    const a = makeCluster('sp-x', 35.1, 139.1);
    mockedApi.post.mockRejectedValueOnce(new Error('network blip'));

    const { result } = setup([a]);

    await act(async () => {
      await result.current.fetchForClusters([a]);
    });

    expect(cacheWriteSequence()).toEqual([]);
    expect(result.current.cachedSuggestions).toEqual([]);
    expect(result.current.isFetchingSuggestions).toBe(false);
  });
});

// ---- Path 3: retry ---------------------------------------------------------

describe('CHARACTERIZATION: retry (retryFailedClusters)', () => {
  it('dispatches only the passed ids and partitions responded vs re-failed', async () => {
    const a = makeCluster('rt-a', 35.1, 139.1);
    const b = makeCluster('rt-b', 35.2, 139.2);
    const untouched = makeCluster('rt-ok', 35.3, 139.3);

    mockedApi.post.mockResolvedValueOnce(respondFor(['rt-a'], true, 1));

    const { result } = setup([a, b, untouched]);

    await act(async () => {
      await result.current.retryFailedClusters(['rt-a', 'rt-b']);
    });

    expect(dispatchedIdSequence()).toEqual([['rt-a', 'rt-b']]);
    expect(cacheWriteSequence()).toEqual([['rt-a']]);
    expect(result.current.cachedSuggestions.map((s) => s.cluster_id)).toEqual(['rt-a']);
    // The re-failed cluster returns to lookup-failed with retry still enabled.
    expect(result.current.suggestionDispatch.failedClusterIds.get('rt-b')).toEqual({
      retryDisabled: false,
    });
    expect(result.current.suggestionDispatch.failedClusterIds.has('rt-a')).toBe(false);
    // Retry takes NO dispatch owner slot (it drives retryingClusterIds instead).
    expect(result.current.isFetchingSuggestions).toBe(false);
    expect(result.current.retryingClusterIds.size).toBe(0);
  });

  it('claim-set transition: a second retry for an in-flight cluster is dropped', async () => {
    const c = makeCluster('rt-race', 35.1, 139.1);

    let releaseApi: ((value: unknown) => void) | undefined;
    const gate = new Promise((resolve) => {
      releaseApi = resolve;
    });
    mockedApi.post.mockReturnValueOnce(gate as never);

    const { result } = setup([c]);

    await act(async () => {
      const first = result.current.retryFailedClusters(['rt-race']);
      await Promise.resolve();
      await Promise.resolve();
      // Claimed by the first call -> the second must be a no-op.
      const second = result.current.retryFailedClusters(['rt-race']);
      releaseApi?.(respondFor(['rt-race'], true));
      await Promise.all([first, second]);
    });

    expect(mockedApi.post).toHaveBeenCalledTimes(1);
    expect(cacheWriteSequence()).toEqual([['rt-race']]);
    expect(result.current.retryingClusterIds.size).toBe(0);
  });

  it('does not dispatch for a retry-disabled cluster', async () => {
    const quota = makeCluster('rt-quota', 35.1, 139.1);
    const err = new AxiosError('rate limited');
    err.response = { status: 429, headers: {}, data: {}, statusText: '', config: {} as never };
    mockedApi.post.mockRejectedValueOnce(err);

    const { result } = setup([quota]);

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate([quota], 'cand-quota'));
    });

    expect(result.current.suggestionDispatch.failedClusterIds.get('rt-quota')?.retryDisabled).toBe(
      true
    );

    mockedApi.post.mockClear();

    await act(async () => {
      await result.current.retryFailedClusters(['rt-quota']);
    });

    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('serves a retry from the SQLite cache without dispatching', async () => {
    const c = makeCluster('rt-cached', 35.1, 139.1);
    mockedGetCachedSuggestions.mockResolvedValueOnce(
      new Map([['rt-cached', [placeFor('rt-cached')]]])
    );

    const { result } = setup([c]);

    await act(async () => {
      await result.current.retryFailedClusters(['rt-cached']);
    });

    expect(mockedApi.post).not.toHaveBeenCalled();
    expect(cacheWriteSequence()).toEqual([]);
    expect(result.current.cachedSuggestions.map((s) => s.cluster_id)).toEqual(['rt-cached']);
  });
});

// ---- U1/U2: vision preparation over iCloud-offloaded photos ----------------
//
// NOT a recording of pre-refactor behavior: these pin the fix for the Sept 2026
// Paris import, where every batch waited ~10-20s on `manipulateAsync` over
// `ph://` originals that were never going to download, and then posted with no
// images anyway. They drive the real hook wiring (`createVisionPrepareBatch`)
// through the real `getVisionImagesForCluster`.

describe('U1/U2: vision preparation does not stall the dispatch on offloaded photos', () => {
  const mockedGetVisionImages = getVisionImagesForCluster as jest.MockedFunction<
    typeof getVisionImagesForCluster
  >;
  const mockedManipulate = manipulateAsync as jest.MockedFunction<typeof manipulateAsync>;
  const realVision = jest.requireActual<typeof import('@services/photoImport/visionPhoto')>(
    '@services/photoImport/visionPhoto'
  );

  /** A cluster whose `count` photos all carry `uriFor(i)` and cached dimensions. */
  function clusterWith(id: string, index: number, count: number, uriFor: (i: number) => string) {
    const base = makeCluster(id, 35 + index * 0.01, 139 + index * 0.01);
    const template = base.photos[0];
    base.photos = Array.from({ length: count }, (_, i) => ({
      ...template,
      id: `photo-${id}-${i}`,
      uri: uriFor(i),
      creationTime: new Date(template.creationTime.getTime() + i * 60_000),
      width: 1600,
      height: 900,
    }));
    return base;
  }

  const postedClusters = () =>
    mockedApi.post.mock.calls.flatMap(
      (call) =>
        (call[1] as { clusters: { id: string; vision_images_base64?: string[] }[] }).clusters
    );

  beforeEach(() => {
    mockedGetVisionImages.mockImplementation((...args) =>
      realVision.getVisionImagesForCluster(...args)
    );
    // iCloud-only (`ph://`) and pixel-less files never finish encoding;
    // anything else encodes instantly.
    mockedManipulate.mockImplementation(((uri: string) =>
      uri.startsWith('ph://') || uri.includes('stall')
        ? new Promise(() => {})
        : Promise.resolve({ uri, width: 768, height: 432, base64: `b64:${uri}` })) as never);
    mockedApi.post.mockImplementation(async (_url, body) =>
      respondFor(
        (body as { clusters: { id: string }[] }).clusters.map((c) => c.id),
        true
      )
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    mockedGetVisionImages.mockReset();
    mockedGetVisionImages.mockResolvedValue([]);
    mockedManipulate.mockReset();
    mockedApi.post.mockReset();
  });

  /**
   * Kick off the main dispatch, report how many requests went out within
   * `windowMs` of fake time, then drain the run so nothing leaks.
   */
  async function postsWithin(clusters: LocationCluster[], windowMs: number) {
    const { result } = setup(clusters);
    let run!: Promise<unknown>;
    await act(async () => {
      run = result.current.fetchSuggestions(buildCandidate(clusters));
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(windowMs);
    });
    const posted = mockedApi.post.mock.calls.length;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10 * 60_000);
      await run;
    });
    return posted;
  }

  it('posts every batch of a fully offloaded trip within one second, with no images', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const clusters = Array.from({ length: 12 }, (_, i) =>
      clusterWith(`icloud-${i}`, i, 3, (p) => `ph://icloud-${i}-${p}`)
    );
    const batchCount = planSuggestionBatches(clusters).length;

    const postedInFirstSecond = await postsWithin(clusters, 1000);

    expect(postedInFirstSecond).toBe(batchCount);
    expect(mockedManipulate).not.toHaveBeenCalled();
    expect(postedClusters()).toHaveLength(clusters.length);
    expect(postedClusters().every((c) => c.vision_images_base64 === undefined)).toBe(true);
  });

  it('stops preparing once repeated timeouts open the breaker: later batches go out bare', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    // Local paths whose encodes hang anyway (the backstop KTD1 cannot see).
    const clusters = Array.from({ length: FIRST_CHUNK_SIZE + CHUNK_SIZE * 3 }, (_, i) =>
      clusterWith(`stall-${i}`, i, 3, (p) => `file://stall-${i}-${p}.jpg`)
    );
    const batches = planSuggestionBatches(clusters);
    const lastBatchUris = new Set(
      batches[batches.length - 1].flatMap((c) => c.photos.map((p) => p.uri))
    );

    await postsWithin(clusters, 0);

    expect(mockedApi.post).toHaveBeenCalledTimes(batches.length);
    const encodedUris = mockedManipulate.mock.calls.map((call) => call[0]);
    expect(encodedUris.some((uri) => lastBatchUris.has(uri))).toBe(false);
    expect(postedClusters().every((c) => c.vision_images_base64 === undefined)).toBe(true);
  });

  it('a new dispatch starts with the breaker closed', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const stalled = Array.from({ length: FIRST_CHUNK_SIZE + CHUNK_SIZE }, (_, i) =>
      clusterWith(`stall-${i}`, i, 3, (p) => `file://stall-${i}-${p}.jpg`)
    );
    await postsWithin(stalled, 0);
    mockedApi.post.mockClear();

    const local = Array.from({ length: FIRST_CHUNK_SIZE }, (_, i) =>
      clusterWith(`fresh-${i}`, 20 + i, 3, (p) => `file://fresh-${i}-${p}.jpg`)
    );
    const { result } = setup(local);
    let run!: Promise<unknown>;
    await act(async () => {
      run = result.current.fetchSuggestions(buildCandidate(local, 'cand-fresh'));
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
      await run;
    });

    expect(postedClusters().map((c) => c.vision_images_base64?.length)).toEqual([3, 3]);
  });

  // U3/R4: the completed event carries the dispatch's preparation telemetry.
  const lastCompletedProps = () =>
    (Analytics.photoImportSuggestionsCompleted as jest.Mock).mock.calls.at(-1)?.[0];

  it('reports 2 produced, 1 timed out and 4 offloaded skips on the completed event', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const clusters = [
      clusterWith('mixed-0', 0, 3, (p) => (p < 2 ? `file://ok-${p}.jpg` : 'file://stall-2.jpg')),
      clusterWith('icloud-1', 1, 4, (p) => `ph://icloud-1-${p}`),
    ];

    await postsWithin(clusters, 0);

    expect(lastCompletedProps().prep).toMatchObject({
      visionImagesAttempted: 3,
      visionImagesProduced: 2,
      visionImagesTimedOut: 1,
      visionPhotosSkippedOffloaded: 4,
      breakerOpened: false,
    });
    expect(lastCompletedProps().prep.prepareMsTotal).toBeGreaterThanOrEqual(10_000);
    expect(lastCompletedProps().prep.prepareMsMax).toBeGreaterThanOrEqual(10_000);
  });

  it('reports an opened breaker on the completed event', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const clusters = Array.from({ length: FIRST_CHUNK_SIZE + CHUNK_SIZE }, (_, i) =>
      clusterWith(`stall-${i}`, i, 3, (p) => `file://stall-${i}-${p}.jpg`)
    );

    await postsWithin(clusters, 0);

    expect(lastCompletedProps().prep).toMatchObject({
      breakerOpened: true,
      visionImagesProduced: 0,
    });
    expect(lastCompletedProps().prep.visionImagesTimedOut).toBeGreaterThanOrEqual(3);
  });

  it('a fully local dispatch still attaches up to 3 images per cluster', async () => {
    const clusters = Array.from({ length: FIXED_CLUSTER_COUNT }, (_, i) =>
      clusterWith(`local-${i}`, i, 4, (p) => `file://local-${i}-${p}.jpg`)
    );

    const { result } = setup(clusters);
    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(clusters));
    });

    expect(dispatchedIdSequence()).toEqual(
      planSuggestionBatches(clusters).map((b) => b.map((c) => c.id))
    );
    expect(postedClusters().map((c) => c.vision_images_base64?.length)).toEqual(
      clusters.map(() => 3)
    );
  });
});
