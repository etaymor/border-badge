/**
 * Quiz creation orchestration - candidate funnel regression tests.
 *
 * The bug this file pins: cached photo URIs captured during the library scan
 * (`info.localUri ?? info.uri`, with `shouldDownloadFromNetwork: false`) go
 * stale. On an iCloud-optimized library most of them are unreadable by the
 * time a challenge is built, `prepareVisionImage` returns null for each, and
 * the creation declined with "Not Enough Photos Yet" even though the library
 * held thousands of eligible photos. Every dropped candidate must first get
 * one `resolveLoadableUri` retry (the same recovery the photo thumbnails use).
 */

jest.mock('@services/api', () => ({
  api: { post: jest.fn(), delete: jest.fn() },
}));

jest.mock('@services/countriesDb', () => ({
  getAllCountries: jest.fn(),
  getHomeCountry: jest.fn(),
}));

jest.mock('@services/mediaUpload', () => ({
  getImageDimensions: jest.fn().mockResolvedValue({ width: 1200, height: 900 }),
}));

jest.mock('@services/photoImport/countryCoder', () => ({
  iso1A2Code: jest.fn(() => null),
}));

jest.mock('@services/photoImport/photoBackgroundSync', () => ({
  ensureFreshLibrary: jest.fn(),
}));

jest.mock('@services/photoImport/photoCacheDb', () => ({
  getAllCachedPhotos: jest.fn(),
  getMetadata: jest.fn().mockResolvedValue(null),
  setMetadata: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@services/photoImport/photoTagDb', () => ({
  getTagsForIds: jest.fn(),
  getAllVerdicts: jest.fn(),
  upsertVerdicts: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@services/photoImport/visionPhoto', () => ({
  prepareVisionImage: jest.fn(),
}));

jest.mock('@services/photoImport/resolveLoadableUri', () => ({
  resolveLoadableUri: jest.fn(),
}));

jest.mock('@services/quiz/quizAssets', () => ({
  recordQuizAssets: jest.fn().mockResolvedValue(undefined),
}));

jest.mock(
  'expo-image-manipulator',
  () => ({
    manipulateAsync: jest.fn().mockResolvedValue({ uri: 'file:///prepared.jpg' }),
    SaveFormat: { JPEG: 'jpeg' },
  }),
  { virtual: true }
);

import { api } from '@services/api';
import { getAllCountries, getHomeCountry } from '@services/countriesDb';
import { ensureFreshLibrary } from '@services/photoImport/photoBackgroundSync';
import { getAllCachedPhotos, getMetadata } from '@services/photoImport/photoCacheDb';
import { getAllVerdicts, getTagsForIds, upsertVerdicts } from '@services/photoImport/photoTagDb';
import { resolveLoadableUri } from '@services/photoImport/resolveLoadableUri';
import { prepareVisionImage } from '@services/photoImport/visionPhoto';
import { CLASSIFICATION_BUDGET_PER_QUIZ } from '@services/quiz/candidateSelection';
import { createQuizFromLibrary } from '@services/quiz/quizCreation';

import type { CachedPhoto } from '@services/photoImport/types';
import type { QuizCreationProgress } from '@services/quiz/quizCreation';

const mockApi = api as unknown as { post: jest.Mock; delete: jest.Mock };
const mockGetAllCountries = getAllCountries as jest.Mock;
const mockGetHomeCountry = getHomeCountry as jest.Mock;
const mockEnsureFreshLibrary = ensureFreshLibrary as jest.Mock;
const mockGetAllCachedPhotos = getAllCachedPhotos as jest.Mock;
const mockGetMetadata = getMetadata as jest.Mock;
const mockGetTagsForIds = getTagsForIds as jest.Mock;
const mockGetAllVerdicts = getAllVerdicts as jest.Mock;
const mockUpsertVerdicts = upsertVerdicts as jest.Mock;
const mockPrepareVisionImage = prepareVisionImage as jest.Mock;
const mockResolveLoadableUri = resolveLoadableUri as jest.Mock;

// Coordinates well inside single countries so the border probe stays quiet.
const PLACES = [
  { code: 'FR', latitude: 46.6, longitude: 2.4 },
  { code: 'JP', latitude: 36.2, longitude: 138.3 },
  { code: 'PE', latitude: -9.2, longitude: -75.0 },
  { code: 'IS', latitude: 64.9, longitude: -19.0 },
  { code: 'IT', latitude: 42.8, longitude: 12.5 },
];
const HOME = { code: 'US', latitude: 39.5, longitude: -98.4 };

/** One cached photo per country/day so nothing is collapsed as a duplicate. */
function buildCachedLibrary(count: number, places = PLACES): CachedPhoto[] {
  return Array.from({ length: count }, (_, index) => {
    const place = places[index % places.length];
    return {
      id: `${place.code}-${index}`,
      // Volatile scan-time URI: unreadable by the time the quiz is built.
      uri: `file:///stale/asset-${index}.jpg`,
      filename: `asset-${index}.jpg`,
      // One distinct day per photo (diversity passes want distinct days).
      creationTime: Date.UTC(2024, 0, 1 + index, 12),
      latitude: place.latitude,
      longitude: place.longitude,
      countryCode: place.code,
    } as CachedPhoto;
  });
}

