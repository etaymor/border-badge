/**
 * Tests for the `suggestionDispatch` controller (U14).
 *
 * The failure-attribution and pipelined-preparation suites were MOVED here
 * verbatim from `src/__tests__/hooks/usePhotoImport.test.tsx` when the chunked
 * React Query mutation was retired: the behavior is unchanged, only its owner
 * is. Everything below the "U14" divider is new coverage for the seam itself —
 * the two cluster sets, claim deduplication, the dispatched-and-resolved
 * allow-list, and survival across navigation.
 */

import { AxiosError } from 'axios';

import {
  suggestionDispatch,
  planSuggestionBatches,
  CHUNK_SIZE,
  FIRST_CHUNK_SIZE,
  SUGGEST_PLACES_TIMEOUT_MS,
  type PlaceSuggestionCluster,
} from '../../../services/photoImport/suggestionDispatch';
import { api } from '../../../services/api';

jest.mock('../../../services/api', () => ({
  api: {
    post: jest.fn(),
  },
}));

const mockedApi = api as jest.Mocked<typeof api>;

// Chunk boundaries are derived from the real batch plan rather than hardcoded,
// so tuning CHUNK_SIZE or the U5 first-batch ramp can't silently invalidate
// these tests.
const buildClusters = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `cluster-${i}`,
    centroid: { latitude: 35 + i * 0.001, longitude: 139 + i * 0.001 },
    photos: [{ asset_id: `photo-${i}`, latitude: 35, longitude: 139 }],
  }));

/** Enough clusters to produce EXACTLY `batches` dispatch batches. */
const buildClustersForBatches = (batches: number) =>
  buildClusters(FIRST_CHUNK_SIZE + (batches - 1) * CHUNK_SIZE);

/** Cluster ids belonging to the nth (0-indexed) dispatch batch. */
const chunkIds = (clusters: { id: string }[], n: number) =>
  planSuggestionBatches(clusters)[n].map((c) => c.id);

const suggestionsFor = (ids: string[]) =>
  ids.map((id) => ({ cluster_id: id, photo_ids: [`photo-${id}`], places: [] }));

const makeAxiosError = (status: number, headers: Record<string, string> = {}) => {
  const err = new AxiosError('request failed');
  // @ts-expect-error - minimal AxiosError response shape for the test
  err.response = { status, headers };
  return err;
};

// The backend sends Retry-After ONLY on a genuine quota 503; a config/network
// 503 carries no header and must stay retryable. Mirror that here.
const makeQuotaError = () => makeAxiosError(503, { 'retry-after': '3600' });

const emptyResponse = { data: { suggestions: [], failed_cluster_count: 0 } };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  // The controller is a module-level singleton, so one test's leftovers would
  // otherwise leak into the next.
  suggestionDispatch.resetForTests();
});

