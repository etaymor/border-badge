/**
 * Suspend/resume for a Guess Where build.
 *
 * The claim under test is narrow and expensive to get wrong: a build that iOS
 * suspends mid-hunt must come back to the SAME game — same photos, same slot
 * order — without re-buying a single classification it already paid for.
 *
 * These tests drive `advanceQuizBuild` directly rather than
 * `createQuizFromLibrary`, because a suspend is exactly "stop calling advance
 * for a while, drop the process's memory, then call it again with the
 * checkpoint". That is what `resumeFrom` below simulates.
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
  getMetadata: jest.fn(),
  setMetadata: jest.fn(),
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
import { getAllCachedPhotos, getMetadata, setMetadata } from '@services/photoImport/photoCacheDb';
import { getAllVerdicts, getTagsForIds } from '@services/photoImport/photoTagDb';
import { resolveLoadableUri } from '@services/photoImport/resolveLoadableUri';
import { prepareVisionImage } from '@services/photoImport/visionPhoto';
import { CLASSIFICATION_BUDGET_PER_QUIZ } from '@services/quiz/candidateSelection';
import { createPickLedger } from '@services/quiz/pickLedger';
import { advanceQuizBuild, beginQuizRun, readQuizRunOutcome } from '@services/quiz/quizBuildSteps';
import {
  initialQuizCheckpoint,
  isPast,
  rehydrateLedger,
  stageIndex,
} from '@services/quiz/quizCheckpoint';
import type { QuizBuildCheckpoint } from '@services/quiz/quizCheckpoint';

import type { CachedPhoto } from '@services/photoImport/types';
import type { GeoEligibleCandidate } from '@services/quiz/candidateSelection';
import type { QuizCreationOutcome } from '@services/quiz/quizCreationTypes';

const mockApi = api as unknown as { post: jest.Mock; delete: jest.Mock };
const mockGetAllCountries = getAllCountries as jest.Mock;
const mockGetHomeCountry = getHomeCountry as jest.Mock;
const mockEnsureFreshLibrary = ensureFreshLibrary as jest.Mock;
const mockGetAllCachedPhotos = getAllCachedPhotos as jest.Mock;
const mockGetMetadata = getMetadata as jest.Mock;
const mockSetMetadata = setMetadata as jest.Mock;
const mockGetTagsForIds = getTagsForIds as jest.Mock;
const mockGetAllVerdicts = getAllVerdicts as jest.Mock;
const mockPrepareVisionImage = prepareVisionImage as jest.Mock;
const mockResolveLoadableUri = resolveLoadableUri as jest.Mock;

const PLACES = [
  { code: 'FR', latitude: 46.6, longitude: 2.4 },
  { code: 'JP', latitude: 36.2, longitude: 138.3 },
  { code: 'PE', latitude: -9.2, longitude: -75.0 },
  { code: 'IS', latitude: 64.9, longitude: -19.0 },
  { code: 'IT', latitude: 42.8, longitude: 12.5 },
];

function buildCachedLibrary(count: number): CachedPhoto[] {
  return Array.from({ length: count }, (_, index) => {
    const place = PLACES[index % PLACES.length];
    return {
      id: `${place.code}-${index}`,
      uri: `file:///stale/asset-${index}.jpg`,
      filename: `asset-${index}.jpg`,
      creationTime: Date.UTC(2024, 0, 1 + index, 12),
      latitude: place.latitude,
      longitude: place.longitude,
      countryCode: place.code,
    } as CachedPhoto;
  });
}

/** Ids sent to /quiz/eligibility, one array per request, in order. */
function eligibilityBatches(): string[][] {
  return mockApi.post.mock.calls
    .filter(([url]) => url === '/quiz/eligibility')
    .map(([, body]) => body.images.map((image: { id: string }) => image.id));
}

/**
 * A tiny in-memory stand-in for the photo-cache metadata table, so the draft
 * store genuinely persists across a simulated suspend. Without it a resume
 * would read `null` for the draft and take a path the real device never takes.
 */
let metadata: Record<string, string>;