/**
 * Per-image eligibility verdict for the mocked /quiz/eligibility endpoint.
 * Reassign in a test to control which photos pass and why.
 */
let verdictFor: (id: string) => { eligible: boolean; reason?: string } = () => ({
  eligible: true,
});

/** The ids sent to /quiz/eligibility, one array per request, in order. */
function eligibilityBatches(): string[][] {
  return mockApi.post.mock.calls
    .filter(([url]) => url === '/quiz/eligibility')
    .map(([, body]) => body.images.map((image: { id: string }) => image.id));
}

beforeEach(() => {
  jest.clearAllMocks();

  mockGetAllCountries.mockResolvedValue([
    { code: 'FR' },
    { code: 'JP' },
    { code: 'PE' },
    { code: 'IS' },
    { code: 'IT' },
  ]);
  mockEnsureFreshLibrary.mockResolvedValue({ status: 'refreshed', newPhotos: 6 });
  mockGetHomeCountry.mockResolvedValue(null);
  mockResolveLoadableUri.mockImplementation(async (assetId: string) =>
    assetId ? `file:///fresh/${assetId}.jpg` : null
  );
  verdictFor = () => ({ eligible: true });
  // Default: no tags and no cached verdicts, i.e. exactly the pre-tagging world.
  mockGetTagsForIds.mockResolvedValue(new Map());
  mockGetAllVerdicts.mockResolvedValue(new Map());
  mockUpsertVerdicts.mockResolvedValue(undefined);

  let classified = 0;
  mockApi.post.mockImplementation(async (url: string, body: { images?: Array<{ id: string }> }) => {
    if (url === '/quiz') {
      return { data: { id: 'quiz-1', state: 'draft' } };
    }
    if (url === '/quiz/eligibility') {
      const images = body?.images ?? [];
      // The server accumulates spend across batches, exactly like the real one.
      classified += images.length;
      return {
        data: {
          results: images.map((image) => {
            const verdict = verdictFor(image.id);
            return {
              id: image.id,
              eligible: verdict.eligible,
              status: verdict.eligible ? 'eligible' : 'ineligible',
              reason: verdict.reason ?? null,
              landscape: null,
            };
          }),
          classified_count: classified,
          budget_remaining: CLASSIFICATION_BUDGET_PER_QUIZ - classified,
        },
      };
    }
    if (url.endsWith('/upload-urls')) {
      const count = (body as unknown as { count: number }).count;
      return {
        data: {
          uploads: Array.from({ length: count }, (_, index) => ({
            storage_path: `quiz-1/${index}.jpg`,
            upload_url: `https://storage.test/quiz-1/${index}`,
            cache_control: '3600',
          })),
        },
      };
    }
    return { data: {} };
  });
  mockApi.delete.mockResolvedValue({ data: {} });
});

describe('createQuizFromLibrary - stale cached URIs', () => {
  it('re-resolves candidates whose cached URI no longer loads instead of declining', async () => {
    mockGetAllCachedPhotos.mockResolvedValue(buildCachedLibrary(40));
    // Every stale scan-time URI fails; the re-resolved URI works. This is the
    // iCloud-offloaded library case that produced a bogus thin-library decline.
    mockPrepareVisionImage.mockImplementation(async (uri: string) =>
      uri.startsWith('file:///fresh/') ? 'base64-image' : null
    );

    const outcome = await createQuizFromLibrary();

    expect(outcome.status).toBe('created');
    expect(mockResolveLoadableUri).toHaveBeenCalled();

    const eligibilityCall = mockApi.post.mock.calls.find(([url]) => url === '/quiz/eligibility');
    expect(eligibilityCall).toBeDefined();
    expect(eligibilityCall![1].images.length).toBeGreaterThanOrEqual(5);
  });

  it('gives up on a candidate whose re-resolved URI also fails, without retry loops', async () => {
    mockGetAllCachedPhotos.mockResolvedValue(buildCachedLibrary(8));
    mockPrepareVisionImage.mockResolvedValue(null);

    const outcome = await createQuizFromLibrary();

    expect(outcome.status).toBe('service-error');
    // One re-resolve per candidate - never a second attempt on the same photo.
    expect(mockResolveLoadableUri).toHaveBeenCalledTimes(8);
    expect(mockPrepareVisionImage).toHaveBeenCalledTimes(16);
  });

  it('does not re-resolve when the cached URI still loads', async () => {
    mockGetAllCachedPhotos.mockResolvedValue(buildCachedLibrary(10));
    mockPrepareVisionImage.mockResolvedValue('base64-image');

    const outcome = await createQuizFromLibrary();

    expect(outcome.status).toBe('created');
    expect(mockResolveLoadableUri).not.toHaveBeenCalled();
  });
});