describe('suggestionDispatch - failedClusterIds (KTD6/KTD8/KTD10)', () => {
  it('records exactly chunk-2 cluster IDs in failedClusterIds when chunk-2 throws (non-fatal)', async () => {
    const clusters = buildClustersForBatches(2); // exactly two batches
    const chunk1Ids = chunkIds(clusters, 0);
    const chunk2Ids = chunkIds(clusters, 1);

    mockedApi.post
      .mockResolvedValueOnce({
        data: { suggestions: suggestionsFor(chunk1Ids), failed_cluster_count: 0 },
      })
      // chunk-2 throws a non-fatal (generic) error
      .mockRejectedValueOnce(new Error('network blip'));

    await suggestionDispatch.dispatch({ clusters });

    const failed = suggestionDispatch.getState().failedClusterIds;
    expect(failed).toBeInstanceOf(Map);
    expect([...failed.keys()].sort()).toEqual([...chunk2Ids].sort());
    // chunk-1 ids must NOT be marked failed
    for (const id of chunk1Ids) {
      expect(failed.has(id)).toBe(false);
    }
    // non-fatal failures are retry-enabled
    for (const id of chunk2Ids) {
      expect(failed.get(id)).toEqual({ retryDisabled: false });
    }
  });

  it('records remaining clusters with retryDisabled=true when a chunk throws 503 (quota)', async () => {
    const clusters = buildClustersForBatches(2);
    const chunk1Ids = chunkIds(clusters, 0);
    const chunk2Ids = chunkIds(clusters, 1);

    mockedApi.post
      .mockResolvedValueOnce({
        data: { suggestions: suggestionsFor(chunk1Ids), failed_cluster_count: 0 },
      })
      .mockRejectedValueOnce(makeQuotaError());

    await expect(suggestionDispatch.dispatch({ clusters })).rejects.toMatchObject({
      name: 'QuotaExhaustedError',
    });

    // The fatal error surfaces, but the un-responded clusters are NOT dropped.
    const failed = suggestionDispatch.getState().failedClusterIds;
    expect([...failed.keys()].sort()).toEqual([...chunk2Ids].sort());
    for (const id of chunk2Ids) {
      expect(failed.get(id)).toEqual({ retryDisabled: true });
    }
  });

  it('records remaining clusters with retryDisabled=true when a chunk throws 429 (rate limit)', async () => {
    const clusters = buildClustersForBatches(2);
    const chunk1Ids = chunkIds(clusters, 0);
    const chunk2Ids = chunkIds(clusters, 1);

    mockedApi.post
      .mockResolvedValueOnce({
        data: { suggestions: suggestionsFor(chunk1Ids), failed_cluster_count: 0 },
      })
      .mockRejectedValueOnce(makeAxiosError(429, { 'retry-after': '30' }));

    await expect(suggestionDispatch.dispatch({ clusters })).rejects.toMatchObject({
      name: 'RateLimitError',
    });

    const failed = suggestionDispatch.getState().failedClusterIds;
    expect([...failed.keys()].sort()).toEqual([...chunk2Ids].sort());
    for (const id of chunk2Ids) {
      expect(failed.get(id)).toEqual({ retryDisabled: true });
    }
  });

  it('records ALL remaining clusters (current + later chunks) on a fatal error in an early chunk', async () => {
    const clusters = buildClustersForBatches(3); // exactly three batches
    const chunk2Ids = chunkIds(clusters, 1);
    const chunk3Ids = chunkIds(clusters, 2);

    mockedApi.post
      .mockResolvedValueOnce({
        data: { suggestions: suggestionsFor(chunkIds(clusters, 0)), failed_cluster_count: 0 },
      })
      // chunk-2 throws fatal — chunk-3 never runs
      .mockRejectedValueOnce(makeQuotaError());

    await expect(suggestionDispatch.dispatch({ clusters })).rejects.toThrow();

    const failed = suggestionDispatch.getState().failedClusterIds;
    expect([...failed.keys()].sort()).toEqual([...chunk2Ids, ...chunk3Ids].sort());
  });

  it('leaves failedClusterIds empty when all chunks succeed', async () => {
    const clusters = buildClustersForBatches(2);
    mockedApi.post
      .mockResolvedValueOnce({
        data: { suggestions: suggestionsFor(chunkIds(clusters, 0)), failed_cluster_count: 0 },
      })
      .mockResolvedValueOnce({
        data: { suggestions: suggestionsFor(chunkIds(clusters, 1)), failed_cluster_count: 0 },
      });

    await suggestionDispatch.dispatch({ clusters });

    expect(suggestionDispatch.getState().failedClusterIds.size).toBe(0);
  });

  it('clears failedClusterIds on reset', async () => {
    const clusters = buildClustersForBatches(2);
    mockedApi.post
      .mockResolvedValueOnce({
        data: { suggestions: suggestionsFor(chunkIds(clusters, 0)), failed_cluster_count: 0 },
      })
      .mockRejectedValueOnce(new Error('network blip'));

    await suggestionDispatch.dispatch({ clusters });
    expect(suggestionDispatch.getState().failedClusterIds.size).toBeGreaterThan(0);

    suggestionDispatch.reset();
    expect(suggestionDispatch.getState().failedClusterIds.size).toBe(0);
  });

  it('keeps a 503 WITHOUT Retry-After retryable instead of reporting quota exhausted', async () => {
    // The backend returns 503 for a misconfigured service and for an unreachable
    // upstream, neither of which is a quota problem. Treating every 503 as fatal
    // showed "Daily limit reached" and hid the Retry button, so a transient
    // outage looked permanent. Only the quota 503 carries Retry-After.
    const clusters = buildClustersForBatches(2);
    const chunk1Ids = chunkIds(clusters, 0);
    const chunk2Ids = chunkIds(clusters, 1);

    mockedApi.post
      .mockResolvedValueOnce({
        data: { suggestions: suggestionsFor(chunk1Ids), failed_cluster_count: 0 },
      })
      .mockRejectedValueOnce(makeAxiosError(503)); // no Retry-After

    // Non-fatal: the loop keeps going and the dispatch resolves.
    await expect(suggestionDispatch.dispatch({ clusters })).resolves.toBeDefined();

    const failed = suggestionDispatch.getState().failedClusterIds;
    expect([...failed.keys()].sort()).toEqual([...chunk2Ids].sort());
    // ...and crucially the user can still retry them.
    for (const id of chunk2Ids) {
      expect(failed.get(id)).toEqual({ retryDisabled: false });
    }
  });
});

