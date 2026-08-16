/**
 * Tests for quiz hooks and the end-to-end creation orchestration.
 *
 * Covers:
 * - useQuiz: owner detail query
 * - useCreateQuiz driving createQuizFromLibrary:
 *   - AE2: 6 eligible -> 6-photo quiz; 4 eligible -> decline (draft deleted)
 *   - KTD3: first batch <= 50, one resample <= 20 (front-loaded people shots)
 *   - KTD2: border/no-fix/unmapped photos never reach the classifier
 *   - KTD12/R17: repeat creations avoid used asset ids until fresh exhausted
 *   - service failure surfaces a retryable error, NOT a thin-library decline
 *   - interrupted upload leaves a resumable draft; resume skips completed
 *     photos and never re-creates the server draft
 */

import React from 'react';
import { Image } from 'react-native';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fetch as expoFetch } from 'expo/fetch';

import { useCreateQuiz, useDeleteQuiz, useQuiz } from '@hooks/useQuizzes';
import { api } from '@services/api';
import type { QuizCreationOutcome, QuizCreationProgress } from '@services/quiz/quizCreation';
import type { CachedPhoto } from '@services/photoImport/types';
import { createTestQueryClient } from '../utils/testUtils';

// ---------------------------------------------------------------------------
// Module mocks (photo cache, coder, scan infra, vision prep, countries)
// ---------------------------------------------------------------------------

const mockMetadataStore = new Map<string, string>();
const mockGetAllCachedPhotos = jest.fn<Promise<CachedPhoto[]>, []>();

jest.mock('@services/photoImport/photoCacheDb', () => ({
  getAllCachedPhotos: (...args: []) => mockGetAllCachedPhotos(...args),
  getLastImportTime: jest.fn().mockResolvedValue(1_700_000_000_000),
  getMetadata: jest.fn(async (key: string) => mockMetadataStore.get(key) ?? null),
  setMetadata: jest.fn(async (key: string, value: string) => {
    mockMetadataStore.set(key, value);
  }),
  cachePhotos: jest.fn().mockResolvedValue(undefined),
  setLastImportTime: jest.fn().mockResolvedValue(undefined),
}));

const mockIso1A2Code = jest.fn<string | null, [[number, number], { level?: string }?]>(() => null);
jest.mock('@services/photoImport/countryCoder', () => ({
  iso1A2Code: (...args: [[number, number], { level?: string }?]) => mockIso1A2Code(...args),
}));

jest.mock('@services/photoImport/photoImportService', () => ({
  extractPhotosWithLocation: jest.fn().mockResolvedValue([]),
}));

jest.mock('@services/photoImport/photoClusteringCache', () => ({
  photoToCachedPhoto: jest.fn((photo: unknown) => photo),
}));

jest.mock('@services/photoImport/photoBackgroundSync', () => ({
  isBackgroundSyncInProgress: jest.fn(() => false),
  // The creation flow consults the shared refresh (P1); "fresh" means it
  // proceeds straight to the cache with no scanning progress.
  ensureFreshLibrary: jest.fn(async () => ({
    status: 'fresh',
    freshness: {
      fresh: true,
      reason: 'synced-recently',
      lastSuccessAt: 1_700_000_000_000,
      cachedPhotoCount: 10,
      permission: 'granted',
    },
  })),
}));

jest.mock('@services/photoImport/photoScanState', () => ({
  isScanRunning: jest.fn(() => false),
}));

jest.mock('@services/photoImport/visionPhoto', () => ({
  prepareVisionImage: jest.fn(async (uri: string) => `b64-${uri}`),
}));

jest.mock('@services/countriesDb', () => ({
  getAllCountries: jest.fn().mockResolvedValue(
    ['FR', 'IT', 'JP', 'US', 'PT'].map((code) => ({
      code,
      name: code,
      region: 'Test',
      subregion: null,
      recognition: null,
    }))
  ),
}));

jest.mock(
  'expo-image-manipulator',
  () => ({
    manipulateAsync: jest.fn(async (uri: string) => ({ uri: `${uri}.resized.jpg` })),
    SaveFormat: { JPEG: 'jpeg' },
  }),
  { virtual: true }
);