describe('createQuizFromLibrary - home country', () => {
  beforeEach(() => {
    mockPrepareVisionImage.mockResolvedValue('base64-image');
    mockGetAllCountries.mockResolvedValue([...PLACES, HOME].map(({ code }) => ({ code })));
    mockGetHomeCountry.mockResolvedValue('US');
  });

  it('spends no vision budget on home-country photos while travel photos remain', async () => {
    // The real shape of the bug: home life dwarfs the travel photos, and the
    // 70-image budget was being spent on kitchens instead of landscapes.
    mockGetAllCachedPhotos.mockResolvedValue([
      ...buildCachedLibrary(400, [HOME]),
      ...buildCachedLibrary(60),
    ]);

    await createQuizFromLibrary();

    const firstBatch = eligibilityBatches()[0];
    expect(firstBatch).toHaveLength(50);
    expect(firstBatch.every((id) => !id.startsWith('US-'))).toBe(true);
  });

  it('still uses home-country photos when there is nothing else', async () => {
    mockGetAllCachedPhotos.mockResolvedValue(buildCachedLibrary(20, [HOME]));

    const outcome = await createQuizFromLibrary();

    // Deprioritized, not filtered: a user who only shoots at home can still play.
    expect(outcome.status).toBe('created');
    expect(eligibilityBatches()[0].every((id) => id.startsWith('US-'))).toBe(true);
  });
});