beforeEach(() => {
  jest.clearAllMocks();
  metadata = {};
  mockGetMetadata.mockImplementation(async (key: string) => metadata[key] ?? null);
  mockSetMetadata.mockImplementation(async (key: string, value: string) => {
    metadata[key] = value;
  });

  mockGetAllCountries.mockResolvedValue(PLACES.map((place) => ({ code: place.code })));
  mockEnsureFreshLibrary.mockResolvedValue({ status: 'refreshed', newPhotos: 0 });
  mockGetHomeCountry.mockResolvedValue(null);
  mockGetTagsForIds.mockResolvedValue(new Map());
  mockGetAllVerdicts.mockResolvedValue(new Map());
  mockResolveLoadableUri.mockImplementation(async (assetId: string) =>
    assetId ? `file:///fresh/${assetId}.jpg` : null
  );
  mockPrepareVisionImage.mockResolvedValue('base64');
  mockGetAllCachedPhotos.mockResolvedValue(buildCachedLibrary(120));

  let classified = 0;
  mockApi.post.mockImplementation(async (url: string, body: { images?: Array<{ id: string }> }) => {
    if (url === '/quiz') {
      classified = 0;
      return { data: { id: 'quiz-1', state: 'draft' } };
    }
    if (url === '/quiz/eligibility') {
      const images = body?.images ?? [];
      classified += images.length;
      return {
        data: {
          results: images.map((image) => ({
            id: image.id,
            // Only one in five passes, so the hunt genuinely takes several
            // passes and there is a real mid-hunt state to suspend from.
            eligible: Number(image.id.split('-')[1]) % 5 === 0,
            status: Number(image.id.split('-')[1]) % 5 === 0 ? 'eligible' : 'ineligible',
            reason: null,
            landscape: null,
          })),
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

const env = {};

/** Advance until `stop` says so, or the build ends. Returns the checkpoint. */
async function drive(
  start: QuizBuildCheckpoint,
  stop: (checkpoint: QuizBuildCheckpoint) => boolean
): Promise<QuizBuildCheckpoint> {
  let checkpoint = start;
  for (let step = 0; step < 200; step++) {
    if (checkpoint.stage === 'done' || stop(checkpoint)) break;
    checkpoint = await advanceQuizBuild(env, checkpoint);
  }
  return checkpoint;
}

/**
 * Drop everything the process held and start advancing again from a
 * checkpoint — exactly what a foreground resume does after iOS reclaimed the
 * JS runtime.
 */
async function resumeFrom(checkpoint: QuizBuildCheckpoint): Promise<{
  checkpoint: QuizBuildCheckpoint;
  outcome: QuizCreationOutcome | null;
}> {
  beginQuizRun();
  const parsed = JSON.parse(JSON.stringify(checkpoint)) as QuizBuildCheckpoint;
  const final = await drive(parsed, () => false);
  return { checkpoint: final, outcome: readQuizRunOutcome() };
}

describe('quizCheckpoint - stage ordering', () => {
  it('orders the stages so a later one is never re-run', () => {
    expect(stageIndex('draft-check')).toBeLessThan(stageIndex('setup'));
    expect(stageIndex('setup')).toBeLessThan(stageIndex('hunt'));
    expect(stageIndex('hunt')).toBeLessThan(stageIndex('settle'));
    expect(stageIndex('settle')).toBeLessThan(stageIndex('upload'));
    expect(stageIndex('upload')).toBeLessThan(stageIndex('done'));
  });

  it('treats an unknown stage as the start rather than throwing', () => {
    const checkpoint = { ...initialQuizCheckpoint(300), stage: 'from-the-future' as never };
    expect(isPast(checkpoint, 'draft-check')).toBe(false);
  });
});

describe('rehydrateLedger', () => {
  const candidate = (id: string, code: string, day: number): GeoEligibleCandidate =>
    ({
      id,
      uri: `file:///${id}.jpg`,
      filename: `${id}.jpg`,
      creationTime: Date.UTC(2024, 0, day, 12),
      countryCode: code,
      latitude: 0,
      longitude: 0,
    }) as GeoEligibleCandidate;

  it('reproduces the exact slot order from ids alone', () => {
    const pool = [
      candidate('a', 'FR', 1),
      candidate('b', 'JP', 2),
      candidate('c', 'PE', 3),
      candidate('d', 'IS', 4),
    ];
    const poolById = new Map(pool.map((item) => [item.id, item]));

    const original = createPickLedger();
    for (const item of pool) original.offer(item);
    const expected = original.picks.map((pick) => pick.id);

    const restored = createPickLedger();
    const count = rehydrateLedger(expected, poolById, restored);

    expect(count).toBe(expected.length);
    expect(restored.picks.map((pick) => pick.id)).toEqual(expected);
  });

  it('skips an id the library no longer holds instead of failing the resume', () => {
    const pool = [candidate('a', 'FR', 1), candidate('c', 'PE', 3)];
    const poolById = new Map(pool.map((item) => [item.id, item]));
    const ledger = createPickLedger();

    // 'b' was deleted from the library while the app was suspended.
    const count = rehydrateLedger(['a', 'b', 'c'], poolById, ledger);

    expect(count).toBe(2);
    expect(ledger.picks.map((pick) => pick.id)).toEqual(['a', 'c']);
  });
});

describe('advanceQuizBuild - resume after a suspend', () => {
  it('checkpoints a hunt pass at a time rather than the whole build', async () => {
    beginQuizRun();
    const first = await drive(
      initialQuizCheckpoint(CLASSIFICATION_BUDGET_PER_QUIZ),
      (checkpoint) => checkpoint.passes >= 1
    );

    expect(first.stage).toBe('hunt');
    expect(first.passes).toBe(1);
    expect(first.quizId).toBe('quiz-1');
    // The expensive facts are all in the checkpoint, not only in memory.
    expect(first.sentCount).toBeGreaterThan(0);
    expect(first.classifiedIds.length).toBeGreaterThan(0);
  });

  it('comes back to the same slots, in the same order', async () => {
    beginQuizRun();
    const suspended = await drive(
      initialQuizCheckpoint(CLASSIFICATION_BUDGET_PER_QUIZ),
      (checkpoint) => checkpoint.pickAssetIds.length >= 2
    );
    const before = [...suspended.pickAssetIds];
    expect(before.length).toBeGreaterThanOrEqual(2);

    const { checkpoint, outcome } = await resumeFrom(suspended);

    expect(outcome?.status).toBe('created');
    // The replayed slots stay at the FRONT of the ledger, in their original
    // order: nothing the resumed hunt found could take a slot the user had
    // already watched fill.
    expect(checkpoint.pickAssetIds.slice(0, before.length)).toEqual(before);
    // And they are all still in the finished game. (`markAssetsUsed` records
    // exactly what shipped; its order is the QUESTION order, which `settle`
    // deliberately re-spreads by country, so only membership is asserted.)
    const used = JSON.parse(metadata['quiz_used_asset_ids']) as string[];
    for (const id of before) expect(used).toContain(id);
  });

  it('never re-sends a photo the interrupted run already classified', async () => {
    beginQuizRun();
    const suspended = await drive(
      initialQuizCheckpoint(CLASSIFICATION_BUDGET_PER_QUIZ),
      (checkpoint) => checkpoint.passes >= 1
    );
    const alreadySent = new Set(eligibilityBatches().flat());
    expect(alreadySent.size).toBeGreaterThan(0);

    mockApi.post.mockClear();
    await resumeFrom(suspended);

    const resent = eligibilityBatches()
      .flat()
      .filter((id) => alreadySent.has(id));
    expect(resent).toEqual([]);
  });

  it('carries the spend meter across the suspend so the budget is not doubled', async () => {
    beginQuizRun();
    const suspended = await drive(
      initialQuizCheckpoint(CLASSIFICATION_BUDGET_PER_QUIZ),
      (checkpoint) => checkpoint.passes >= 1
    );
    const spentBefore = suspended.sentCount;
    expect(spentBefore).toBeGreaterThan(0);

    const { checkpoint } = await resumeFrom(suspended);

    // The resumed run only ever ADDS to what the interrupted one spent.
    expect(checkpoint.sentCount).toBeGreaterThanOrEqual(spentBefore);
    expect(checkpoint.sentCount).toBeLessThanOrEqual(CLASSIFICATION_BUDGET_PER_QUIZ);
  });

  it('resumes straight into uploads when the hunt had already settled', async () => {
    beginQuizRun();
    const settled = await drive(
      initialQuizCheckpoint(CLASSIFICATION_BUDGET_PER_QUIZ),
      (checkpoint) => checkpoint.stage === 'upload'
    );
    expect(settled.stage).toBe('upload');

    mockApi.post.mockClear();
    const { outcome } = await resumeFrom(settled);

    expect(outcome?.status).toBe('created');
    // Not one image went back through the paid gate.
    expect(eligibilityBatches()).toEqual([]);
  });
});