describe('suggestionDispatch - batch ramp and pipelined preparation (U5)', () => {
  it('R24: dispatches a SMALLER first batch, then full-size batches', () => {
    const batches = planSuggestionBatches(buildClusters(FIRST_CHUNK_SIZE + CHUNK_SIZE * 2));

    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(FIRST_CHUNK_SIZE);
    expect(batches[0].length).toBeLessThan(batches[1].length);
    expect(batches[1]).toHaveLength(CHUNK_SIZE);
    expect(batches[2]).toHaveLength(CHUNK_SIZE);
    // Every cluster is dispatched exactly once, in order.
    expect(batches.flat().map((c) => c.id)).toEqual(
      buildClusters(FIRST_CHUNK_SIZE + CHUNK_SIZE * 2).map((c) => c.id)
    );
  });

  it('R24: does not split an import that already fits in the first batch', () => {
    expect(planSuggestionBatches(buildClusters(FIRST_CHUNK_SIZE))).toHaveLength(1);
    expect(planSuggestionBatches([])).toEqual([]);
  });

  it('uses the long suggestions timeout on every request', async () => {
    mockedApi.post.mockResolvedValue(emptyResponse);

    await suggestionDispatch.dispatch({ clusters: buildClusters(1) });

    expect(mockedApi.post).toHaveBeenCalledWith(
      '/photos/suggest-places',
      expect.anything(),
      expect.objectContaining({ timeout: SUGGEST_PLACES_TIMEOUT_MS })
    );
  });

  it('R5: issues the first request BEFORE later batches finish preparing', async () => {
    const clusters = buildClustersForBatches(2);
    const gate = deferred<void>();
    let secondPreparationDone = false;
    let preparationsStartedAtFirstPost = -1;

    const prepareBatch = jest.fn(async (batch: PlaceSuggestionCluster[]) => {
      if (prepareBatch.mock.calls.length === 2) {
        await gate.promise;
        secondPreparationDone = true;
      }
      return batch;
    });

    mockedApi.post.mockImplementation(async () => {
      if (mockedApi.post.mock.calls.length === 1) {
        preparationsStartedAtFirstPost = prepareBatch.mock.calls.length;
        // The first request is in flight while batch two is still encoding.
        expect(secondPreparationDone).toBe(false);
        gate.resolve();
      }
      return emptyResponse;
    });

    await suggestionDispatch.dispatch({ clusters, prepareBatch });

    // Batch two's preparation had already STARTED when batch one dispatched:
    // preparation overlaps the round trip instead of preceding every request.
    expect(preparationsStartedAtFirstPost).toBe(2);
    expect(secondPreparationDone).toBe(true);
    expect(mockedApi.post).toHaveBeenCalledTimes(2);
  });

  it('retains only in-flight payloads: prepares at most one batch ahead and keeps none after dispatch', async () => {
    const clusters = buildClustersForBatches(3);
    const preparedAtEachPost: number[] = [];

    const prepareBatch = jest.fn(async (batch: PlaceSuggestionCluster[]) =>
      batch.map((c) => ({ ...c, vision_images_base64: [`payload-${c.id}`] }))
    );

    mockedApi.post.mockImplementation(async () => {
      preparedAtEachPost.push(prepareBatch.mock.calls.length);
      return emptyResponse;
    });

    const resolved = await suggestionDispatch.dispatch({ clusters, prepareBatch });

    expect(mockedApi.post).toHaveBeenCalledTimes(3);
    // At each dispatch at most ONE further batch has been prepared, so the
    // pipeline never runs ahead of what is in flight.
    preparedAtEachPost.forEach((preparedCount, dispatchIndex) => {
      expect(preparedCount - dispatchIndex).toBeLessThanOrEqual(2);
    });
    expect(prepareBatch).toHaveBeenCalledTimes(3);

    // Nothing the controller exposes after the run still carries an encoded
    // payload — dispatched batches are released, not accumulated.
    const state = suggestionDispatch.getState();
    expect(JSON.stringify(resolved)).not.toContain('payload-');
    expect(JSON.stringify(state.partialResults)).not.toContain('payload-');
    expect(JSON.stringify(state.progress)).not.toContain('payload-');
  });

  it('sends each batch ONLY its own prepared payload', async () => {
    const clusters = buildClustersForBatches(2);
    const prepareBatch = jest.fn(async (batch: PlaceSuggestionCluster[]) =>
      batch.map((c) => ({ ...c, vision_images_base64: [`image-${c.id}`] }))
    );
    mockedApi.post.mockResolvedValue(emptyResponse);

    await suggestionDispatch.dispatch({ clusters, prepareBatch });

    const batches = planSuggestionBatches(clusters);
    mockedApi.post.mock.calls.forEach((call, i) => {
      const body = call[1] as { clusters: { id: string; vision_images_base64: string[] }[] };
      expect(body.clusters.map((c) => c.id)).toEqual(batches[i].map((c) => c.id));
      expect(body.clusters.map((c) => c.vision_images_base64[0])).toEqual(
        batches[i].map((c) => `image-${c.id}`)
      );
    });
  });

  it('dispatches the batch anyway when its preparation fails', async () => {
    const clusters = buildClustersForBatches(2);
    const prepareBatch = jest.fn(async (batch: PlaceSuggestionCluster[]) => {
      if (prepareBatch.mock.calls.length === 1) {
        throw new Error('image decode failed');
      }
      return batch;
    });
    mockedApi.post.mockResolvedValue(emptyResponse);

    // The pipeline does not reject, and the un-prepared batch still goes out
    // (without vision images) rather than being dropped.
    await expect(suggestionDispatch.dispatch({ clusters, prepareBatch })).resolves.toBeDefined();

    expect(mockedApi.post).toHaveBeenCalledTimes(2);
    const firstBody = mockedApi.post.mock.calls[0][1] as { clusters: { id: string }[] };
    expect(firstBody.clusters.map((c) => c.id)).toEqual(
      planSuggestionBatches(clusters)[0].map((c) => c.id)
    );
    expect(suggestionDispatch.getState().failedClusterIds.size).toBe(0);
  });

  it('U15: stamps firstSuggestionAt on the first batch that CARRIES a suggestion', async () => {
    const clusters = buildClustersForBatches(2);
    mockedApi.post
      // An empty batch paints nothing, so it must not stamp the signal.
      .mockResolvedValueOnce(emptyResponse)
      .mockResolvedValueOnce({
        data: { suggestions: suggestionsFor(chunkIds(clusters, 1)), failed_cluster_count: 0 },
      });

    const before = Date.now();
    const result = await suggestionDispatch.dispatch({ clusters });

    expect(result.firstSuggestionAt).not.toBeNull();
    expect(result.firstSuggestionAt!).toBeGreaterThanOrEqual(before);
  });

  it('U15: leaves firstSuggestionAt null when no batch carries a suggestion', async () => {
    mockedApi.post.mockResolvedValue(emptyResponse);

    const result = await suggestionDispatch.dispatch({ clusters: buildClusters(1) });

    expect(result.firstSuggestionAt).toBeNull();
  });
});