describe('createQuizFromLibrary - resampling and declines', () => {
  beforeEach(() => {
    mockPrepareVisionImage.mockResolvedValue('base64-image');
  });

  it('resamples past the 5-photo minimum to fill the game', async () => {
    mockGetAllCachedPhotos.mockResolvedValue(buildCachedLibrary(100));
    // Exactly 6 of the first batch pass - enough to build, short of a full game.
    const passing = new Set<string>();
    verdictFor = (id) => {
      if (passing.size < 6 && !passing.has(id)) {
        passing.add(id);
        return { eligible: true };
      }
      return { eligible: false, reason: 'people_present' };
    };

    const outcome = await createQuizFromLibrary();

    // Previously this stopped at 6 (>= QUIZ_MIN_PHOTOS) and never resampled.
    // It now keeps drawing until the 100-photo pool is exhausted, and builds
    // the 6-photo game only because there was genuinely nothing else to find.
    expect(outcome).toMatchObject({ status: 'created', photoCount: 6 });
    expect(eligibilityBatches().length).toBeGreaterThan(1);
  });

  it('keeps hunting past the old 70-image ceiling on a low pass-rate library', async () => {
    // The reported bug. A big library whose photos pass the vision gate only
    // ~4% of the time (measured on a real 50k library: people/indoor rejections
    // dominate) yielded 2-3 eligible photos out of the first 70 and declined
    // with "Not Enough Photos Yet" - while thousands of untouched photos, more
    // than enough to fill a game, sat in the same library. Finding a batch's
    // worth of candidates is not the end of the search; a full game is.
    mockGetAllCachedPhotos.mockResolvedValue(buildCachedLibrary(600));
    let seen = 0;
    verdictFor = () => {
      seen += 1;
      return seen % 25 === 0 ? { eligible: true } : { eligible: false, reason: 'people_present' };
    };

    const outcome = await createQuizFromLibrary();

    expect(outcome).toMatchObject({ status: 'created', photoCount: 10 });
    const sent = eligibilityBatches().reduce((total, batch) => total + batch.length, 0);
    // 70 images at this pass rate is 2 photos - a decline. A full game needs
    // ~250, and the budget must be what stops the hunt, not the first batch.
    expect(sent).toBeGreaterThan(200);
    expect(sent).toBeLessThanOrEqual(CLASSIFICATION_BUDGET_PER_QUIZ);
  });

  it('stops resampling when the per-draft budget is spent', async () => {
    mockGetAllCachedPhotos.mockResolvedValue(buildCachedLibrary(900));
    verdictFor = () => ({ eligible: false, reason: 'indoor' });

    const outcome = await createQuizFromLibrary();

    expect(outcome.status).toBe('thin-library');
    // The budget is the ceiling, and it is spent in full before declining -
    // no batch may overshoot it.
    const batches = eligibilityBatches();
    const sent = batches.reduce((total, batch) => total + batch.length, 0);
    expect(sent).toBe(CLASSIFICATION_BUDGET_PER_QUIZ);
    expect(batches.length).toBeGreaterThan(2);
  });

  it('stops resampling when the candidate pool runs out', async () => {
    mockGetAllCachedPhotos.mockResolvedValue(buildCachedLibrary(55));
    verdictFor = () => ({ eligible: false, reason: 'category_not_allowed' });

    await createQuizFromLibrary();

    expect(eligibilityBatches().map((batch) => batch.length)).toEqual([50, 5]);
  });

  it('reports the dominant rejection reason on a thin-library decline', async () => {
    mockGetAllCachedPhotos.mockResolvedValue(buildCachedLibrary(60));
    verdictFor = (id) =>
      id.startsWith('FR-')
        ? { eligible: false, reason: 'indoor' }
        : { eligible: false, reason: 'people_present' };

    const outcome = await createQuizFromLibrary();

    expect(outcome).toMatchObject({
      status: 'thin-library',
      hasGeoCandidates: true,
      dominantReason: 'people_present',
    });
  });

  it('tops the batch back up so local failures do not shrink what the gate sees', async () => {
    // ~half the library is unreadable locally (iCloud-offloaded originals).
    // Preparing exactly FIRST_BATCH_MAX candidates then sending the survivors
    // handed the classifier half a batch and burned the budget on the gap.
    mockGetAllCachedPhotos.mockResolvedValue(buildCachedLibrary(400));
    mockResolveLoadableUri.mockResolvedValue(null);
    mockPrepareVisionImage.mockImplementation(async (uri: string) => {
      const index = Number(uri.replace(/\D/g, ''));
      return index % 2 === 0 ? 'base64-image' : null;
    });
    verdictFor = () => ({ eligible: false, reason: 'people_present' });

    await createQuizFromLibrary();

    // Full batches reach the server despite the failures alongside them -
    // every pass, not just the first.
    const batches = eligibilityBatches();
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((batch) => batch.length === 50)).toBe(true);
  });

  it('spends the whole budget on photos the server actually saw', async () => {
    mockGetAllCachedPhotos.mockResolvedValue(buildCachedLibrary(400));
    mockResolveLoadableUri.mockResolvedValue(null);
    mockPrepareVisionImage.mockImplementation(async (uri: string) => {
      const index = Number(uri.replace(/\D/g, ''));
      return index % 2 === 0 ? 'base64-image' : null;
    });
    // Eligible photos are scarce, so the loop keeps drawing to fill the game.
    let passes = 0;
    verdictFor = () => {
      passes += 1;
      return passes % 8 === 0 ? { eligible: true } : { eligible: false, reason: 'indoor' };
    };

    const outcome = await createQuizFromLibrary();

    const sent = eligibilityBatches().reduce((total, batch) => total + batch.length, 0);
    // One photo in eight passes, so a full game costs ~80 images sent. Half
    // the candidates drawn were locally unreadable and never reached the
    // server, so they must not have consumed its per-draft budget: if they
    // had, the run would have hit the cap around 40 photos short of a game.
    expect(outcome).toMatchObject({ status: 'created', photoCount: 10 });
    expect(sent).toBeLessThan(100);
    expect(sent).toBeLessThan(CLASSIFICATION_BUDGET_PER_QUIZ);
  });

  it('keeps hunting when one whole batch is unreadable locally', async () => {
    // iCloud-offloaded originals cluster, so a single draw can come back with
    // nothing preparable. That is a property of those photos, not an outage -
    // but it used to return 'unavailable' and kill a creation that had a
    // library full of readable photos one draw away.
    mockGetAllCachedPhotos.mockResolvedValue(buildCachedLibrary(600));
    mockResolveLoadableUri.mockResolvedValue(null);
    let prepared = 0;
    mockPrepareVisionImage.mockImplementation(async () => {
      prepared += 1;
      // Exactly the first batch's candidate draw (FIRST_BATCH_MAX * OVERSELECT).
      return prepared <= 150 ? null : 'base64-image';
    });

    const outcome = await createQuizFromLibrary();

    expect(outcome).toMatchObject({ status: 'created', photoCount: 10 });
    // The dead first draw reached the server not at all; the next one did.
    expect(eligibilityBatches().length).toBeGreaterThanOrEqual(1);
  });

  it('builds the game it has once the soft deadline passes', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      mockGetAllCachedPhotos.mockResolvedValue(buildCachedLibrary(600));
      let seen = 0;
      verdictFor = () => {
        seen += 1;
        // Six photos found, then the hunt crosses 90s looking for a seventh.
        if (seen === 50) clock.mockReturnValue(1_000_000 + 95_000);
        return seen <= 6 ? { eligible: true } : { eligible: false, reason: 'indoor' };
      };

      const outcome = await createQuizFromLibrary();

      // A playable game in hand beats a longer wait for a fuller one.
      expect(outcome).toMatchObject({ status: 'created', photoCount: 6 });
      expect(eligibilityBatches()).toHaveLength(1);
    } finally {
      clock.mockRestore();
    }
  });

  it('ignores the soft deadline while the game is still short of playable', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      mockGetAllCachedPhotos.mockResolvedValue(buildCachedLibrary(600));
      let seen = 0;
      verdictFor = () => {
        seen += 1;
        // Past the deadline before the first batch is even scored, with far
        // too few photos to build anything.
        clock.mockReturnValue(1_000_000 + 95_000);
        return seen % 25 === 0 ? { eligible: true } : { eligible: false, reason: 'indoor' };
      };

      const outcome = await createQuizFromLibrary();

      // The deadline may end a good hunt early; it must never manufacture a
      // decline, so below QUIZ_MIN_PHOTOS it does not apply at all.
      expect(outcome.status).toBe('created');
      expect(eligibilityBatches().length).toBeGreaterThan(1);
    } finally {
      clock.mockRestore();
    }
  });

  it('blames unreadable photos, not the library, when every prepare fails', async () => {
    mockGetAllCachedPhotos.mockResolvedValue(buildCachedLibrary(60));
    mockPrepareVisionImage.mockResolvedValue(null);

    const outcome = await createQuizFromLibrary();

    // Nothing reached the classifier at all: retryable, not a decline.
    expect(outcome.status).toBe('service-error');
  });
});