const mockedApi = api as jest.Mocked<typeof api>;
const mockedExpoFetch = expoFetch as jest.Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

let photoCounter = 0;

function makeCachedPhoto(overrides: Partial<CachedPhoto> = {}): CachedPhoto {
  photoCounter += 1;
  return {
    id: `asset-${photoCounter}`,
    uri: `file:///asset-${photoCounter}.jpg`,
    filename: `asset-${photoCounter}.jpg`,
    // Hours apart by default: fixtures are distinct shots, never burst
    // frames, so the near-duplicate collapse (BUG-2) leaves them alone.
    creationTime: 1_690_000_000_000 + photoCounter * 3_600_000,
    latitude: 48.85,
    longitude: 2.35,
    geohash: 'u09tvw0',
    countryCode: 'FR',
    ...overrides,
  };
}

/**
 * Install an api.post dispatcher for the whole creation flow. `eligibleIds`
 * decides per-photo verdicts; ids in `errorIds` come back as retryable
 * transport errors.
 */
function installQuizApi({
  eligibleIds,
  errorIds = new Set<string>(),
  quizId = 'quiz-1',
}: {
  eligibleIds: Set<string>;
  errorIds?: Set<string>;
  quizId?: string;
}) {
  let classifiedCount = 0;
  let uploadSlot = 0;
  const eligibilityBatches: string[][] = [];

  mockedApi.post.mockImplementation(async (url: string, body?: unknown) => {
    if (url === '/quiz') {
      return { data: { id: quizId, state: 'building' } };
    }
    if (url === '/quiz/eligibility') {
      const { images } = body as { images: Array<{ id: string }> };
      eligibilityBatches.push(images.map((image) => image.id));
      classifiedCount += images.length;
      return {
        data: {
          results: images.map((image) =>
            errorIds.has(image.id)
              ? { id: image.id, eligible: false, status: 'error', reason: 'unavailable' }
              : eligibleIds.has(image.id)
                ? { id: image.id, eligible: true, status: 'eligible', landscape: 'prairie' }
                : { id: image.id, eligible: false, status: 'ineligible', reason: 'people_present' }
          ),
          classified_count: classifiedCount,
          budget_remaining: Math.max(0, 70 - classifiedCount),
        },
      };
    }
    if (url === `/quiz/${quizId}/upload-urls`) {
      const { count } = body as { count: number };
      return {
        data: {
          uploads: Array.from({ length: count }, () => {
            uploadSlot += 1;
            return {
              storage_path: `quiz/${quizId}/obj-${uploadSlot}.jpg`,
              upload_url: `https://storage.test/upload/${uploadSlot}`,
              cache_control: '60',
            };
          }),
        },
      };
    }
    if (url === `/quiz/${quizId}/finalize`) {
      return { data: { id: quizId, state: 'awaiting_owner_play', questions: [] } };
    }
    throw new Error(`Unexpected POST ${url}`);
  });

  return { eligibilityBatches };
}

async function runCreation(
  queryClient: QueryClient,
  onProgress?: (progress: QuizCreationProgress) => void
): Promise<QuizCreationOutcome> {
  const { result } = renderHook(() => useCreateQuiz(), {
    wrapper: createWrapper(queryClient),
  });
  let outcome: QuizCreationOutcome | undefined;
  await act(async () => {
    outcome = await result.current.mutateAsync({ onProgress });
  });
  return outcome!;
}

