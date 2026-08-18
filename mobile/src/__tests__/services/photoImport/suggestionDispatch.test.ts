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
  MAX_PARKABLE_RETRY_AFTER_SECONDS,
  MAX_RATE_LIMIT_PARKS,
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

    const result = await suggestionDispatch.dispatch({ clusters, concurrency: 1, concurrency: 1 });

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

    await suggestionDispatch.dispatch({ clusters, concurrency: 1, concurrency: 1 });

    // Batches 3 and 4 never leave, even though the mock would have answered them.
    expect(mockedApi.post).toHaveBeenCalledTimes(2);
  });

  it('treats a 402 entitlement refusal as fatal-but-not-transient (U16)', async () => {
    const err = makeAxiosError(402);
    // THE REAL WIRE SHAPE. The backend raises
    // `HTTPException(402, detail={"code": "PHOTO_IMPORT_LIMIT_REACHED"})` and
    // FastAPI's default handler nests a dict detail under `detail` — the
    // backend's own test asserts `response.json()["detail"]["code"]`. The
    // hand-built flat `{ code }` fixture this used to carry kept the client's
    // branch green while it could never match in production.
    // @ts-expect-error - minimal AxiosError response shape for the test
    err.response.data = { detail: { code: 'PHOTO_IMPORT_LIMIT_REACHED' } };
    mockedApi.post.mockRejectedValueOnce(err);

    const clusters = buildClustersForBatches(2);
    const result = await suggestionDispatch.dispatch({ clusters, concurrency: 1, concurrency: 1 });

    expect(result.fatalError).toMatchObject({ name: 'PhotoImportLimitReachedError' });
    // Retrying an entitlement refusal cannot succeed, so no Retry affordance.
    for (const id of chunkIds(clusters, 0)) {
      expect(suggestionDispatch.getState().failedClusterIds.get(id)).toEqual({
        retryDisabled: true,
      });
    }
    expect(mockedApi.post).toHaveBeenCalledTimes(1);
  });

  it('also accepts a 402 whose code was hoisted to the top level (U16)', async () => {
    // Defensive on purpose: an app-level exception handler, or a proxy that
    // rewrites error bodies, can hoist the code out of `detail`. Being wrong
    // here costs a paid request that can never succeed, so both shapes match.
    const err = makeAxiosError(402);
    // @ts-expect-error - minimal AxiosError response shape for the test
    err.response.data = { code: 'PHOTO_IMPORT_LIMIT_REACHED' };
    mockedApi.post.mockRejectedValueOnce(err);

    const result = await suggestionDispatch.dispatch({ clusters: buildClustersForBatches(2) });

    expect(result.fatalError).toMatchObject({ name: 'PhotoImportLimitReachedError' });
  });

  it('does not read a 402 with an unrelated detail as the entitlement stop', async () => {
    // FastAPI's `detail` is a STRING for most raises. Reading it blindly must
    // not misclassify an ordinary payment error as the import limit.
    const err = makeAxiosError(402);
    // @ts-expect-error - minimal AxiosError response shape for the test
    err.response.data = { detail: 'Payment required' };
    mockedApi.post.mockRejectedValueOnce(err);

    const result = await suggestionDispatch.dispatch({ clusters: buildClusters(1) });

    expect(result.fatalError).toBeNull();
    expect([...suggestionDispatch.getState().failedClusterIds.values()]).toEqual([
      { retryDisabled: false },
    ]);
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

    await suggestionDispatch.dispatch({ clusters, concurrency: 1, concurrency: 1 });

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
    await suggestionDispatch.dispatch({ clusters, concurrency: 1, concurrency: 1 });

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
  it('ships the client concurrency default at 3 following the on-device measurement', () => {
    // Raised from 1 after the 2026-08-17 cold on-device run (250 uncached
    // clusters, 4.7% L2 hit rate): 107s wall clock, 5.0s to first suggestion,
    // 0 failed clusters, and every retry counter — rate-limited, circuit-open,
    // slot-unavailable — at zero. See docs/photo-match-measurement-runbook.md.
    //
    // Honest caveat, recorded here because this constant is the ship decision:
    // point B was never measured, so concurrency's OWN contribution is inferred
    // from the overlap ratio (153.8s of API time in 106.9s wall = 1.44x, about
    // 30.5%) rather than measured against the 30% criterion. It sits ON the
    // threshold. mean_in_flight_batches was only 1.45 against a peak of 3, so
    // the pool idles much of the time.
    //
    // Still a plain module constant: rolls back to 1 over the air with an EAS
    // update, no native build. Raise it in step with the backend's
    // VISION_MAX_CONCURRENT_REQUESTS (15) — the two are a paired flip.
    expect(SUGGESTION_DISPATCH_CONCURRENCY).toBe(3);
    expect(SUGGESTION_DISPATCH_CONCURRENCY).toBeLessThanOrEqual(
      MAX_SUGGESTION_DISPATCH_CONCURRENCY
    );
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

  it('never exceeds the shipped default in flight, and still dispatches every batch', async () => {
    // Was 'strictly one batch at a time' when the default was 1. The invariant
    // that actually matters is the bound, not the number: whatever the default
    // is, the pool must not exceed it and must still deliver every batch.
    const clusters = buildClustersForBatches(6);
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

    expect(peakInFlight).toBeLessThanOrEqual(SUGGESTION_DISPATCH_CONCURRENCY);
    expect(mockedApi.post).toHaveBeenCalledTimes(6);
  });

  it('dispatches strictly one batch at a time when explicitly sequential', async () => {
    // The sequential guarantee still has to hold on demand — it is the rollback
    // configuration, so it stays covered independently of the shipped default.
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

    await suggestionDispatch.dispatch({ clusters, concurrency: 1 });

    expect(peakInFlight).toBe(1);
    expect(mockedApi.post).toHaveBeenCalledTimes(3);
  });
});

// ===========================================================================
// Semantics AT the shipped concurrency (3), not just at 1.
//
// Raising SUGGESTION_DISPATCH_CONCURRENCY from 1 to 3 genuinely weakens the
// "stop immediately" guarantees: when a fatal response lands, the batches the
// pool already admitted are on the wire and cannot be recalled. The sequential
// versions of these tests (above, pinned with `concurrency: 1`) still assert
// the tight bound. These assert what actually holds at 3, so the difference is
// documented and cannot drift unnoticed.
// ===========================================================================

describe('suggestionDispatch - fatal handling at the shipped concurrency', () => {
  it('admits no NEW batches after a fatal rejection, bounded by what was in flight', async () => {
    const clusters = buildClustersForBatches(8);

    mockedApi.post
      .mockResolvedValueOnce({
        data: { suggestions: suggestionsFor(chunkIds(clusters, 0)), failed_cluster_count: 0 },
      })
      .mockRejectedValueOnce(makeAxiosError(429, { 'retry-after': '60' }))
      .mockResolvedValue(emptyResponse);

    await suggestionDispatch.dispatch({
      clusters,
      concurrency: SUGGESTION_DISPATCH_CONCURRENCY,
    });

    // The guarantee is a BOUND, not a number: nothing beyond the batches the
    // pool had already admitted when the fatal landed. At concurrency 1 that is
    // 2; at 3 it is at most 3. What must never happen is the whole plan going
    // out regardless of the fatal.
    expect(mockedApi.post.mock.calls.length).toBeLessThanOrEqual(SUGGESTION_DISPATCH_CONCURRENCY);
    expect(mockedApi.post.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mockedApi.post.mock.calls.length).toBeLessThan(8);
  });

  it('spends at most `concurrency` requests on a 402 before stopping (U16)', async () => {
    // Entitlement refusals are the case where an extra in-flight request is
    // most worth bounding. It costs no Google Places spend -- a 402 means the
    // backend refused BEFORE doing any work -- but it must not run the plan.
    const err = makeAxiosError(402);
    // @ts-expect-error - minimal AxiosError response shape for the test
    err.response.data = { detail: { code: 'PHOTO_IMPORT_LIMIT_REACHED' } };
    mockedApi.post.mockRejectedValue(err);

    const clusters = buildClustersForBatches(8);
    const result = await suggestionDispatch.dispatch({
      clusters,
      concurrency: SUGGESTION_DISPATCH_CONCURRENCY,
    });

    expect(result.fatalError).toMatchObject({ name: 'PhotoImportLimitReachedError' });
    expect(mockedApi.post.mock.calls.length).toBeLessThanOrEqual(SUGGESTION_DISPATCH_CONCURRENCY);
    // Still not retryable, however many were in flight when it landed.
    for (const id of chunkIds(clusters, 0)) {
      expect(suggestionDispatch.getState().failedClusterIds.get(id)).toEqual({
        retryDisabled: true,
      });
    }
  });

  it('attributes failure ONLY to clusters that were actually dispatched', async () => {
    // KTD6 at concurrency 3. More clusters are in flight than at 1, so more can
    // legitimately be attributed -- but never one the pool never sent. That is
    // the invariant the runbook's "no location shows failed while its lookup is
    // still running" check depends on.
    const clusters = buildClustersForBatches(8);
    mockedApi.post.mockRejectedValue(makeQuotaError());

    const result = await suggestionDispatch.dispatch({
      clusters,
      concurrency: SUGGESTION_DISPATCH_CONCURRENCY,
    });

    const failed = suggestionDispatch.getState().failedClusterIds;
    for (const id of failed.keys()) {
      expect(result.dispatchedClusterIds.has(id)).toBe(true);
    }
    expect(failed.size).toBeLessThanOrEqual(result.dispatchedClusterIds.size);
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
      // The SUSTAINED limit (60s), which is the one that genuinely stops
      // dispatch. A burst-cap 429 asks for a second and is parked through
      // instead — see the U16 park test below.
      if (index === 1) throw makeAxiosError(429, { 'retry-after': '60' });
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
    expect(result.fatalError).toMatchObject({ name: 'RateLimitError', retryAfterSeconds: 60 });
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
    const run = suggestionDispatch.dispatch({ clusters, concurrency: 1, concurrency: 1 });
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

describe('suggestionDispatch - lifecycle pause / resume (U9/R15)', () => {
  /**
   * A request that hangs until the test releases it, and rejects if its signal
   * aborts. The abort arm matters: without it a `reset()` in cleanup would leave
   * a worker awaiting a promise that never settles.
   */
  const controlledApi = () => {
    const release: Array<() => void> = [];
    mockedApi.post.mockImplementation(
      (_url, _body, config) =>
        new Promise((resolve, reject) => {
          const signal = (config as { signal?: AbortSignal } | undefined)?.signal;
          signal?.addEventListener('abort', () => reject(new Error('canceled')));
          release.push(() => resolve(emptyResponse));
        }) as never
    );
    return release;
  };

  // `jest.clearAllMocks()` keeps implementations, and a hanging one would make
  // the next suite's `mockResolvedValueOnce` chain fall through to a request
  // that never answers.
  afterEach(() => {
    mockedApi.post.mockReset();
  });

  it('stops handing out new batches while paused, and lets the one on the wire land', async () => {
    const clusters = buildClustersForBatches(4);
    const release = controlledApi();

    const run = suggestionDispatch.dispatch({ clusters, concurrency: 1, concurrency: 1 });
    await flush();
    expect(mockedApi.post).toHaveBeenCalledTimes(1);

    suggestionDispatch.pause();
    expect(suggestionDispatch.getState().isPaused).toBe(true);

    // The batch already on the wire is NOT cancelled — this is the whole
    // difference from reset(): its response still lands and still counts as
    // positive evidence for the cache-write allow-list.
    release[0]();
    await flush();

    expect(mockedApi.post).toHaveBeenCalledTimes(1);
    expect(suggestionDispatch.getState().dispatchedAndResolvedClusterIds.size).toBe(
      FIRST_CHUNK_SIZE
    );

    suggestionDispatch.resume();
    await flush();
    expect(suggestionDispatch.getState().isPaused).toBe(false);
    expect(mockedApi.post).toHaveBeenCalledTimes(2);

    suggestionDispatch.reset();
    await run;
  });

  it('treats paused as NOT settled: the dispatch stays open and keeps dispatching state', async () => {
    // The reconciliation sweep fires when every owner settles. If a paused
    // dispatch resolved, the sweep would run against clusters that were never
    // given a chance to go out and paint them all lookup-failed.
    const clusters = buildClustersForBatches(3);
    const release = controlledApi();

    let settled = false;
    const run = suggestionDispatch.dispatch({ clusters }).then((r) => {
      settled = true;
      return r;
    });
    await flush();

    suggestionDispatch.pause();
    release[0]();
    await flush(8);

    expect(settled).toBe(false);
    expect(suggestionDispatch.getState().isDispatching).toBe(true);

    suggestionDispatch.reset();
    await run;
  });

  it('resume wakes the pool, not the whole plan: at most `concurrency` batches go out at once', async () => {
    const clusters = buildClustersForBatches(10);
    const release = controlledApi();

    const run = suggestionDispatch.dispatch({ clusters, concurrency: 3 });
    await flush();
    expect(mockedApi.post).toHaveBeenCalledTimes(3);

    suggestionDispatch.pause();
    release[0]();
    release[1]();
    release[2]();
    await flush();
    expect(mockedApi.post).toHaveBeenCalledTimes(3);

    suggestionDispatch.resume();
    await flush();

    // Three more — the pool width — not the seven that remain.
    expect(mockedApi.post).toHaveBeenCalledTimes(6);

    suggestionDispatch.reset();
    await run;
  });

  it('does not prepare payloads it cannot send while paused', async () => {
    const clusters = buildClustersForBatches(5);
    const prepareBatch = jest.fn(async (batch: PlaceSuggestionCluster[]) => batch);
    const release = controlledApi();

    const run = suggestionDispatch.dispatch({ clusters, prepareBatch });
    await flush();
    const preparedBeforePause = prepareBatch.mock.calls.length;

    suggestionDispatch.pause();
    release[0]();
    await flush();

    expect(prepareBatch.mock.calls.length).toBe(preparedBeforePause);

    suggestionDispatch.resume();
    await flush();
    expect(prepareBatch.mock.calls.length).toBeGreaterThan(preparedBeforePause);

    suggestionDispatch.reset();
    await run;
  });

  it('reset() while paused wakes the parked workers so the dispatch settles', async () => {
    const clusters = buildClustersForBatches(4);
    const release = controlledApi();

    const run = suggestionDispatch.dispatch({ clusters });
    await flush();
    suggestionDispatch.pause();
    release[0]();
    await flush();

    suggestionDispatch.reset();
    const result = await run;

    expect(result.isPartial).toBe(true);
    // The pause flag SURVIVES the reset: the app is still backgrounded, so a
    // dispatch started after it must not start firing either.
    expect(suggestionDispatch.getState().isPaused).toBe(true);
  });

  it('resume is idempotent, so a foreground with no matching background costs nothing', () => {
    suggestionDispatch.resume();
    expect(suggestionDispatch.getState().isPaused).toBe(false);
  });
});

describe('suggestionDispatch - additive retry run (U9)', () => {
  it('keeps earlier results and the failures it is not retrying', async () => {
    const clusters = buildClustersForBatches(3);
    const batch1 = chunkIds(clusters, 0);
    const batch2 = chunkIds(clusters, 1);
    const batch3 = chunkIds(clusters, 2);

    mockedApi.post
      .mockResolvedValueOnce({
        data: { suggestions: suggestionsFor(batch1), failed_cluster_count: 0 },
      })
      // retry-ENABLED failure
      .mockRejectedValueOnce(new Error('network blip'))
      // retry-DISABLED failure (quota) — and it stops dispatch
      .mockRejectedValueOnce(makeQuotaError());

    await suggestionDispatch.dispatch({ clusters });

    expect(suggestionDispatch.getState().partialResults).toHaveLength(batch1.length);

    // Bulk retry of the retry-enabled batch only. It goes through the same batch
    // plan as any other dispatch (a small opening batch, then full-size ones),
    // so the mock answers whatever each request actually carries.
    const retryClusters = clusters.filter((c) => batch2.includes(c.id));
    mockedApi.post.mockImplementation(
      async (_url, body) =>
        ({
          data: {
            suggestions: suggestionsFor(
              (body as { clusters: { id: string }[] }).clusters.map((c) => c.id)
            ),
            failed_cluster_count: 0,
          },
        }) as never
    );

    const retryResult = await suggestionDispatch.dispatch({
      clusters: retryClusters,
      isRetry: true,
    });

    // The already-matched rows survived: a fresh run would have cleared them,
    // and they live nowhere else (the list reads data.suggestions once
    // dispatching stops).
    const retriedIds = retryResult.suggestions.map((s) => s.cluster_id).sort();
    expect(retriedIds).toEqual([...batch1, ...batch2].sort());

    const failed = suggestionDispatch.getState().failedClusterIds;
    // The retried batch is no longer failed...
    for (const id of batch2) expect(failed.has(id)).toBe(false);
    // ...and the quota-disabled batch it did NOT retry kept its entry, so it
    // does not degrade into a pending row that never resolves.
    for (const id of batch3) expect(failed.get(id)).toEqual({ retryDisabled: true });
  });

  it('starts its own progress denominator instead of rewinding the main run', async () => {
    const clusters = buildClustersForBatches(3);
    mockedApi.post.mockResolvedValue(emptyResponse);
    await suggestionDispatch.dispatch({ clusters });

    const generationAfterMain = suggestionDispatch.getState().dispatchGeneration;
    const retryClusters = clusters.slice(0, 2);
    await suggestionDispatch.dispatch({ clusters: retryClusters, isRetry: true });

    const state = suggestionDispatch.getState();
    expect(state.dispatchGeneration).toBe(generationAfterMain + 1);
    expect(state.progress?.clustersTotal).toBe(retryClusters.length);
  });
});

// ---- U11: concurrency telemetry --------------------------------------------

describe('suggestionDispatch - concurrency telemetry (U11/R18)', () => {
  it('records in-flight batch occupancy over TIME, not just the configured pool size', async () => {
    const clusters = buildClustersForBatches(3);
    const batches = planSuggestionBatches(clusters);
    const gates = batches.map(() => deferred<void>());

    // The mean is an integral over elapsed ms, so it is only exact if the
    // intervals are exact. Real sleeps make the two intervals incomparable
    // whenever one of them is dilated (CI load, a GC pause), which is the whole
    // flake. The clock is injected ONLY here — the rest of the photo-import
    // suite keeps real timers — and advances by explicit amounts.
    let clockMs = 1_000_000;
    suggestionDispatch.setTelemetryClockForTests(() => clockMs);

    mockedApi.post.mockImplementation(async (_url, body) => {
      const index = batchIndexOfRequest(batches, body);
      await gates[index].promise;
      return emptyResponse;
    });

    try {
      const run = suggestionDispatch.dispatch({ clusters, concurrency: 3 });
      await flush();

      // The wire is observable rather than re-derived by the caller.
      expect(suggestionDispatch.getInFlightBatchCount()).toBe(3);

      // Three batches for 30ms, then one for 30ms: a peak-only metric would call
      // this a full pool for the whole run.
      clockMs += 30;
      gates[0].resolve();
      gates[1].resolve();
      await flush();
      expect(suggestionDispatch.getInFlightBatchCount()).toBe(1);

      clockMs += 30;
      gates[2].resolve();
      await run;

      const telemetry = suggestionDispatch.getTelemetry();
      expect(telemetry.peakInFlightBatches).toBe(3);
      // 30ms at 3 batches + 30ms at 1 batch, all of it busy.
      expect(telemetry.wireSpanMs).toBe(60);
      expect(telemetry.wireBusyMs).toBe(60);
      // Time-weighted: (3 × 30 + 1 × 30) / 60 = 2, i.e. strictly between the two
      // occupancy levels it actually held rather than the peak of 3.
      expect(telemetry.meanInFlightBatches).toBe(2);
      expect(suggestionDispatch.getInFlightBatchCount()).toBe(0);
    } finally {
      suggestionDispatch.setTelemetryClockForTests(null);
    }
  });

  it('reports a peak of one at the shipped sequential default', async () => {
    mockedApi.post.mockResolvedValue(emptyResponse);
    await suggestionDispatch.dispatch({ clusters: buildClustersForBatches(3) });

    expect(suggestionDispatch.getTelemetry().peakInFlightBatches).toBe(
      SUGGESTION_DISPATCH_CONCURRENCY
    );
  });

  it('keys retry attempts by dispatch generation', async () => {
    mockedApi.post.mockResolvedValue(emptyResponse);
    const clusters = buildClustersForBatches(2);

    await suggestionDispatch.dispatch({ clusters });
    expect(suggestionDispatch.getTelemetry()).toMatchObject({
      retryAttempts: 0,
      retryGenerations: 0,
      maxRetryAttemptsPerGeneration: 0,
    });

    // A per-row retry repairs the generation it runs inside.
    await suggestionDispatch.dispatchBatch({
      clusterIds: [clusters[0].id],
      prepare: async () => [clusters[0]] as PlaceSuggestionCluster[],
      isRetry: true,
    });
    expect(suggestionDispatch.getTelemetry()).toMatchObject({
      retryAttempts: 1,
      retryGenerations: 1,
      maxRetryAttemptsPerGeneration: 1,
    });

    // A bulk retry bumps the generation, so its two batches land on their own
    // key — which is what separates "one bad generation" from steady retrying.
    await suggestionDispatch.dispatch({ clusters, isRetry: true });
    expect(suggestionDispatch.getTelemetry()).toMatchObject({
      retryAttempts: 3,
      retryGenerations: 2,
      maxRetryAttemptsPerGeneration: 2,
    });
  });

  it('opens a fresh window for a new main dispatch but survives reset()', async () => {
    mockedApi.post.mockResolvedValue(emptyResponse);
    const clusters = buildClustersForBatches(2);

    await suggestionDispatch.dispatch({ clusters });
    await suggestionDispatch.dispatch({ clusters, isRetry: true });
    expect(suggestionDispatch.getTelemetry().retryAttempts).toBe(2);

    // `reset()` runs on the very navigation the exit event is emitted from, so
    // the measurement has to outlive it.
    suggestionDispatch.reset();
    expect(suggestionDispatch.getTelemetry().retryAttempts).toBe(2);

    await suggestionDispatch.dispatch({ clusters });
    expect(suggestionDispatch.getTelemetry()).toMatchObject({
      retryAttempts: 0,
      retryGenerations: 0,
    });
  });
});

// ---- The pool honors its own claim (KTD7) ----------------------------------

describe('suggestionDispatch - the pool honors its claim (KTD7)', () => {
  it('posts only the claimed subset and skips a batch another path already holds', async () => {
    const clusters = buildClustersForBatches(2);
    const batches = planSuggestionBatches(clusters);
    // Another path — a manual split, a per-row retry, or an overlapping
    // dispatch — already has the whole first batch and one cluster of the
    // second on the wire.
    const heldElsewhere = [...batches[0].map((c) => c.id), batches[1][0].id];
    expect(suggestionDispatch.claim(heldElsewhere)).toEqual(heldElsewhere);

    mockedApi.post.mockResolvedValue(emptyResponse);
    const result = await suggestionDispatch.dispatch({ clusters });

    // The fully-spoken-for batch produces NO request at all: re-posting it
    // would re-buy every one of its clusters from Google Places and from
    // vision. The scoped paths have bailed on an empty claim since they were
    // written; the pool computed the claim and then ignored it.
    expect(mockedApi.post).toHaveBeenCalledTimes(1);
    const posted = (mockedApi.post.mock.calls[0][1] as { clusters: { id: string }[] }).clusters.map(
      (c) => c.id
    );
    expect(posted).toEqual(batches[1].slice(1).map((c) => c.id));

    // Coverage and the cache allow-list describe what actually went out.
    expect([...result.dispatchedClusterIds].sort()).toEqual(
      batches[1]
        .slice(1)
        .map((c) => c.id)
        .sort()
    );
    for (const id of heldElsewhere) {
      expect(result.dispatchedClusterIds.has(id)).toBe(false);
      expect(result.dispatchedAndResolvedIds.has(id)).toBe(false);
    }

    // The claim we never took is still the other path's to release.
    const inFlight = suggestionDispatch.getState().inFlightClusterIds;
    for (const id of heldElsewhere) expect(inFlight.has(id)).toBe(true);

    // A skipped batch still SETTLES, so progress reaches its denominator
    // instead of stalling at 100% minus that batch.
    expect(suggestionDispatch.getState().progress).toMatchObject({
      clustersTotal: clusters.length,
      clustersCompleted: clusters.length,
      percentage: 100,
    });

    suggestionDispatch.releaseClaim(heldElsewhere);
  });
});

// ---- Generation-scoped abort (U6) ------------------------------------------

describe('suggestionDispatch - abort is scoped to its own dispatch', () => {
  it('does not resurrect a worker parked in preparation when a new dispatch clears the flag', async () => {
    const oldClusters = buildClusters(FIRST_CHUNK_SIZE).map((c) => ({ ...c, id: `old-${c.id}` }));
    const newClusters = buildClusters(FIRST_CHUNK_SIZE).map((c) => ({ ...c, id: `new-${c.id}` }));
    const encoding = deferred<void>();

    // Vision encoding takes seconds — long enough for the user to leave.
    const prepareBatch = jest.fn(async (batch: PlaceSuggestionCluster[]) => {
      if (batch[0].id.startsWith('old-')) await encoding.promise;
      return batch;
    });

    mockedApi.post.mockImplementation(
      async (_url, body) =>
        ({
          data: {
            suggestions: suggestionsFor(
              (body as { clusters: { id: string }[] }).clusters.map((c) => c.id)
            ),
            failed_cluster_count: 0,
          },
        }) as never
    );

    const oldRun = suggestionDispatch.dispatch({ clusters: oldClusters, prepareBatch });
    await flush();

    // The user leaves the candidate mid-encode...
    suggestionDispatch.reset();
    // ...and the next candidate starts, which clears the SHARED abort flag.
    await suggestionDispatch.dispatch({ clusters: newClusters, prepareBatch });

    encoding.resolve();
    await oldRun;
    await flush();

    // The departed candidate's batch never goes on the wire: it is not merely
    // wasted money, it lands on a run that no longer owns the screen.
    const posted = mockedApi.post.mock.calls.flatMap((call) =>
      (call[1] as { clusters: { id: string }[] }).clusters.map((c) => c.id)
    );
    expect(posted).toEqual(newClusters.map((c) => c.id));

    // ...and the older run cannot overwrite the newer one's accumulators.
    const state = suggestionDispatch.getState();
    expect(state.partialResults.map((s) => s.cluster_id)).toEqual(newClusters.map((c) => c.id));
    expect(state.data?.suggestions.map((s) => s.cluster_id)).toEqual(newClusters.map((c) => c.id));
    for (const cluster of oldClusters) {
      expect(state.dispatchedAndResolvedClusterIds.has(cluster.id)).toBe(false);
      expect(state.failedClusterIds.has(cluster.id)).toBe(false);
    }
  });
});

// ---- Scoped batches are abortable and pause-aware (U6/U9) ------------------

describe('suggestionDispatch - scoped batch abort and pause', () => {
  it('reset() cancels a scoped batch on the wire, and the wire reports it', async () => {
    const signals: AbortSignal[] = [];
    mockedApi.post.mockImplementation(
      (_url, _body, config) =>
        new Promise((_resolve, reject) => {
          const signal = (config as { signal?: AbortSignal } | undefined)?.signal;
          signals.push(signal as AbortSignal);
          signal?.addEventListener('abort', () => reject(new Error('canceled')));
        }) as never
    );

    const run = suggestionDispatch.dispatchBatch({
      clusterIds: ['sc-1'],
      prepare: async () => [{ id: 'sc-1', centroid: { latitude: 1, longitude: 2 }, photos: [] }],
    });
    await flush();

    // A split / per-row retry is a batch on the wire like any other, so the
    // occupancy telemetry can see it.
    expect(suggestionDispatch.getInFlightBatchCount()).toBe(1);
    expect(signals[0].aborted).toBe(false);

    suggestionDispatch.reset();

    await expect(run).rejects.toThrow('canceled');
    expect(signals[0].aborted).toBe(true);
    expect(suggestionDispatch.getInFlightBatchCount()).toBe(0);
    expect(suggestionDispatch.getState().dispatchedAndResolvedClusterIds.has('sc-1')).toBe(false);
  });

  it('never posts, and marks nothing resolved, when the abort lands during preparation', async () => {
    const encoding = deferred<void>();
    mockedApi.post.mockResolvedValue(emptyResponse);

    const run = suggestionDispatch.dispatchBatch({
      clusterIds: ['sc-2'],
      prepare: async () => {
        await encoding.promise;
        return [{ id: 'sc-2', centroid: { latitude: 1, longitude: 2 }, photos: [] }];
      },
    });
    await flush();

    suggestionDispatch.reset();
    encoding.resolve();
    const outcome = await run;

    expect(mockedApi.post).not.toHaveBeenCalled();
    expect([...outcome.respondedIds]).toEqual([]);
    expect(outcome.unresolvedIds).toEqual(['sc-2']);
    // Non-zero on purpose: the split path reads a ZERO failure count as "every
    // cluster answered" and would cache an empty row for a batch that never
    // left the device (R20).
    expect(outcome.response.failed_cluster_count).toBe(1);
    expect(suggestionDispatch.getState().dispatchedAndResolvedClusterIds.has('sc-2')).toBe(false);
  });

  it('parks a scoped batch while the app is backgrounded, and issues it on resume', async () => {
    const prepare = jest.fn(async () => [
      { id: 'sc-3', centroid: { latitude: 1, longitude: 2 }, photos: [] },
    ]);
    mockedApi.post.mockResolvedValue(emptyResponse);

    suggestionDispatch.pause();
    const run = suggestionDispatch.dispatchBatch({ clusterIds: ['sc-3'], prepare });
    await flush();

    // Neither the request NOR the vision encoding it would need happens while
    // the app is away — the same rule the pool's workers follow.
    expect(mockedApi.post).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();

    suggestionDispatch.resume();
    await run;

    expect(mockedApi.post).toHaveBeenCalledTimes(1);
  });
});

// ---- U16: a burst-cap 429 is a wait, not the end of the import -------------

describe('suggestionDispatch - burst-cap rate limiting (U16)', () => {
  it('parks for a SHORT Retry-After and dispatches the rest of the plan', async () => {
    const clusters = buildClustersForBatches(3);
    const batches = planSuggestionBatches(clusters);

    mockedApi.post.mockImplementation(async (_url, body) => {
      const index = batchIndexOfRequest(batches, body);
      if (index === 1) throw makeAxiosError(429, { 'retry-after': '1' });
      return {
        data: {
          suggestions: suggestionsFor(batches[index].map((c) => c.id)),
          failed_cluster_count: 0,
        },
      } as never;
    });

    const startedAt = Date.now();
    const result = await suggestionDispatch.dispatch({ clusters, concurrency: 1, concurrency: 1 });
    const elapsedMs = Date.now() - startedAt;

    // The burst cap is 5/second and answers with Retry-After: 1. Ending the
    // import on it stranded every remaining batch — on a 100-cluster trip that
    // is ~80 locations rendered "Couldn't check this location".
    expect(mockedApi.post).toHaveBeenCalledTimes(3);
    expect(result.isPartial).toBe(false);
    // ...and it WAITED the window out rather than hammering straight back.
    expect(elapsedMs).toBeGreaterThanOrEqual(900);
    expect(result.suggestions.map((s) => s.cluster_id).sort()).toEqual(
      [...batches[0], ...batches[2]].map((c) => c.id).sort()
    );

    // The throttled batch stays RETRYABLE: unlike a quota or entitlement stop,
    // it becomes dispatchable again a second from now.
    const failed = suggestionDispatch.getState().failedClusterIds;
    expect([...failed.keys()].sort()).toEqual(batches[1].map((c) => c.id).sort());
    for (const id of failed.keys()) expect(failed.get(id)).toEqual({ retryDisabled: false });
    // The rejection is still reported, so the rate-limit analytics branch is
    // unchanged.
    expect(result.fatalError).toMatchObject({ name: 'RateLimitError', retryAfterSeconds: 1 });
  }, 15000);

  it('gives up after a bounded number of parks, so a pathological server cannot loop', async () => {
    const clusters = buildClustersForBatches(MAX_RATE_LIMIT_PARKS + 3);
    // Retry-After: 0 keeps the WAIT degenerate so this measures the bound
    // rather than the clock. Zero is inside the parkable window.
    expect(MAX_PARKABLE_RETRY_AFTER_SECONDS).toBeGreaterThanOrEqual(1);
    mockedApi.post.mockRejectedValue(makeAxiosError(429, { 'retry-after': '0' }));

    const result = await suggestionDispatch.dispatch({ clusters, concurrency: 1, concurrency: 1 });

    // MAX parks, then the next rejection is a hard stop like the sustained one.
    expect(mockedApi.post).toHaveBeenCalledTimes(MAX_RATE_LIMIT_PARKS + 1);
    expect(result.isPartial).toBe(true);
    expect(result.fatalError).toMatchObject({ name: 'RateLimitError' });
  }, 15000);

  it('keeps a LONG Retry-After a hard stop rather than parking a minute', async () => {
    const clusters = buildClustersForBatches(3);
    mockedApi.post
      .mockResolvedValueOnce(emptyResponse)
      .mockRejectedValueOnce(
        makeAxiosError(429, { 'retry-after': String(MAX_PARKABLE_RETRY_AFTER_SECONDS + 1) })
      )
      .mockResolvedValue(emptyResponse);

    const startedAt = Date.now();
    const result = await suggestionDispatch.dispatch({ clusters, concurrency: 1, concurrency: 1 });

    expect(mockedApi.post).toHaveBeenCalledTimes(2);
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(result.isPartial).toBe(true);
    const failed = suggestionDispatch.getState().failedClusterIds;
    for (const id of failed.keys()) expect(failed.get(id)).toEqual({ retryDisabled: true });
  });

  it('holds the payload retention bound across a rate-limit park', async () => {
    // The prefetch bound is what caps peak encoded-payload memory. A park is
    // exactly when workers sit holding prepared payloads, so it is the case the
    // accounting has to survive.
    const clusters = buildClustersForBatches(6);
    const batches = planSuggestionBatches(clusters);
    const prepareBatch = jest.fn(async (batch: PlaceSuggestionCluster[]) => batch);
    const retainedAtEachPost: number[] = [];

    mockedApi.post.mockImplementation(async (_url, body) => {
      // Prepared but not yet posted, counting this request as posted.
      retainedAtEachPost.push(prepareBatch.mock.calls.length - mockedApi.post.mock.calls.length);
      const index = batchIndexOfRequest(batches, body);
      if (index === 1) throw makeAxiosError(429, { 'retry-after': '0' });
      return emptyResponse as never;
    });

    await suggestionDispatch.dispatch({ clusters, prepareBatch, concurrency: 2 });

    expect(retainedAtEachPost.length).toBe(batches.length);
    for (const retained of retainedAtEachPost) {
      expect(retained).toBeLessThanOrEqual(2 + 1);
    }
  }, 15000);
});