describe('createQuizFromLibrary - on-device pre-filter', () => {
  beforeEach(() => {
    mockPrepareVisionImage.mockResolvedValue('base64-image');
  });

  /** Tag row shaped like photoTagDb returns it. */
  function tagRow(id: string, over: Record<string, unknown> = {}) {
    return {
      id,
      taggerVersion: 1,
      status: 'ok',
      isScreenshot: false,
      faceCount: 0,
      maxFaceArea: 0,
      totalFaceArea: 0,
      humanCount: 0,
      maxHumanArea: 0,
      totalHumanArea: 0,
      labels: [],
      aestheticScore: null,
      isUtility: null,
      computedAt: 1_700_000_000_000,
      ...over,
    };
  }

  it('never sends a screenshot to the paid gate', async () => {
    const library = buildCachedLibrary(40);
    const screenshotIds = library.slice(0, 10).map((photo) => photo.id);
    mockGetAllCachedPhotos.mockResolvedValue(library);
    mockGetTagsForIds.mockImplementation(async (ids: string[]) => {
      const map = new Map();
      for (const id of ids) {
        map.set(id, tagRow(id, { isScreenshot: screenshotIds.includes(id) }));
      }
      return map;
    });

    await createQuizFromLibrary();

    const sent = eligibilityBatches().flat();
    for (const id of screenshotIds) expect(sent).not.toContain(id);
  });

  it('never sends a photo whose subject is plainly a person', async () => {
    const library = buildCachedLibrary(40);
    const portraitIds = library.slice(0, 8).map((photo) => photo.id);
    mockGetAllCachedPhotos.mockResolvedValue(library);
    mockGetTagsForIds.mockImplementation(async (ids: string[]) => {
      const map = new Map();
      for (const id of ids) {
        map.set(id, tagRow(id, { maxHumanArea: portraitIds.includes(id) ? 0.6 : 0.02 }));
      }
      return map;
    });

    await createQuizFromLibrary();

    const sent = eligibilityBatches().flat();
    for (const id of portraitIds) expect(sent).not.toContain(id);
  });

  it('still sends indoor photos, just last', async () => {
    // The v1 policy in one test: indoor evidence ranks marginal, never drops.
    // If this ever flips to a drop, it must be a deliberate, telemetry-backed
    // decision - not a silent threshold slip.
    const library = buildCachedLibrary(12);
    mockGetAllCachedPhotos.mockResolvedValue(library);
    mockGetTagsForIds.mockImplementation(async (ids: string[]) => {
      const map = new Map();
      for (const id of ids) {
        map.set(id, tagRow(id, { labels: [{ identifier: 'kitchen', confidence: 0.9 }] }));
      }
      return map;
    });

    await createQuizFromLibrary();

    expect(eligibilityBatches().flat().length).toBeGreaterThan(0);
  });

  it('classifies likely photos before marginal ones', async () => {
    const library = buildCachedLibrary(40);
    const likelyIds = new Set(library.slice(20).map((photo) => photo.id));
    mockGetAllCachedPhotos.mockResolvedValue(library);
    mockGetTagsForIds.mockImplementation(async (ids: string[]) => {
      const map = new Map();
      for (const id of ids) {
        map.set(
          id,
          tagRow(id, {
            labels: likelyIds.has(id)
              ? [{ identifier: 'mountain', confidence: 0.9 }]
              : [{ identifier: 'pizza', confidence: 0.9 }],
          })
        );
      }
      return map;
    });
    // Nothing passes, so the hunt keeps drawing and we can see the full order.
    verdictFor = () => ({ eligible: false, reason: 'indoor' });

    await createQuizFromLibrary();

    const sent = eligibilityBatches().flat();
    const lastLikely = sent.map((id) => likelyIds.has(id)).lastIndexOf(true);
    const firstMarginal = sent.map((id) => likelyIds.has(id)).indexOf(false);

    expect(lastLikely).toBeLessThan(firstMarginal);
  });

  it('degrades to classifying everything when the tag read fails', async () => {
    mockGetAllCachedPhotos.mockResolvedValue(buildCachedLibrary(40));
    mockGetTagsForIds.mockRejectedValue(new Error('db closed'));

    const outcome = await createQuizFromLibrary();

    expect(outcome.status).toBe('created');
    expect(eligibilityBatches().flat().length).toBeGreaterThan(0);
  });

  it('reports a thin library rather than crediting the pre-filter with the decline', async () => {
    const library = buildCachedLibrary(20);
    mockGetAllCachedPhotos.mockResolvedValue(library);
    // Everything is a screenshot: the pool is non-empty but nothing survives.
    mockGetTagsForIds.mockImplementation(async (ids: string[]) => {
      const map = new Map();
      for (const id of ids) map.set(id, tagRow(id, { isScreenshot: true }));
      return map;
    });

    const outcome = await createQuizFromLibrary();

    expect(outcome.status).toBe('thin-library');
    // Photos DO exist and are geocoded - the decline copy must not claim the
    // user has no geotagged travel photos.
    expect(outcome).toMatchObject({ hasGeoCandidates: true });
  });
});

