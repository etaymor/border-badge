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
  deriveDispatchConcurrency,
  CHUNK_SIZE,
  FIRST_CHUNK_SIZE,
  MAX_SUGGESTION_DISPATCH_CONCURRENCY,
  SUGGEST_PLACES_TIMEOUT_MS,
  SUGGESTION_DISPATCH_CONCURRENCY,
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

/** Let queued microtasks and the macrotask queue drain (no fake timers here). */
const flush = async (turns = 4) => {
  for (let i = 0; i < turns; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

/** Index of the planned batch a recorded request body belongs to. */
const batchIndexOfRequest = (batches: { id: string }[][], body: unknown) => {
  const ids = (body as { clusters: { id: string }[] }).clusters.map((c) => c.id);
  return batches.findIndex((batch) => batch[0].id === ids[0]);
};

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

  it('records the rejected chunk with retryDisabled=true when it throws 503 (quota)', async () => {
    const clusters = buildClustersForBatches(2);
    const chunk1Ids = chunkIds(clusters, 0);
    const chunk2Ids = chunkIds(clusters, 1);

    mockedApi.post
      .mockResolvedValueOnce({
        data: { suggestions: suggestionsFor(chunk1Ids), failed_cluster_count: 0 },
      })
      .mockRejectedValueOnce(makeQuotaError());

    // KTD6: a fatal rejection resolves PARTIALLY instead of throwing, so the
    // batches that already succeeded keep their suggestions.
    const result = await suggestionDispatch.dispatch({ clusters });
    expect(result.fatalError).toMatchObject({ name: 'QuotaExhaustedError' });
    expect(result.suggestions.map((s) => s.cluster_id).sort()).toEqual([...chunk1Ids].sort());

    // The rejected batch's clusters are NOT dropped.
    const failed = suggestionDispatch.getState().failedClusterIds;
    expect([...failed.keys()].sort()).toEqual([...chunk2Ids].sort());
    for (const id of chunk2Ids) {
      expect(failed.get(id)).toEqual({ retryDisabled: true });
    }
  });

  it('records the rejected chunk with retryDisabled=true when it throws 429 (rate limit)', async () => {
    const clusters = buildClustersForBatches(2);
    const chunk1Ids = chunkIds(clusters, 0);
    const chunk2Ids = chunkIds(clusters, 1);

    mockedApi.post
      .mockResolvedValueOnce({
        data: { suggestions: suggestionsFor(chunk1Ids), failed_cluster_count: 0 },
      })
      .mockRejectedValueOnce(makeAxiosError(429, { 'retry-after': '30' }));

    const result = await suggestionDispatch.dispatch({ clusters });
    expect(result.fatalError).toMatchObject({ name: 'RateLimitError', retryAfterSeconds: 30 });
    expect(result.suggestions.map((s) => s.cluster_id).sort()).toEqual([...chunk1Ids].sort());

    const failed = suggestionDispatch.getState().failedClusterIds;
    expect([...failed.keys()].sort()).toEqual([...chunk2Ids].sort());
    for (const id of chunk2Ids) {
      expect(failed.get(id)).toEqual({ retryDisabled: true });
    }
  });

  it('honors a SHORT Retry-After on a 429 rather than assuming a minute (U16)', async () => {
    // The burst cap answers with 1s and the sustained limiter with 60s. Reading
    // the header is the difference between resuming in a second and telling the
    // user to wait a minute.
    mockedApi.post.mockRejectedValueOnce(makeAxiosError(429, { 'retry-after': '1' }));

    const result = await suggestionDispatch.dispatch({ clusters: buildClusters(1) });

    expect(result.fatalError).toMatchObject({ name: 'RateLimitError', retryAfterSeconds: 1 });
  });

  it('KTD6: attributes ONLY the rejected chunk, leaving never-dispatched ones unattributed', async () => {
    // The old behavior marked "this chunk plus every later chunk" using the loop
    // index as a dispatch frontier — an idea concurrency destroys. A cluster that
    // never went out has NOT had its lookup fail; it is left unattributed so the
    // consumer's settle sweep renders it lookup-failed with retry ENABLED (R2),
    // rather than inheriting the rate limit's retry-DISABLED state.
    const clusters = buildClustersForBatches(3); // exactly three batches
    const chunk2Ids = chunkIds(clusters, 1);
    const chunk3Ids = chunkIds(clusters, 2);

    mockedApi.post
      .mockResolvedValueOnce({
        data: { suggestions: suggestionsFor(chunkIds(clusters, 0)), failed_cluster_count: 0 },
      })
      // chunk-2 throws fatal — chunk-3 never runs
      .mockRejectedValueOnce(makeQuotaError());

    const result = await suggestionDispatch.dispatch({ clusters });

    const failed = suggestionDispatch.getState().failedClusterIds;
    expect([...failed.keys()].sort()).toEqual([...chunk2Ids].sort());
    for (const id of chunk3Ids) expect(failed.has(id)).toBe(false);

    // Chunk 3 was never dispatched, so it is outside the coverage set and the
    // result reports itself as partial.
    expect(result.isPartial).toBe(true);
    for (const id of chunk3Ids) expect(result.dispatchedClusterIds.has(id)).toBe(false);
    expect(mockedApi.post).toHaveBeenCalledTimes(2);
  });

  it('stops dispatching new batches after a fatal rejection', async () => {
    const clusters = buildClustersForBatches(4);

    mockedApi.post
      .mockResolvedValueOnce({
        data: { suggestions: suggestionsFor(chunkIds(clusters, 0)), failed_cluster_count: 0 },
      })
      .mockRejectedValueOnce(makeAxiosError(429, { 'retry-after': '60' }))
      .mockResolvedValue(emptyResponse);

    await suggestionDispatch.dispatch({ clusters });

    // Batches 3 and 4 never leave, even though the mock would have answered them.
    expect(mockedApi.post).toHaveBeenCalledTimes(2);
  });

  it('treats a 402 entitlement refusal as fatal-but-not-transient (U16)', async () => {
    const err = makeAxiosError(402);
    // @ts-expect-error - minimal AxiosError response shape for the test
    err.response.data = { code: 'PHOTO_IMPORT_LIMIT_REACHED' };
    mockedApi.post.mockRejectedValueOnce(err);

    const clusters = buildClustersForBatches(2);
    const result = await suggestionDispatch.dispatch({ clusters });

    expect(result.fatalError).toMatchObject({ name: 'PhotoImportLimitReachedError' });
    // Retrying an entitlement refusal cannot succeed, so no Retry affordance.
    for (const id of chunkIds(clusters, 0)) {
      expect(suggestionDispatch.getState().failedClusterIds.get(id)).toEqual({
        retryDisabled: true,
      });
    }
    expect(mockedApi.post).toHaveBeenCalledTimes(1);
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

    // KTD6: resolves partially rather than throwing; the allow-list is what
    // keeps the undispatched batch out of the cache.
    await suggestionDispatch.dispatch({ clusters });

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

// ===========================================================================
// U6: bounded worker pool, abort, and honest failure attribution
// ===========================================================================

describe('suggestionDispatch - concurrency configuration (U6/R6)', () => {
  it('ships the client concurrency default at 1 (sequential) pending on-device measurement', () => {
    // The pool is fully implemented and demonstrably works at 3 (below), but the
    // exit criterion for raising it — concurrency's OWN contribution measured
    // against the preparation-pipelining measurement point on a real device —
    // has not been met. The code ships either way; the default is the lever, and
    // it is a plain module constant so it moves over the air.
    expect(SUGGESTION_DISPATCH_CONCURRENCY).toBe(1);
  });

  it('derives the pool size from the preparation/network knee rather than a guess', () => {
    // Steady-state per-batch time is max(prepareMs, networkMs / C), so the knee
    // is ceil(networkMs / prepareMs) — past it the pipeline is preparation-bound
    // and extra workers buy nothing.
    expect(deriveDispatchConcurrency(1000, 3000)).toBe(3);
    expect(deriveDispatchConcurrency(1000, 2500)).toBe(3);
    expect(deriveDispatchConcurrency(1000, 1000)).toBe(1);
    // Preparation slower than the network: one worker already saturates it.
    expect(deriveDispatchConcurrency(4000, 1000)).toBe(1);
    // Never above the burst-cap ceiling, whatever the ratio says.
    expect(deriveDispatchConcurrency(10, 100000)).toBe(MAX_SUGGESTION_DISPATCH_CONCURRENCY);
    // Unmeasured inputs fall back to sequential rather than to a guess.
    expect(deriveDispatchConcurrency(0, 3000)).toBe(1);
  });

  it('dispatches strictly one batch at a time at the shipped default', async () => {
    const clusters = buildClustersForBatches(3);
    let inFlight = 0;
    let peakInFlight = 0;

    mockedApi.post.mockImplementation(async () => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return emptyResponse;
    });

    await suggestionDispatch.dispatch({ clusters });

    expect(peakInFlight).toBe(1);
    expect(mockedApi.post).toHaveBeenCalledTimes(3);
  });
});

describe('suggestionDispatch - bounded worker pool (U6/R6)', () => {
  it('R6: keeps three batches genuinely in flight at once and collects every result', async () => {
    const clusters = buildClustersForBatches(3);
    const batches = planSuggestionBatches(clusters);
    const gates = batches.map(() => deferred<void>());
    let inFlight = 0;
    let peakInFlight = 0;

    mockedApi.post.mockImplementation(async (_url, body) => {
      const index = batchIndexOfRequest(batches, body);
      const ids = batches[index].map((c) => c.id);
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await gates[index].promise;
      inFlight -= 1;
      return { data: { suggestions: suggestionsFor(ids), failed_cluster_count: 0 } };
    });

    const run = suggestionDispatch.dispatch({ clusters, concurrency: 3 });
    await flush();

    // All three requests are outstanding simultaneously — none of them has been
    // allowed to resolve yet.
    expect(mockedApi.post).toHaveBeenCalledTimes(3);
    expect(peakInFlight).toBe(3);

    // Land them OUT OF ORDER: nothing may depend on plan order.
    gates[2].resolve();
    await flush();
    gates[0].resolve();
    await flush();
    gates[1].resolve();

    const result = await run;

    expect(result.suggestions.map((s) => s.cluster_id).sort()).toEqual(
      clusters.map((c) => c.id).sort()
    );
    expect(result.fatalError).toBeNull();
    expect(result.isPartial).toBe(false);
    expect([...result.dispatchedAndResolvedIds].sort()).toEqual(clusters.map((c) => c.id).sort());
    expect(suggestionDispatch.getState().inFlightClusterIds.size).toBe(0);
  });

  it('never lets the completion counter decrease within a dispatch generation', async () => {
    const clusters = buildClustersForBatches(3);
    const batches = planSuggestionBatches(clusters);
    const gates = batches.map(() => deferred<void>());

    mockedApi.post.mockImplementation(async (_url, body) => {
      const index = batchIndexOfRequest(batches, body);
      await gates[index].promise;
      return { data: { suggestions: suggestionsFor(batches[index].map((c) => c.id)) } };
    });

    const observed: number[] = [];
    const unsubscribe = suggestionDispatch.subscribe(() => {
      const progress = suggestionDispatch.getState().progress;
      if (progress) observed.push(progress.clustersCompleted);
    });

    const generationBefore = suggestionDispatch.getState().dispatchGeneration;
    const run = suggestionDispatch.dispatch({ clusters, concurrency: 3 });
    await flush();

    // Resolve LAST batch first: the old accounting published "clusters in the
    // batches preceding the loop index", so a late batch landing first would
    // publish a high count and the next one to land would pull it back down.
    gates[2].resolve();
    await flush();
    gates[1].resolve();
    await flush();
    gates[0].resolve();
    await run;
    unsubscribe();

    expect(observed.length).toBeGreaterThan(2);
    for (let i = 1; i < observed.length; i++) {
      expect(observed[i]).toBeGreaterThanOrEqual(observed[i - 1]);
    }
    expect(observed.at(-1)).toBe(clusters.length);
    expect(suggestionDispatch.getState().progress?.percentage).toBe(100);
    // A retry or a re-entry is a NEW generation with its own denominator rather
    // than a rewind of this one.
    expect(suggestionDispatch.getState().dispatchGeneration).toBe(generationBefore + 1);
  });

  it('after a rate-limit rejection dispatches nothing new, and in-flight batches still land', async () => {
    const clusters = buildClustersForBatches(4);
    const batches = planSuggestionBatches(clusters);
    const gates = batches.map(() => deferred<void>());

    mockedApi.post.mockImplementation(async (_url, body) => {
      const index = batchIndexOfRequest(batches, body);
      await gates[index].promise;
      if (index === 1) throw makeAxiosError(429, { 'retry-after': '1' });
      return { data: { suggestions: suggestionsFor(batches[index].map((c) => c.id)) } };
    });

    const run = suggestionDispatch.dispatch({ clusters, concurrency: 3 });
    await flush();

    // Batches 1-3 are on the wire; batch 4 is queued behind them.
    expect(mockedApi.post).toHaveBeenCalledTimes(3);

    // Batch 2 is rate limited FIRST, while 1 and 3 are still outstanding.
    gates[1].resolve();
    await flush();
    gates[0].resolve();
    gates[2].resolve();

    const result = await run;

    // No fourth request: the stop took effect, and the in-flight pair still
    // contributed their results.
    expect(mockedApi.post).toHaveBeenCalledTimes(3);
    expect(result.fatalError).toMatchObject({ name: 'RateLimitError', retryAfterSeconds: 1 });
    expect(result.suggestions.map((s) => s.cluster_id).sort()).toEqual(
      [...batches[0], ...batches[2]].map((c) => c.id).sort()
    );

    // Only the rejected batch is retry-disabled; the batch that never went out
    // is left for the settle sweep, and the succeeded ones are untouched.
    const failed = suggestionDispatch.getState().failedClusterIds;
    expect([...failed.keys()].sort()).toEqual(batches[1].map((c) => c.id).sort());
    for (const cluster of batches[3]) expect(failed.has(cluster.id)).toBe(false);
    expect(result.isPartial).toBe(true);
    for (const cluster of batches[3]) {
      expect(result.dispatchedClusterIds.has(cluster.id)).toBe(false);
      expect(result.dispatchedAndResolvedIds.has(cluster.id)).toBe(false);
    }
  });

  it('a non-fatal batch error marks only that batch, retry enabled, and the pool keeps going', async () => {
    const clusters = buildClustersForBatches(3);
    const batches = planSuggestionBatches(clusters);

    mockedApi.post.mockImplementation(async (_url, body) => {
      const index = batchIndexOfRequest(batches, body);
      if (index === 1) throw new Error('network blip');
      return { data: { suggestions: suggestionsFor(batches[index].map((c) => c.id)) } };
    });

    const result = await suggestionDispatch.dispatch({ clusters, concurrency: 3 });

    expect(mockedApi.post).toHaveBeenCalledTimes(3);
    expect(result.fatalError).toBeNull();
    const failed = suggestionDispatch.getState().failedClusterIds;
    expect([...failed.keys()].sort()).toEqual(batches[1].map((c) => c.id).sort());
    for (const id of [...failed.keys()]) expect(failed.get(id)).toEqual({ retryDisabled: false });
    // Every batch was attempted, so nothing is uncovered.
    expect(result.isPartial).toBe(false);
  });

  it('prepares at most concurrency+1 batches ahead of dispatch', async () => {
    // The prefetch bound is what caps peak encoded-payload memory, and it grows
    // linearly with the pool. At the shipped concurrency of 1 this is the old
    // "one batch ahead" exactly (asserted by the U5 suite above); this pins the
    // general rule so raising the pool is a deliberate memory decision.
    const clusters = buildClustersForBatches(5);
    const preparedAtEachPost: number[] = [];
    const prepareBatch = jest.fn(async (batch: PlaceSuggestionCluster[]) => batch);

    mockedApi.post.mockImplementation(async () => {
      preparedAtEachPost.push(prepareBatch.mock.calls.length);
      return emptyResponse;
    });

    await suggestionDispatch.dispatch({ clusters, prepareBatch, concurrency: 3 });

    preparedAtEachPost.forEach((preparedCount, dispatchIndex) => {
      expect(preparedCount - dispatchIndex).toBeLessThanOrEqual(4);
    });
    expect(prepareBatch).toHaveBeenCalledTimes(5);
  });
});

describe('suggestionDispatch - abort (U6)', () => {
  /** Model axios: a request rejects as soon as its signal aborts. */
  const abortableApi = (onRequest?: (signal: AbortSignal) => void) =>
    mockedApi.post.mockImplementation(
      (_url, _body, config) =>
        new Promise((_resolve, reject) => {
          const signal = (config as { signal?: AbortSignal } | undefined)?.signal;
          onRequest?.(signal as AbortSignal);
          signal?.addEventListener('abort', () => reject(new Error('canceled')));
        }) as never
    );

  it('cancels in-flight requests instead of waiting for them', async () => {
    const clusters = buildClustersForBatches(3);
    const signals: AbortSignal[] = [];
    abortableApi((signal) => signals.push(signal));

    const run = suggestionDispatch.dispatch({ clusters, concurrency: 3 });
    await flush();

    expect(signals).toHaveLength(3);
    expect(signals.every((s) => !s.aborted)).toBe(true);

    suggestionDispatch.reset();

    // Resolves because the requests were CANCELED — nothing ever answers them.
    const result = await run;

    expect(signals.every((s) => s.aborted)).toBe(true);
    expect(result.dispatchedAndResolvedIds.size).toBe(0);
    // An abort attributes no failures: `reset()` cleared the candidate's state
    // and re-writing it would resurrect a departed candidate's rows.
    expect(suggestionDispatch.getState().failedClusterIds.size).toBe(0);
  });

  it('leaves batches that never went out un-dispatched after an abort', async () => {
    const clusters = buildClustersForBatches(4);
    abortableApi();

    // Sequential (the shipped default): only the first batch is on the wire.
    const run = suggestionDispatch.dispatch({ clusters });
    await flush();
    suggestionDispatch.reset();
    const result = await run;

    expect(mockedApi.post).toHaveBeenCalledTimes(1);
    expect(result.isPartial).toBe(true);
    expect(result.dispatchedAndResolvedIds.size).toBe(0);
    const batches = planSuggestionBatches(clusters);
    for (const cluster of [...batches[1], ...batches[2], ...batches[3]]) {
      expect(result.dispatchedClusterIds.has(cluster.id)).toBe(false);
    }
  });
});