// ===========================================================================
// U14: the dispatch seam itself
// ===========================================================================

describe('suggestionDispatch - cluster sets (KTD7)', () => {
  it('enqueues EVERY accepted cluster while only the live batch is in flight', async () => {
    const clusters = buildClustersForBatches(3);
    const observed: { enqueued: number; inFlight: string[] }[] = [];

    mockedApi.post.mockImplementation(async () => {
      const state = suggestionDispatch.getState();
      observed.push({
        enqueued: state.enqueuedClusterIds.size,
        inFlight: [...state.inFlightClusterIds],
      });
      return emptyResponse;
    });

    await suggestionDispatch.dispatch({ clusters });

    const batches = planSuggestionBatches(clusters);
    expect(observed).toHaveLength(batches.length);
    observed.forEach((snapshot, i) => {
      // R10: every cluster is a pending row from the first request onward —
      // NOT only the ~2 clusters in the opening batch.
      expect(snapshot.enqueued).toBe(clusters.length);
      // ...while the in-flight set is exactly the batch on the wire.
      expect(snapshot.inFlight.sort()).toEqual(batches[i].map((c) => c.id).sort());
    });

    // Once the run settles nothing is in flight, but the enqueued set is kept:
    // it is what the pending-row projection subtracts resolved clusters from.
    const finalState = suggestionDispatch.getState();
    expect(finalState.inFlightClusterIds.size).toBe(0);
    expect(finalState.enqueuedClusterIds.size).toBe(clusters.length);
  });

  it('keeps a never-dispatched cluster out of the dispatched-and-resolved set (R20)', async () => {
    const clusters = buildClustersForBatches(3);
    mockedApi.post
      .mockResolvedValueOnce(emptyResponse)
      // Fatal on batch 2 — batch 3 never goes out at all.
      .mockRejectedValueOnce(makeQuotaError());

    await expect(suggestionDispatch.dispatch({ clusters })).rejects.toThrow();

    const resolved = suggestionDispatch.getState().dispatchedAndResolvedClusterIds;
    for (const id of chunkIds(clusters, 0)) expect(resolved.has(id)).toBe(true);
    // Batch 2 threw and batch 3 never dispatched: neither has positive evidence
    // that a response for it arrived, so neither may be cached.
    for (const id of [...chunkIds(clusters, 1), ...chunkIds(clusters, 2)]) {
      expect(resolved.has(id)).toBe(false);
    }
  });

  it('reports dispatched-and-resolved on the resolved result as well as in state', async () => {
    const clusters = buildClustersForBatches(2);
    mockedApi.post
      .mockResolvedValueOnce(emptyResponse)
      .mockRejectedValueOnce(new Error('network blip'));

    const result = await suggestionDispatch.dispatch({ clusters });

    expect([...result.dispatchedAndResolvedIds].sort()).toEqual([...chunkIds(clusters, 0)].sort());
  });

  it('claim() refuses a cluster another path already has in flight', async () => {
    const clusters = buildClustersForBatches(2);
    const firstBatchIds = chunkIds(clusters, 0);
    const gate = deferred<unknown>();
    let claimedDuringFlight: string[] = [];

    mockedApi.post.mockImplementationOnce(() => {
      // Attempt a scoped claim while batch 1 is on the wire.
      claimedDuringFlight = suggestionDispatch.claim([...firstBatchIds, 'unrelated-cluster']);
      return gate.promise as Promise<never>;
    });
    mockedApi.post.mockResolvedValue(emptyResponse);

    const run = suggestionDispatch.dispatch({ clusters });
    // Let the loop reach the first post.
    await Promise.resolve();
    await Promise.resolve();
    gate.resolve(emptyResponse);
    await run;

    // Only the cluster the main dispatch did NOT hold could be claimed.
    expect(claimedDuringFlight).toEqual(['unrelated-cluster']);
    suggestionDispatch.releaseClaim(claimedDuringFlight);
  });

  it('claim() adds to BOTH sets and releaseClaim() only clears the in-flight one', () => {
    expect(suggestionDispatch.claim(['a', 'b'])).toEqual(['a', 'b']);
    expect([...suggestionDispatch.getState().inFlightClusterIds]).toEqual(['a', 'b']);
    expect([...suggestionDispatch.getState().enqueuedClusterIds]).toEqual(['a', 'b']);

    // A second claim for the same ids is refused — this is the retry/split
    // double-fire guard.
    expect(suggestionDispatch.claim(['a'])).toEqual([]);

    suggestionDispatch.releaseClaim(['a', 'b']);
    expect(suggestionDispatch.getState().inFlightClusterIds.size).toBe(0);
    // The clusters remain enqueued: they are still locations the user is
    // waiting on until something resolves them.
    expect([...suggestionDispatch.getState().enqueuedClusterIds]).toEqual(['a', 'b']);
  });
});