describe('createQuizFromLibrary - verdict cache', () => {
  beforeEach(() => {
    mockPrepareVisionImage.mockResolvedValue('base64-image');
  });

  const verdict = (id: string, eligible: boolean, landscape: string | null = null) => [
    id,
    {
      id,
      eligible,
      reason: eligible ? null : 'indoor',
      landscape,
      classifierVersion: 'gemini-2.5-flash-lite/v1',
      classifiedAt: 1_700_000_000_000,
    },
  ];

  it('persists both eligible and ineligible verdicts after a batch', async () => {
    mockGetAllCachedPhotos.mockResolvedValue(buildCachedLibrary(20));
    verdictFor = (id: string) =>
      id.startsWith('FR') ? { eligible: true } : { eligible: false, reason: 'people_present' };

    await createQuizFromLibrary();

    expect(mockUpsertVerdicts).toHaveBeenCalled();
    const written = mockUpsertVerdicts.mock.calls.flatMap((call) => call[0]);
    // The ineligible half is the valuable half: it is what stops the next hunt
    // from re-drawing photos this one already paid to reject.
    expect(written.some((row: { eligible: boolean }) => row.eligible)).toBe(true);
    expect(written.some((row: { eligible: boolean }) => !row.eligible)).toBe(true);
  });

  it('skips classification entirely when the cache already fills the game', async () => {
    const library = buildCachedLibrary(40);
    mockGetAllCachedPhotos.mockResolvedValue(library);
    mockGetAllVerdicts.mockResolvedValue(
      new Map(library.map((photo) => verdict(photo.id, true, 'alpine')) as [string, object][])
    );

    const outcome = await createQuizFromLibrary();

    expect(outcome.status).toBe('created');
    // The whole point: a repeat creation becomes upload-bound.
    expect(eligibilityBatches()).toHaveLength(0);
  });

  it('carries the cached landscape into the finalized questions', async () => {
    const library = buildCachedLibrary(40);
    mockGetAllCachedPhotos.mockResolvedValue(library);
    mockGetAllVerdicts.mockResolvedValue(
      new Map(library.map((photo) => verdict(photo.id, true, 'alpine')) as [string, object][])
    );

    await createQuizFromLibrary();

    const finalize = mockApi.post.mock.calls.find(([url]) => url.endsWith('/finalize'));
    expect(finalize).toBeDefined();
    // Landscape has no local source other than the gate, so without the cache
    // a seeded game would build blind decoys.
    for (const photo of finalize![1].photos) expect(photo.landscape).toBe('alpine');
  });

  it('never re-draws a photo the cache says is ineligible', async () => {
    const library = buildCachedLibrary(40);
    const rejectedIds = library.slice(0, 20).map((photo) => photo.id);
    mockGetAllCachedPhotos.mockResolvedValue(library);
    mockGetAllVerdicts.mockResolvedValue(
      new Map(rejectedIds.map((id) => verdict(id, false)) as [string, object][])
    );

    await createQuizFromLibrary();

    const sent = eligibilityBatches().flat();
    for (const id of rejectedIds) expect(sent).not.toContain(id);
  });

  it('ignores verdicts from a different classifier version', async () => {
    // A prompt or model fix must take effect immediately, not be masked by a
    // cache full of answers the old classifier gave.
    const library = buildCachedLibrary(40);
    mockGetAllCachedPhotos.mockResolvedValue(library);
    mockGetAllVerdicts.mockResolvedValue(
      new Map(
        library.map((photo) => [
          photo.id,
          {
            id: photo.id,
            eligible: true,
            reason: null,
            landscape: 'alpine',
            classifierVersion: 'some-older-model/v0',
            classifiedAt: 1,
          },
        ])
      )
    );

    await createQuizFromLibrary();

    expect(eligibilityBatches().flat().length).toBeGreaterThan(0);
  });

  it('tops the game up from the gate when the cache only partly fills it', async () => {
    const library = buildCachedLibrary(40);
    const cachedEligible = library.slice(0, 3).map((photo) => photo.id);
    mockGetAllCachedPhotos.mockResolvedValue(library);
    mockGetAllVerdicts.mockResolvedValue(
      new Map(cachedEligible.map((id) => verdict(id, true, 'coastal')) as [string, object][])
    );

    const outcome = await createQuizFromLibrary();

    expect(outcome.status).toBe('created');
    const sent = eligibilityBatches().flat();
    expect(sent.length).toBeGreaterThan(0);
    // Seeded photos are already decided; spending gate budget on them again
    // would be paying twice for the same answer.
    for (const id of cachedEligible) expect(sent).not.toContain(id);
  });

  it('degrades to classifying everything when the verdict read fails', async () => {
    mockGetAllCachedPhotos.mockResolvedValue(buildCachedLibrary(40));
    mockGetAllVerdicts.mockRejectedValue(new Error('db closed'));

    const outcome = await createQuizFromLibrary();

    expect(outcome.status).toBe('created');
    expect(eligibilityBatches().flat().length).toBeGreaterThan(0);
  });
});

