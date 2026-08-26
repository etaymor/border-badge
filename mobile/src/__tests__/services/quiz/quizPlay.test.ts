/**
 * Tests for the persisted owner play state (quizPlay.ts).
 *
 * R17 regression coverage: play state is keyed PER QUIZ. A single shared
 * storage key let a second quiz's play session clobber the first quiz's
 * seeding session, permanently blocking share on the first quiz
 * (QUIZ_OWNER_ANSWERS_INCOMPLETE). These tests prove two quizzes keep fully
 * independent play state.
 */

import { api } from '@services/api';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// In-memory stand-in for the photo-cache metadata table.
const mockMetadataStore = new Map<string, string>();

jest.mock('@services/photoImport/photoCacheDb', () => ({
  getAllCachedPhotos: jest.fn().mockResolvedValue([]),
  getMetadata: jest.fn(async (key: string) => mockMetadataStore.get(key) ?? null),
  setMetadata: jest.fn(async (key: string, value: string) => {
    mockMetadataStore.set(key, value);
  }),
}));

// The creation orchestration drags in the photo-import stack; play state never runs it.
jest.mock('@services/quiz/quizCreation', () => ({
  getUsedAssetIds: jest.fn().mockResolvedValue(new Set()),
  markAssetsUsed: jest.fn(),
  prepareQuizUploadImage: jest.fn(),
}));

jest.mock('@services/countriesDb', () => ({
  getAllCountries: jest.fn().mockResolvedValue([]),
}));

jest.mock('@services/photoImport/countryCoder', () => ({
  iso1A2Code: jest.fn(() => null),
}));

jest.mock('@services/photoImport/photoTagDb', () => ({
  getTagsForIds: jest.fn().mockResolvedValue(new Map()),
  getAllVerdicts: jest.fn().mockResolvedValue(new Map()),
  upsertVerdicts: jest.fn().mockResolvedValue(undefined),
}));

import {
  clearStoredAnswer,
  ensurePlaySession,
  loadPlayState,
  loadSwapCandidates,
  recordAnswer,
  savePlayState,
  type QuizPlayState,
  type StoredQuizAnswer,
} from '@services/quiz/quizPlay';
import { getQuizAssetIds, recordQuizAssets } from '@services/quiz/quizAssets';
import { getAllCachedPhotos } from '@services/photoImport/photoCacheDb';
import { getAllCountries } from '@services/countriesDb';
import { getAllVerdicts, getTagsForIds } from '@services/photoImport/photoTagDb';
import { QUIZ_CLASSIFIER_VERSION } from '@services/quiz/quizVerdictStore';
import type { CachedPhoto } from '@services/photoImport/types';

const mockApiPost = api.post as jest.Mock;
const mockGetAllCachedPhotos = getAllCachedPhotos as jest.MockedFunction<typeof getAllCachedPhotos>;
const mockGetAllCountries = getAllCountries as jest.MockedFunction<typeof getAllCountries>;
const mockGetTagsForIds = getTagsForIds as jest.Mock;
const mockGetAllVerdicts = getAllVerdicts as jest.Mock;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAnswer(questionId: string, overrides?: Partial<StoredQuizAnswer>): StoredQuizAnswer {
  return {
    questionId,
    selectedOptionIndex: 0,
    placeCorrect: true,
    correctOptionIndex: 0,
    correctOption: 'France',
    ...overrides,
  };
}