describe('suggestionDispatch - scoped batch dispatch', () => {
  it('partitions the response into responded and unresolved ids', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { suggestions: suggestionsFor(['s-1']), failed_cluster_count: 1 },
    });

    const outcome = await suggestionDispatch.dispatchBatch({
      clusterIds: ['s-1', 's-2'],
      prepare: async () => [
        { id: 's-1', centroid: { latitude: 1, longitude: 2 }, photos: [] },
        { id: 's-2', centroid: { latitude: 1, longitude: 2 }, photos: [] },
      ],
    });

    expect([...outcome.respondedIds]).toEqual(['s-1']);
    expect(outcome.unresolvedIds).toEqual(['s-2']);
    expect(outcome.response.failed_cluster_count).toBe(1);
    // Both got a response covering them, so both carry positive evidence.
    const resolved = suggestionDispatch.getState().dispatchedAndResolvedClusterIds;
    expect(resolved.has('s-1')).toBe(true);
    expect(resolved.has('s-2')).toBe(true);
  });

  it('marks nothing resolved when the scoped request throws', async () => {
    mockedApi.post.mockRejectedValueOnce(new Error('network blip'));

    await expect(
      suggestionDispatch.dispatchBatch({
        clusterIds: ['s-3'],
        prepare: async () => [{ id: 's-3', centroid: { latitude: 1, longitude: 2 }, photos: [] }],
      })
    ).rejects.toThrow('network blip');

    expect(suggestionDispatch.getState().dispatchedAndResolvedClusterIds.has('s-3')).toBe(false);
  });
});