describe('createQuizFromLibrary - progress pick URIs', () => {
  beforeEach(() => {
    mockPrepareVisionImage.mockResolvedValue('base64-image');
  });

  /** The library URI for a cached photo id (`${code}-${index}` -> `asset-${index}`). */
  const uriFor = (id: string) => `file:///stale/asset-${id.slice(id.indexOf('-') + 1)}.jpg`;

  it('grows the found list monotonically across hunt passes, without rejected photos', async () => {
    // Low pass rate forces several classification passes, so the list must
    // survive - and only grow across - many emissions, not just one batch.
    mockGetAllCachedPhotos.mockResolvedValue(buildCachedLibrary(600));
    const eligibleIds = new Set<string>();
    let seen = 0;
    verdictFor = (id) => {
      seen += 1;
      if (seen % 25 === 0) {
        eligibleIds.add(id);
        return { eligible: true };
      }
      return { eligible: false, reason: 'people_present' };
    };

    const emissions: QuizCreationProgress[] = [];
    const outcome = await createQuizFromLibrary({
      onProgress: (progress) => emissions.push(progress),
    });

    expect(outcome).toMatchObject({ status: 'created', photoCount: 10 });

    const lists = emissions
      .filter((progress) => progress.step === 'checking')
      .map((progress) => progress.pickUris);
    expect(lists.length).toBeGreaterThan(0);
    for (const list of lists) expect(list).toBeDefined();
    // Found order is stable: every emission extends the previous one, so the
    // hero slot (the most recent entry) only changes when a NEW photo is found.
    for (let index = 1; index < lists.length; index++) {
      expect(lists[index]!.slice(0, lists[index - 1]!.length)).toEqual(lists[index - 1]);
    }
    const final = lists[lists.length - 1]!;
    expect(final).toHaveLength(10);
    // Only photos the gate passed may appear - never a rejected candidate's URI.
    const eligibleUris = new Set([...eligibleIds].map(uriFor));
    for (const uri of final) expect(eligibleUris.has(uri)).toBe(true);
  });

  it('keeps the found count and the URI list in agreement on every hunt emission', async () => {
    mockGetAllCachedPhotos.mockResolvedValue(buildCachedLibrary(40));
    verdictFor = (id) =>
      id.startsWith('FR-') ? { eligible: true } : { eligible: false, reason: 'people_present' };

    const emissions: QuizCreationProgress[] = [];
    await createQuizFromLibrary({ onProgress: (progress) => emissions.push(progress) });

    const checking = emissions.filter((progress) => progress.step === 'checking');
    expect(checking.length).toBeGreaterThan(0);
    for (const progress of checking) {
      expect(progress.pickUris).toBeDefined();
      expect(progress.current).toBe(progress.pickUris!.length);
    }
  });

  it('retains the full pick list on upload-phase emissions', async () => {
    mockGetAllCachedPhotos.mockResolvedValue(buildCachedLibrary(20));

    const emissions: QuizCreationProgress[] = [];
    const outcome = await createQuizFromLibrary({
      onProgress: (progress) => emissions.push(progress),
    });

    expect(outcome.status).toBe('created');
    if (outcome.status !== 'created') throw new Error('unreachable');
    const building = emissions.filter((progress) => progress.step === 'building');
    expect(building.length).toBeGreaterThan(0);
    for (const progress of building) {
      expect(progress.pickUris).toHaveLength(outcome.photoCount);
    }
    // The same list, in the same order, from the first upload tick to the last:
    // the redesigned screen keeps all thumbnails visible through the upload.
    expect(new Set(building.map((progress) => JSON.stringify(progress.pickUris))).size).toBe(1);
  });

  it('never resets the preview across the hunt -> upload handover', async () => {
    // THE REPORTED BUG. The hunt used to preview the raw eligible list while
    // the game was chosen afterwards by an independent pass (de-dupe,
    // re-order, diversity), so at the handover the grid swapped photos,
    // shuffled the survivors and shrank - part-way through a 90-second wait
    // it looked like the build had crashed and started over.
    //
    // The library is deliberately hostile to the old code: burst siblings and
    // same-day repeats are exactly what the second pass used to remove.
    const library = [
      ...buildCachedLibrary(24),
      // Burst siblings of the first photo: seconds apart, metres away.
      ...[1, 2].map(
        (offset) =>
          ({
            id: `FR-burst-${offset}`,
            uri: `file:///stale/asset-burst-${offset}.jpg`,
            filename: `asset-burst-${offset}.jpg`,
            creationTime: Date.UTC(2024, 0, 1, 12) + offset * 4_000,
            latitude: PLACES[0].latitude,
            longitude: PLACES[0].longitude,
            countryCode: PLACES[0].code,
          }) as CachedPhoto
      ),
    ];
    mockGetAllCachedPhotos.mockResolvedValue(library);

    const emissions: QuizCreationProgress[] = [];
    const outcome = await createQuizFromLibrary({
      onProgress: (progress) => emissions.push(progress),
    });
    expect(outcome.status).toBe('created');

    // Every emission that carries a list, hunt and upload alike, in order.
    const lists = emissions
      .map((progress) => progress.pickUris)
      .filter((uris): uris is string[] => uris !== undefined);
    expect(lists.length).toBeGreaterThan(1);
    // Append-only: each list is a prefix of the next. A swap, a reorder or a
    // drop anywhere in the run breaks this.
    for (let index = 1; index < lists.length; index++) {
      expect(lists[index].slice(0, lists[index - 1].length)).toEqual(lists[index - 1]);
    }
    // And there IS a handover to survive: the run crossed into the upload
    // phase, and the photos it uploads are the photos it previewed.
    const building = emissions.filter((progress) => progress.step === 'building');
    expect(building.length).toBeGreaterThan(0);
    const lastHunt = emissions.filter((progress) => progress.step === 'checking').at(-1)!;
    expect(building[0].pickUris!.slice(0, lastHunt.pickUris!.length)).toEqual(lastHunt.pickUris);
    // BUG-2 still holds: at most ONE frame of the burst reaches the game
    // (which frame is immaterial - they are the same photo to a player).
    const final = lists[lists.length - 1];
    const burstGroup = ['asset-0.jpg', 'asset-burst-1.jpg', 'asset-burst-2.jpg'];
    expect(
      final.filter((uri) => burstGroup.some((frame) => uri.endsWith(frame))).length
    ).toBeLessThanOrEqual(1);
    expect(new Set(final).size).toBe(final.length);
  });

  it('never moves the progress meter backwards', async () => {
    mockGetAllCachedPhotos.mockResolvedValue(buildCachedLibrary(60));
    let seen = 0;
    verdictFor = () => {
      seen += 1;
      return seen % 4 === 0 ? { eligible: true } : { eligible: false, reason: 'indoor' };
    };

    const emissions: QuizCreationProgress[] = [];
    const outcome = await createQuizFromLibrary({
      onProgress: (progress) => emissions.push(progress),
    });
    expect(outcome.status).toBe('created');

    // The screen draws one meter across both phases, so the two steps must
    // hand over without the fraction dropping: the hunt fills the first part
    // of the bar, the upload the rest.
    const HUNT_SHARE = 0.7;
    let previous = -1;
    for (const progress of emissions) {
      if (progress.step === 'scanning') continue;
      if (progress.current === undefined || !progress.total) continue;
      const within = progress.current / progress.total;
      const fraction =
        progress.step === 'building' ? HUNT_SHARE + (1 - HUNT_SHARE) * within : HUNT_SHARE * within;
      expect(fraction).toBeGreaterThanOrEqual(previous);
      previous = fraction;
    }
  });

  it('carries the persisted picks through a resumed upload', async () => {
    const picks = Array.from({ length: 5 }, (_, index) => ({
      assetId: `FR-${index}`,
      uri: `file:///stale/asset-${index}.jpg`,
      countryCode: 'FR',
      storagePath: null,
      uploaded: false,
      landscape: null,
    }));
    mockGetMetadata.mockImplementation(async (key: string) =>
      key === 'quiz_draft_state' ? JSON.stringify({ quizId: 'quiz-9', createdAt: 1, picks }) : null
    );

    const emissions: QuizCreationProgress[] = [];
    const outcome = await createQuizFromLibrary({
      onProgress: (progress) => emissions.push(progress),
    });

    expect(outcome).toMatchObject({ status: 'created', quizId: 'quiz-9' });
    const building = emissions.filter((progress) => progress.step === 'building');
    expect(building.length).toBeGreaterThan(0);
    for (const progress of building) {
      expect(progress.pickUris).toEqual(picks.map((pick) => pick.uri));
    }
  });
});