describe('useQuizzes', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    jest.clearAllMocks();
    mockMetadataStore.clear();
    photoCounter = 0;
    mockIso1A2Code.mockImplementation(() => null);
    mockGetAllCachedPhotos.mockResolvedValue([]);
    mockedExpoFetch.mockResolvedValue({ ok: true, status: 200 });
    // RN's Image.getSize never settles under jest; fail it synchronously so
    // prepareQuizUploadImage falls back to a no-resize re-encode.
    jest
      .spyOn(Image, 'getSize')
      .mockImplementation((_uri, _onSuccess, onFailure) => onFailure?.(new Error('no size')));
  });

  // ============ useQuiz ============

  describe('useQuiz', () => {
    it('fetches quiz detail from GET /quiz/{id}', async () => {
      const detail = { id: 'quiz-1', state: 'awaiting_owner_play', questions: [] };
      mockedApi.get.mockResolvedValueOnce({ data: detail });

      const { result } = renderHook(() => useQuiz('quiz-1'), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockedApi.get).toHaveBeenCalledWith('/quiz/quiz-1');
      expect(result.current.data).toEqual(detail);
    });

    it('does not fetch without a quiz id', () => {
      renderHook(() => useQuiz(undefined), { wrapper: createWrapper(queryClient) });
      expect(mockedApi.get).not.toHaveBeenCalled();
    });
  });

  // ============ useCreateQuiz - happy paths ============

  describe('quiz creation', () => {
    it('builds a 6-photo quiz when exactly 6 photos are eligible (AE2)', async () => {
      const photos = Array.from({ length: 8 }, () => makeCachedPhoto());
      mockGetAllCachedPhotos.mockResolvedValue(photos);
      installQuizApi({ eligibleIds: new Set(photos.slice(0, 6).map((p) => p.id)) });

      const progressSteps: QuizCreationProgress[] = [];
      const outcome = await runCreation(queryClient, (p) => progressSteps.push(p));

      expect(outcome).toEqual({ status: 'created', quizId: 'quiz-1', photoCount: 6 });

      // 6 uploads, each carrying the server-directed cacheControl (KTD5).
      expect(mockedExpoFetch).toHaveBeenCalledTimes(6);
      for (const [, init] of mockedExpoFetch.mock.calls) {
        expect(init.method).toBe('PUT');
        expect(init.headers['cache-control']).toBe('max-age=60');
      }

      // Finalize carries every uploaded photo with ground truth.
      const finalizeCall = mockedApi.post.mock.calls.find(([url]) =>
        String(url).endsWith('/finalize')
      );
      expect(finalizeCall).toBeDefined();
      const { photos: finalized } = finalizeCall![1] as {
        photos: Array<{
          storage_path: string;
          country_code: string;
          capture_year: number | null;
          landscape: string | null;
        }>;
      };
      expect(finalized).toHaveLength(6);
      expect(finalized.every((p) => p.country_code === 'FR')).toBe(true);
      expect(finalized.every((p) => p.storage_path.startsWith('quiz/quiz-1/'))).toBe(true);
      expect(finalized.every((p) => p.landscape === 'prairie')).toBe(true);

      // Real progress feel: checking then building, in order. The cache was
      // FRESH (ensureFreshLibrary mock), so NO scanning step is ever emitted
      // (Q5: the scan step only exists when a scan actually runs).
      const seenSteps = progressSteps.map((p) => p.step);
      expect(seenSteps).not.toContain('scanning');
      expect(seenSteps).toContain('checking');
      expect(seenSteps).toContain('building');
      expect(seenSteps.indexOf('checking')).toBeLessThan(seenSteps.indexOf('building'));
    });

    it('emits scanning progress only when the cache is actually stale (Q5)', async () => {
      const photos = Array.from({ length: 8 }, () => makeCachedPhoto());
      mockGetAllCachedPhotos.mockResolvedValue(photos);
      installQuizApi({ eligibleIds: new Set(photos.map((p) => p.id)) });
      // Stale cache: the shared refresh runs and reports extract progress.
      const { ensureFreshLibrary } = jest.requireMock(
        '@services/photoImport/photoBackgroundSync'
      ) as {
        ensureFreshLibrary: jest.Mock;
      };
      ensureFreshLibrary.mockImplementationOnce(
        async (options: { onProgress?: (p: { current: number; total: number }) => void }) => {
          options.onProgress?.({ current: 1, total: 4 });
          options.onProgress?.({ current: 4, total: 4 });
          return {
            status: 'refreshed',
            newPhotos: 4,
            freshness: {
              fresh: true,
              reason: 'synced-recently',
              lastSuccessAt: 1_700_000_000_000,
              cachedPhotoCount: 8,
              permission: 'granted',
            },
          };
        }
      );

      const progressSteps: Array<{ step: string }> = [];
      const outcome = await runCreation(queryClient, (p) => progressSteps.push(p));

      expect(outcome).toEqual(expect.objectContaining({ status: 'created' }));
      const seenSteps = progressSteps.map((p) => p.step);
      expect(seenSteps).toContain('scanning');
      expect(seenSteps.indexOf('scanning')).toBeLessThan(seenSteps.indexOf('checking'));
    });

    it('resamples once when the first batch is front-loaded with people shots (KTD3)', async () => {
      // 60 geo-eligible photos: first batch takes 50, resample takes the rest.
      const photos = Array.from({ length: 60 }, () => makeCachedPhoto());
      mockGetAllCachedPhotos.mockResolvedValue(photos);

      // 3 eligible photos land in the first 50; 4 more among the remaining 10.
      const eligibleIds = new Set([
        ...photos.slice(0, 3).map((p) => p.id),
        ...photos.slice(52, 56).map((p) => p.id),
      ]);
      const { eligibilityBatches } = installQuizApi({ eligibleIds });

      const outcome = await runCreation(queryClient);

      expect(outcome).toEqual({ status: 'created', quizId: 'quiz-1', photoCount: 7 });
      expect(eligibilityBatches).toHaveLength(2);
      expect(eligibilityBatches[0]).toHaveLength(50); // first batch cap
      expect(eligibilityBatches[1].length).toBeLessThanOrEqual(20); // resample cap
      // The resample never re-sends already-classified photos.
      const firstBatchIds = new Set(eligibilityBatches[0]);
      expect(eligibilityBatches[1].every((id) => !firstBatchIds.has(id))).toBe(true);
    });

    it('avoids asset ids used by existing quizzes until the fresh pool is exhausted (R17/KTD12)', async () => {
      const usedPhotos = Array.from({ length: 5 }, () => makeCachedPhoto());
      const freshPhotos = Array.from({ length: 15 }, () => makeCachedPhoto());
      mockMetadataStore.set('quiz_used_asset_ids', JSON.stringify(usedPhotos.map((p) => p.id)));
      mockGetAllCachedPhotos.mockResolvedValue([...usedPhotos, ...freshPhotos]);
      installQuizApi({
        eligibleIds: new Set([...usedPhotos, ...freshPhotos].map((p) => p.id)),
      });

      const outcome = await runCreation(queryClient);
      expect(outcome).toEqual({ status: 'created', quizId: 'quiz-1', photoCount: 10 });

      // All 10 picks came from the 15 fresh photos: the used set grew from 5
      // to exactly 15 distinct ids (no previously used id was re-picked).
      const usedAfter = JSON.parse(mockMetadataStore.get('quiz_used_asset_ids')!) as string[];
      expect(usedAfter).toHaveLength(15);
      const freshIds = new Set(freshPhotos.map((p) => p.id));
      const newlyUsed = usedAfter.filter((id) => !usedPhotos.some((p) => p.id === id));
      expect(newlyUsed).toHaveLength(10);
      expect(newlyUsed.every((id) => freshIds.has(id))).toBe(true);
    });

    it('never sends border-ambiguous, no-fix, or unmapped photos to the classifier (KTD2)', async () => {
      const borderPhoto = makeCachedPhoto({ latitude: 45.0, longitude: 6.0, countryCode: 'FR' });
      const noFixPhoto = makeCachedPhoto({ countryCode: null });
      const unmappedPhoto = makeCachedPhoto({ countryCode: 'ZZ' });
      const goodPhotos = Array.from({ length: 6 }, () => makeCachedPhoto());
      mockGetAllCachedPhotos.mockResolvedValue([
        borderPhoto,
        noFixPhoto,
        unmappedPhoto,
        ...goodPhotos,
      ]);
      // Probes east of lon 6 land in Italy -> borderPhoto is ambiguous.
      mockIso1A2Code.mockImplementation(([lon]) => (lon > 6.01 ? 'IT' : null));
      const { eligibilityBatches } = installQuizApi({
        eligibleIds: new Set(goodPhotos.map((p) => p.id)),
      });

      const outcome = await runCreation(queryClient);

      expect(outcome).toEqual({ status: 'created', quizId: 'quiz-1', photoCount: 6 });
      const sentIds = new Set(eligibilityBatches.flat());
      expect(sentIds.has(borderPhoto.id)).toBe(false);
      expect(sentIds.has(noFixPhoto.id)).toBe(false);
      expect(sentIds.has(unmappedPhoto.id)).toBe(false);
    });
  });

  // ============ useCreateQuiz - declines and failures ============

  describe('declines and failures', () => {
    it('declines with guidance and deletes the draft when only 4 photos are eligible (AE2)', async () => {
      const photos = Array.from({ length: 6 }, () => makeCachedPhoto());
      mockGetAllCachedPhotos.mockResolvedValue(photos);
      installQuizApi({ eligibleIds: new Set(photos.slice(0, 4).map((p) => p.id)) });

      const outcome = await runCreation(queryClient);

      expect(outcome).toEqual({
        status: 'thin-library',
        eligibleCount: 4,
        hasGeoCandidates: true,
      });
      // KTD7: the decline deletes the server draft.
      expect(mockedApi.delete).toHaveBeenCalledWith('/quiz/quiz-1');
      // No upload or finalize ever happened.
      expect(mockedExpoFetch).not.toHaveBeenCalled();
    });

    it('declines without a server round-trip when no photo has usable GPS', async () => {
      mockGetAllCachedPhotos.mockResolvedValue([
        makeCachedPhoto({ countryCode: null }),
        makeCachedPhoto({ countryCode: null }),
      ]);

      const outcome = await runCreation(queryClient);

      expect(outcome).toEqual({
        status: 'thin-library',
        eligibleCount: 0,
        hasGeoCandidates: false,
      });
      expect(mockedApi.post).not.toHaveBeenCalled();
    });

    it('surfaces a retryable service error when the vision endpoint fails - NOT a thin-library decline', async () => {
      const photos = Array.from({ length: 8 }, () => makeCachedPhoto());
      mockGetAllCachedPhotos.mockResolvedValue(photos);
      mockedApi.post.mockImplementation(async (url: string) => {
        if (url === '/quiz') return { data: { id: 'quiz-1', state: 'building' } };
        if (url === '/quiz/eligibility') throw new Error('Network error');
        throw new Error(`Unexpected POST ${url}`);
      });

      const outcome = await runCreation(queryClient);

      expect(outcome).toEqual({ status: 'service-error', stage: 'classify' });
      // The draft is kept for the retry, not deleted.
      expect(mockedApi.delete).not.toHaveBeenCalled();
    });

    it('treats an all-error classification batch as a retryable outage', async () => {
      const photos = Array.from({ length: 6 }, () => makeCachedPhoto());
      mockGetAllCachedPhotos.mockResolvedValue(photos);
      installQuizApi({
        eligibleIds: new Set(),
        errorIds: new Set(photos.map((p) => p.id)),
      });

      const outcome = await runCreation(queryClient);

      expect(outcome).toEqual({ status: 'service-error', stage: 'classify' });
    });

    it('declines from the already-eligible photos on a 429 budget-exceeded - NOT retryable', async () => {
      // 60 geo-eligible photos: first batch classifies 50 (4 eligible, below
      // the minimum), so a resample fires - and the server rejects it with the
      // explicit budget-exceeded code. Retrying can never succeed, so the flow
      // must proceed with what is already eligible: 4 < 5 -> guided decline.
      const photos = Array.from({ length: 60 }, () => makeCachedPhoto());
      mockGetAllCachedPhotos.mockResolvedValue(photos);

      let eligibilityCalls = 0;
      mockedApi.post.mockImplementation(async (url: string, body?: unknown) => {
        if (url === '/quiz') return { data: { id: 'quiz-1', state: 'building' } };
        if (url === '/quiz/eligibility') {
          eligibilityCalls += 1;
          if (eligibilityCalls > 1) {
            throw Object.assign(new Error('Request failed with status code 429'), {
              response: {
                status: 429,
                data: {
                  detail: {
                    code: 'QUIZ_CLASSIFICATION_BUDGET_EXCEEDED',
                    message: 'This quiz has used its photo-check budget.',
                  },
                },
              },
            });
          }
          // Exactly 4 of the first batch pass the vision gate (below the
          // 5-photo minimum, so the resample fires - and gets the 429 above).
          const { images } = body as { images: Array<{ id: string }> };
          return {
            data: {
              results: images.map((image, index) =>
                index < 4
                  ? { id: image.id, eligible: true, status: 'eligible' }
                  : { id: image.id, eligible: false, status: 'ineligible', reason: 'people' }
              ),
              classified_count: images.length,
              budget_remaining: 20,
            },
          };
        }
        throw new Error(`Unexpected POST ${url}`);
      });
      mockedApi.delete.mockResolvedValue({ data: {} });

      const outcome = await runCreation(queryClient);

      // Budget exhaustion is a decline (with the draft deleted), never the
      // retryable service error that would re-spend budget on every retry.
      expect(outcome).toEqual({
        status: 'thin-library',
        eligibleCount: 4,
        hasGeoCandidates: true,
      });
      expect(mockedApi.delete).toHaveBeenCalledWith('/quiz/quiz-1');
      expect(eligibilityCalls).toBe(2);
    });

    it('clears a server-deleted draft on eligibility 404 and restarts with a fresh draft', async () => {
      // A persisted classifier-retry draft points at a server draft that no
      // longer exists (deleted from My Quizzes). Its eligibility call 404s;
      // the flow must drop the stale mirror and build with a NEW server draft
      // instead of 404-looping as a retryable error.
      mockMetadataStore.set(
        'quiz_draft_state',
        JSON.stringify({ quizId: 'quiz-dead', createdAt: Date.now(), picks: [] })
      );
      const photos = Array.from({ length: 8 }, () => makeCachedPhoto());
      mockGetAllCachedPhotos.mockResolvedValue(photos);
      const { eligibilityBatches } = installQuizApi({
        eligibleIds: new Set(photos.slice(0, 6).map((p) => p.id)),
        quizId: 'quiz-2',
      });
      const installed = mockedApi.post.getMockImplementation()!;
      mockedApi.post.mockImplementation(async (url: string, body?: unknown) => {
        if (url === '/quiz/eligibility' && (body as { quiz_id: string }).quiz_id === 'quiz-dead') {
          throw Object.assign(new Error('Request failed with status code 404'), {
            response: { status: 404, data: { detail: 'Quiz draft not found' } },
          });
        }
        return installed(url, body);
      });

      const outcome = await runCreation(queryClient);

      expect(outcome).toEqual({ status: 'created', quizId: 'quiz-2', photoCount: 6 });
      // The dead draft was replaced by a fresh server draft.
      expect(mockedApi.post).toHaveBeenCalledWith('/quiz');
      expect(eligibilityBatches.length).toBeGreaterThan(0);
      // Local draft state is cleared after the successful fresh build.
      expect(mockMetadataStore.get('quiz_draft_state')).toBeFalsy();
    });
  });

  // ============ useDeleteQuiz - local draft cleanup ============

  describe('useDeleteQuiz draft cleanup', () => {
    async function runDelete(quizId: string) {
      const { result } = renderHook(() => useDeleteQuiz(), {
        wrapper: createWrapper(queryClient),
      });
      await act(async () => {
        await result.current.mutateAsync(quizId);
      });
    }

    it('clears the persisted local draft when the deleted quiz IS that draft', async () => {
      mockMetadataStore.set(
        'quiz_draft_state',
        JSON.stringify({ quizId: 'quiz-1', createdAt: Date.now(), picks: [] })
      );
      mockedApi.delete.mockResolvedValue({ data: {} });

      await runDelete('quiz-1');

      expect(mockedApi.delete).toHaveBeenCalledWith('/quiz/quiz-1');
      expect(mockMetadataStore.get('quiz_draft_state')).toBeFalsy();

      // The next creation starts completely fresh: a NEW server draft, no
      // resume of the dead one (which would only 404).
      const photos = Array.from({ length: 8 }, () => makeCachedPhoto());
      mockGetAllCachedPhotos.mockResolvedValue(photos);
      installQuizApi({ eligibleIds: new Set(photos.map((p) => p.id)), quizId: 'quiz-2' });

      const outcome = await runCreation(queryClient);
      expect(outcome).toMatchObject({ status: 'created', quizId: 'quiz-2' });
      expect(mockedApi.post).toHaveBeenCalledWith('/quiz');
    });

    it('keeps the persisted draft when deleting a DIFFERENT quiz', async () => {
      const draft = { quizId: 'quiz-draft', createdAt: Date.now(), picks: [] };
      mockMetadataStore.set('quiz_draft_state', JSON.stringify(draft));
      mockedApi.delete.mockResolvedValue({ data: {} });

      await runDelete('quiz-other');

      expect(JSON.parse(mockMetadataStore.get('quiz_draft_state')!)).toEqual(draft);
    });
  });

  // ============ useCreateQuiz - interruption and resume (KTD7) ============

  describe('interruption and resume', () => {
    it('leaves a resumable draft on upload failure and resumes without re-uploading completed photos', async () => {
      const photos = Array.from({ length: 8 }, () => makeCachedPhoto());
      mockGetAllCachedPhotos.mockResolvedValue(photos);
      installQuizApi({ eligibleIds: new Set(photos.slice(0, 6).map((p) => p.id)) });

      // First run: uploads 1-2 succeed, upload 3 fails.
      mockedExpoFetch.mockImplementation(async (url: string) =>
        url.endsWith('/3') ? { ok: false, status: 500 } : { ok: true, status: 200 }
      );

      const firstOutcome = await runCreation(queryClient);
      expect(firstOutcome).toEqual({
        status: 'interrupted',
        quizId: 'quiz-1',
        uploadedCount: 2,
        totalCount: 6,
      });
      // Draft state persisted locally for resume.
      expect(mockMetadataStore.get('quiz_draft_state')).toBeTruthy();

      // Second run: uploads succeed. Resume must skip the 2 completed photos.
      mockedExpoFetch.mockClear();
      mockedExpoFetch.mockResolvedValue({ ok: true, status: 200 });
      const postCallsBeforeResume = mockedApi.post.mock.calls.length;

      const secondOutcome = await runCreation(queryClient);

      expect(secondOutcome).toEqual({ status: 'created', quizId: 'quiz-1', photoCount: 6 });
      // Only the 4 remaining photos were uploaded.
      expect(mockedExpoFetch).toHaveBeenCalledTimes(4);
      const resumeCalls = mockedApi.post.mock.calls.slice(postCallsBeforeResume);
      const uploadUrlCall = resumeCalls.find(([url]) => String(url).endsWith('/upload-urls'));
      expect(uploadUrlCall![1]).toEqual({ count: 4 });
      // Resume re-created neither the draft nor the classification work.
      expect(resumeCalls.some(([url]) => url === '/quiz')).toBe(false);
      expect(resumeCalls.some(([url]) => url === '/quiz/eligibility')).toBe(false);
      // Finalize still carries all 6 photos.
      const finalizeCall = resumeCalls.find(([url]) => String(url).endsWith('/finalize'));
      const { photos: finalized } = finalizeCall![1] as { photos: unknown[] };
      expect(finalized).toHaveLength(6);
      // Draft state cleared after success.
      expect(mockMetadataStore.get('quiz_draft_state')).toBeFalsy();
    });
  });

  // ============ scoped invalidation ============

  it('invalidates only the created quiz query on success', async () => {
    const photos = Array.from({ length: 8 }, () => makeCachedPhoto());
    mockGetAllCachedPhotos.mockResolvedValue(photos);
    installQuizApi({ eligibleIds: new Set(photos.map((p) => p.id)) });

    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    const outcome = await runCreation(queryClient);

    expect(outcome.status).toBe('created');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['quizzes', 'quiz-1'] });
  });
});