describe('suggestionDispatch - owner accounting and lifetime', () => {
  it('counts overlapping owners and clamps a stray release', () => {
    expect(suggestionDispatch.getState().ownerCount).toBe(0);
    suggestionDispatch.beginOwner();
    suggestionDispatch.beginOwner();
    expect(suggestionDispatch.getState().ownerCount).toBe(2);
    suggestionDispatch.endOwner();
    expect(suggestionDispatch.getState().ownerCount).toBe(1);
    suggestionDispatch.endOwner();
    suggestionDispatch.endOwner();
    expect(suggestionDispatch.getState().ownerCount).toBe(0);
  });

  it('reset() does NOT zero the owner count', () => {
    // A parked owner still holds its slot across a reset. Zeroing it here would
    // report "settled" and fire the reconciliation sweep against its clusters.
    suggestionDispatch.beginOwner();
    suggestionDispatch.reset();
    expect(suggestionDispatch.getState().ownerCount).toBe(1);
    suggestionDispatch.endOwner();
  });

  it('survives every subscriber unsubscribing and re-subscribing (navigation)', async () => {
    const clusters = buildClustersForBatches(2);
    mockedApi.post
      .mockResolvedValueOnce({
        data: { suggestions: suggestionsFor(chunkIds(clusters, 0)), failed_cluster_count: 0 },
      })
      .mockRejectedValueOnce(new Error('network blip'));

    const unsubscribe = suggestionDispatch.subscribe(() => undefined);
    await suggestionDispatch.dispatch({ clusters });

    const before = suggestionDispatch.getState();
    // The screen unmounts (navigate away) and later remounts (navigate back).
    unsubscribe();
    const unsubscribe2 = suggestionDispatch.subscribe(() => undefined);

    const after = suggestionDispatch.getState();
    expect(after).toBe(before);
    expect([...after.failedClusterIds.keys()].sort()).toEqual([...chunkIds(clusters, 1)].sort());
    expect(after.enqueuedClusterIds.size).toBe(clusters.length);
    expect(after.partialResults.map((s) => s.cluster_id)).toEqual(chunkIds(clusters, 0));
    unsubscribe2();
  });

  it('notifies subscribers on every state change', async () => {
    const listener = jest.fn();
    const unsubscribe = suggestionDispatch.subscribe(listener);

    mockedApi.post.mockResolvedValue(emptyResponse);
    await suggestionDispatch.dispatch({ clusters: buildClusters(1) });

    expect(listener).toHaveBeenCalled();
    unsubscribe();

    listener.mockClear();
    suggestionDispatch.beginOwner();
    expect(listener).not.toHaveBeenCalled();
    suggestionDispatch.endOwner();
  });
});