function makeState(quizId: string, sessionId: string, answeredIds: string[] = []): QuizPlayState {
  return {
    quizId,
    sessionId,
    answers: Object.fromEntries(answeredIds.map((id) => [id, makeAnswer(id)])),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockMetadataStore.clear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('quizPlay persisted state (per-quiz keys, R17)', () => {
  it('keeps two quizzes fully independent: saving one never touches the other', async () => {
    const stateA = makeState('quiz-a', 'session-a', ['qa1', 'qa2']);
    const stateB = makeState('quiz-b', 'session-b', ['qb1']);

    await savePlayState(stateA);
    await savePlayState(stateB);

    // Writing quiz B's state did not clobber quiz A's.
    await expect(loadPlayState('quiz-a')).resolves.toEqual(stateA);
    await expect(loadPlayState('quiz-b')).resolves.toEqual(stateB);
  });

  it('starting a second quiz session preserves the first quiz seeding session', async () => {
    mockApiPost.mockImplementation(async (url: string) => {
      if (url === '/quiz/quiz-a/play') return { data: { session_id: 'session-a' } };
      if (url === '/quiz/quiz-b/play') return { data: { session_id: 'session-b' } };
      throw new Error(`Unexpected POST ${url}`);
    });

    const sessionA = await ensurePlaySession('quiz-a');
    const progressed = await recordAnswer(sessionA, makeAnswer('qa1'));
    expect(progressed.answers.qa1).toBeTruthy();

    // The owner starts an independent second quiz (R17).
    const sessionB = await ensurePlaySession('quiz-b');
    expect(sessionB.sessionId).toBe('session-b');

    // Quiz A's seeding session id and graded progress both survive.
    const reloadedA = await loadPlayState('quiz-a');
    expect(reloadedA?.sessionId).toBe('session-a');
    expect(reloadedA?.answers.qa1).toBeTruthy();

    // Re-entering quiz A resumes the persisted session, not a fresh one.
    const resumedA = await ensurePlaySession('quiz-a');
    expect(resumedA.sessionId).toBe('session-a');
    expect(mockApiPost).toHaveBeenCalledTimes(2);
  });

  it('clearStoredAnswer only drops the answer from its own quiz', async () => {
    await savePlayState(makeState('quiz-a', 'session-a', ['q1']));
    await savePlayState(makeState('quiz-b', 'session-b', ['q1']));

    await clearStoredAnswer('quiz-b', 'q1');

    const stateA = await loadPlayState('quiz-a');
    const stateB = await loadPlayState('quiz-b');
    expect(stateA?.answers.q1).toBeTruthy();
    expect(stateB?.answers.q1).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Swap picker exclusions (BUG-2)
// ---------------------------------------------------------------------------

describe('loadSwapCandidates (BUG-2: never re-offer the quiz its own photos)', () => {
  const ROME = { latitude: 41.9029, longitude: 12.4534 };

  function makeCached(id: string, overrides: Partial<CachedPhoto> = {}): CachedPhoto {
    return {
      id,
      uri: `file:///photos/${id}.jpg`,
      filename: `${id}.jpg`,
      creationTime: 1_700_000_000_000,
      latitude: ROME.latitude,
      longitude: ROME.longitude,
      geohash: 'sr2yk3h',
      countryCode: 'IT',
      ...overrides,
    };
  }

  beforeEach(() => {
    mockGetAllCountries.mockResolvedValue([{ code: 'IT', name: 'Italy' }] as Awaited<
      ReturnType<typeof getAllCountries>
    >);
  });

  it('excludes the quiz own assets and their near-duplicates from the picker', async () => {
    // asset-1 is IN the quiz. asset-2 is a burst sibling of asset-1 (seconds
    // apart, same spot). asset-3 is a genuinely different photo.
    const inQuiz = makeCached('asset-1');
    const burstSibling = makeCached('asset-2', {
      creationTime: inQuiz.creationTime + 8_000,
      latitude: ROME.latitude + 0.00004,
    });
    const distinct = makeCached('asset-3', {
      creationTime: inQuiz.creationTime + 6 * 3_600_000,
      latitude: 45.44,
      longitude: 12.33,
    });
    mockGetAllCachedPhotos.mockResolvedValue([inQuiz, burstSibling, distinct]);
    await recordQuizAssets('quiz-a', ['asset-1']);

    const candidates = await loadSwapCandidates('quiz-a');

    expect(candidates.map((candidate) => candidate.id)).toEqual(['asset-3']);
  });

  it('scopes recorded quiz assets per quiz', async () => {
    await recordQuizAssets('quiz-a', ['asset-1', 'asset-2']);
    await recordQuizAssets('quiz-b', ['asset-9']);
    await recordQuizAssets('quiz-a', ['asset-2', 'asset-3']);

    await expect(getQuizAssetIds('quiz-a')).resolves.toEqual(
      new Set(['asset-1', 'asset-2', 'asset-3'])
    );
    await expect(getQuizAssetIds('quiz-b')).resolves.toEqual(new Set(['asset-9']));
  });

  it('excludes photos from the same day as an existing quiz photo', async () => {
    // The quiz holds a Rome photo from one day; a distinct shot from that
    // same day (different venue, hours later) must not be offered as a swap -
    // same-day photos never share a game.
    const inQuiz = makeCached('asset-1', { creationTime: Date.UTC(2023, 5, 15, 10, 0, 0) });
    const sameDayElsewhere = makeCached('asset-2', {
      creationTime: Date.UTC(2023, 5, 15, 18, 0, 0),
      latitude: 45.44,
      longitude: 9.19,
    });
    const otherDay = makeCached('asset-3', {
      creationTime: Date.UTC(2023, 8, 2, 12, 0, 0),
      latitude: 40.85,
      longitude: 14.27,
    });
    mockGetAllCachedPhotos.mockResolvedValue([inQuiz, sameDayElsewhere, otherDay]);
    await recordQuizAssets('quiz-a', ['asset-1']);

    const candidates = await loadSwapCandidates('quiz-a');

    expect(candidates.map((candidate) => candidate.id)).toEqual(['asset-3']);
  });
});

// ---------------------------------------------------------------------------
// Swap picker quality (verdict cache + on-device tags)
// ---------------------------------------------------------------------------

describe('loadSwapCandidates - free local knowledge', () => {
  const ROME = { latitude: 41.9029, longitude: 12.4534 };

  function makeCached(id: string, dayOffset: number): CachedPhoto {
    return {
      id,
      uri: `file:///photos/${id}.jpg`,
      filename: `${id}.jpg`,
      // Distinct days so the same-day-as-quiz exclusion does not interfere.
      creationTime: Date.UTC(2024, 0, 1 + dayOffset, 12),
      latitude: ROME.latitude,
      longitude: ROME.longitude,
      geohash: 'sr2yk3h',
      countryCode: 'IT',
    };
  }

  const verdictRow = (id: string, eligible: boolean, landscape: string | null = null) => ({
    id,
    eligible,
    reason: eligible ? null : 'people_present',
    landscape,
    classifierVersion: QUIZ_CLASSIFIER_VERSION,
    classifiedAt: 1_700_000_000_000,
  });

  beforeEach(() => {
    mockGetAllCountries.mockResolvedValue([{ code: 'IT', name: 'Italy' }] as Awaited<
      ReturnType<typeof getAllCountries>
    >);
    mockGetTagsForIds.mockResolvedValue(new Map());
    mockGetAllVerdicts.mockResolvedValue(new Map());
  });

  it('never offers a photo the gate already rejected', async () => {
    // Swaps spend no vision budget, so before the cache existed the picker
    // could happily offer an indoor shot or a portrait - the exact photos the
    // swap is meant to replace.
    const photos = Array.from({ length: 8 }, (_, i) => makeCached(`p${i}`, i));
    mockGetAllCachedPhotos.mockResolvedValue(photos);
    mockGetAllVerdicts.mockResolvedValue(
      new Map([
        ['p0', verdictRow('p0', false)],
        ['p1', verdictRow('p1', false)],
      ])
    );

    const candidates = await loadSwapCandidates('quiz-swap-1');
    const ids = candidates.map((c) => c.id);

    expect(ids).not.toContain('p0');
    expect(ids).not.toContain('p1');
    expect(ids.length).toBeGreaterThan(0);
  });

  it('attaches the cached landscape so a swapped question gets real decoys', async () => {
    const photos = [makeCached('p0', 0)];
    mockGetAllCachedPhotos.mockResolvedValue(photos);
    mockGetAllVerdicts.mockResolvedValue(
      new Map([['p0', verdictRow('p0', true, 'mediterranean')]])
    );

    const candidates = await loadSwapCandidates('quiz-swap-2');

    expect(candidates[0]?.landscape).toBe('mediterranean');
  });

  it('drops screenshots from the picker', async () => {
    const photos = Array.from({ length: 6 }, (_, i) => makeCached(`p${i}`, i));
    mockGetAllCachedPhotos.mockResolvedValue(photos);
    mockGetTagsForIds.mockImplementation(async (ids: string[]) => {
      const map = new Map();
      for (const id of ids) {
        map.set(id, {
          id,
          taggerVersion: 1,
          status: 'ok',
          isScreenshot: id === 'p0',
          faceCount: 0,
          maxFaceArea: 0,
          totalFaceArea: 0,
          humanCount: 0,
          maxHumanArea: 0,
          totalHumanArea: 0,
          labels: [],
          aestheticScore: null,
          isUtility: null,
          computedAt: 1,
        });
      }
      return map;
    });

    const ids = (await loadSwapCandidates('quiz-swap-3')).map((c) => c.id);

    expect(ids).not.toContain('p0');
  });

  it('still returns geo-eligible candidates when nothing is cached', async () => {
    const photos = Array.from({ length: 5 }, (_, i) => makeCached(`p${i}`, i));
    mockGetAllCachedPhotos.mockResolvedValue(photos);

    const ids = (await loadSwapCandidates('quiz-swap-4')).map((c) => c.id);

    expect(ids).toHaveLength(5);
  });
});
