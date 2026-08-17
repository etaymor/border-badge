/**
 * DB harness modeled on photoCacheDb.test.ts (mocked expo-sqlite, SQL routed by
 * substring) so the module singleton is rebuilt for every test.
 */

import type { PhotoMlTag, PhotoQuizVerdict } from '../../../services/photoImport/photoTagDb';

describe('photoTagDb', () => {
  let mockDb: {
    execAsync: jest.Mock;
    runAsync: jest.Mock;
    getAllAsync: jest.Mock;
    getFirstAsync: jest.Mock;
    closeAsync: jest.Mock;
    withTransactionAsync: jest.Mock;
  };
  let photoCacheDb: typeof import('../../../services/photoImport/photoCacheDb');
  let photoTagDb: typeof import('../../../services/photoImport/photoTagDb');

  const baseTag = (over: Partial<PhotoMlTag> = {}): PhotoMlTag => ({
    id: 'photo-1',
    taggerVersion: 1,
    status: 'ok',
    isScreenshot: false,
    faceCount: 0,
    maxFaceArea: 0,
    totalFaceArea: 0,
    humanCount: 0,
    maxHumanArea: 0,
    totalHumanArea: 0,
    labels: [{ identifier: 'beach', confidence: 0.9 }],
    aestheticScore: 0.5,
    isUtility: false,
    computedAt: 1_700_000_000_000,
    ...over,
  });

  const baseVerdict = (over: Partial<PhotoQuizVerdict> = {}): PhotoQuizVerdict => ({
    id: 'photo-1',
    eligible: true,
    reason: null,
    landscape: 'coastal',
    classifierVersion: 'gemini-2.5-flash-lite/v1',
    classifiedAt: 1_700_000_000_000,
    ...over,
  });

  /** Find the single runAsync call whose SQL contains `fragment`. */
  const callWith = (fragment: string): unknown[] | undefined =>
    mockDb.runAsync.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes(fragment)
    );

  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();

    mockDb = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync: jest.fn().mockResolvedValue(undefined),
      getAllAsync: jest.fn().mockResolvedValue([]),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      closeAsync: jest.fn().mockResolvedValue(undefined),
      withTransactionAsync: jest.fn().mockImplementation(async (callback) => {
        await callback();
      }),
    };

    jest.doMock('expo-sqlite', () => ({
      openDatabaseAsync: jest.fn().mockResolvedValue(mockDb),
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    photoCacheDb = require('../../../services/photoImport/photoCacheDb');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    photoTagDb = require('../../../services/photoImport/photoTagDb');
  });

  afterEach(async () => {
    if (photoCacheDb) {
      try {
        await photoCacheDb.closeDb();
      } catch {
        // Ignore errors during cleanup
      }
    }
  });

  describe('upsertTags', () => {
    it('does nothing for an empty batch', async () => {
      await photoTagDb.upsertTags([]);

      expect(mockDb.runAsync).not.toHaveBeenCalled();
    });

    it('writes one row with booleans as 0/1 and labels as compact JSON', async () => {
      await photoTagDb.upsertTags([baseTag({ isScreenshot: true, isUtility: true })]);

      const call = callWith('INSERT OR REPLACE INTO photo_ml_tags');
      expect(call).toBeDefined();
      const values = call?.[1] as unknown[];
      expect(values[0]).toBe('photo-1');
      expect(values[3]).toBe(1); // is_screenshot
      expect(values[10]).toBe(JSON.stringify([{ i: 'beach', c: 0.9 }]));
      expect(values[12]).toBe(1); // is_utility
    });

    it('preserves a null isUtility rather than coercing it to false', async () => {
      // iOS < 18 has no aesthetics API. Storing 0 would claim "we checked and it
      // is not a utility image", which would let a real utility photo rank.
      await photoTagDb.upsertTags([baseTag({ isUtility: null, aestheticScore: null })]);

      const values = callWith('INSERT OR REPLACE INTO photo_ml_tags')?.[1] as unknown[];
      expect(values[11]).toBeNull(); // aesthetic_score
      expect(values[12]).toBeNull(); // is_utility
    });

    it('splits large batches to stay under the SQLite parameter limit', async () => {
      const tags = Array.from({ length: 120 }, (_, i) => baseTag({ id: `photo-${i}` }));

      await photoTagDb.upsertTags(tags);

      const inserts = mockDb.runAsync.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === 'string' && call[0].includes('INSERT OR REPLACE INTO photo_ml_tags')
      );
      expect(inserts).toHaveLength(3); // 50 + 50 + 20
      for (const insert of inserts) {
        expect((insert[1] as unknown[]).length).toBeLessThan(photoCacheDb.SQLITE_PARAM_LIMIT);
      }
    });

    it('wraps the write in a transaction', async () => {
      await photoTagDb.upsertTags([baseTag()]);

      expect(mockDb.withTransactionAsync).toHaveBeenCalled();
    });
  });

  describe('getTagsForIds', () => {
    it('returns an empty map without querying for an empty id list', async () => {
      const result = await photoTagDb.getTagsForIds([]);

      expect(result.size).toBe(0);
      expect(mockDb.getAllAsync).not.toHaveBeenCalled();
    });

    it('maps snake_case rows back to typed tags', async () => {
      mockDb.getAllAsync.mockResolvedValue([
        {
          id: 'photo-1',
          tagger_version: 1,
          status: 'ok',
          is_screenshot: 1,
          face_count: 2,
          max_face_area: 0.1,
          total_face_area: 0.15,
          human_count: 1,
          max_human_area: 0.4,
          total_human_area: 0.4,
          labels_json: JSON.stringify([{ i: 'mountain', c: 0.8 }]),
          aesthetic_score: -0.2,
          is_utility: 0,
          computed_at: 123,
        },
      ]);

      const result = await photoTagDb.getTagsForIds(['photo-1']);
      const tag = result.get('photo-1');

      expect(tag?.isScreenshot).toBe(true);
      expect(tag?.isUtility).toBe(false);
      expect(tag?.maxHumanArea).toBe(0.4);
      expect(tag?.labels).toEqual([{ identifier: 'mountain', confidence: 0.8 }]);
    });

    it('reads null is_utility back as null, not false', async () => {
      mockDb.getAllAsync.mockResolvedValue([
        {
          id: 'photo-1',
          tagger_version: 1,
          status: 'ok',
          is_screenshot: 0,
          face_count: 0,
          max_face_area: 0,
          total_face_area: 0,
          human_count: 0,
          max_human_area: 0,
          total_human_area: 0,
          labels_json: null,
          aesthetic_score: null,
          is_utility: null,
          computed_at: 123,
        },
      ]);

      const tag = (await photoTagDb.getTagsForIds(['photo-1'])).get('photo-1');

      expect(tag?.isUtility).toBeNull();
      expect(tag?.aestheticScore).toBeNull();
      expect(tag?.labels).toEqual([]);
    });

    it('degrades a malformed labels blob to no labels instead of throwing', async () => {
      mockDb.getAllAsync.mockResolvedValue([
        {
          id: 'photo-1',
          tagger_version: 1,
          status: 'ok',
          is_screenshot: 0,
          face_count: 0,
          max_face_area: 0,
          total_face_area: 0,
          human_count: 0,
          max_human_area: 0,
          total_human_area: 0,
          labels_json: '{not json',
          aesthetic_score: null,
          is_utility: null,
          computed_at: 123,
        },
      ]);

      const tag = (await photoTagDb.getTagsForIds(['photo-1'])).get('photo-1');

      expect(tag?.labels).toEqual([]);
    });

    it('batches large id lists', async () => {
      const ids = Array.from({ length: 250 }, (_, i) => `photo-${i}`);

      await photoTagDb.getTagsForIds(ids);

      expect(mockDb.getAllAsync).toHaveBeenCalledTimes(3); // 100 + 100 + 50
    });
  });

  describe('getUntaggedIds', () => {
    it('returns every id when nothing is tagged yet', async () => {
      mockDb.getAllAsync.mockResolvedValue([]);

      const result = await photoTagDb.getUntaggedIds(['a', 'b', 'c']);

      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('preserves the caller-supplied priority order', async () => {
      mockDb.getAllAsync.mockResolvedValue([
        { id: 'b', tagger_version: 1, status: 'ok', computed_at: 1 },
      ]);

      const result = await photoTagDb.getUntaggedIds(['c', 'b', 'a']);

      expect(result).toEqual(['c', 'a']);
    });

    it('re-tags rows written by an older tagger version', async () => {
      mockDb.getAllAsync.mockResolvedValue([
        { id: 'a', tagger_version: 0, status: 'ok', computed_at: 1 },
        { id: 'b', tagger_version: photoTagDb.TAGGER_VERSION, status: 'ok', computed_at: 1 },
      ]);

      const result = await photoTagDb.getUntaggedIds(['a', 'b']);

      expect(result).toEqual(['a']);
    });

    it('retries no-local-image rows only once the retry window has elapsed', async () => {
      const now = 10_000_000_000;
      const week = 7 * 24 * 60 * 60 * 1000;
      mockDb.getAllAsync.mockResolvedValue([
        {
          id: 'stale',
          tagger_version: photoTagDb.TAGGER_VERSION,
          status: 'no-local-image',
          computed_at: now - week - 1,
        },
        {
          id: 'fresh',
          tagger_version: photoTagDb.TAGGER_VERSION,
          status: 'no-local-image',
          computed_at: now - 1000,
        },
      ]);

      const result = await photoTagDb.getUntaggedIds(['stale', 'fresh'], now);

      expect(result).toEqual(['stale']);
    });

    it('does not retry permanent per-photo failures', async () => {
      mockDb.getAllAsync.mockResolvedValue([
        { id: 'a', tagger_version: photoTagDb.TAGGER_VERSION, status: 'error', computed_at: 1 },
        { id: 'b', tagger_version: photoTagDb.TAGGER_VERSION, status: 'not-found', computed_at: 1 },
      ]);

      const result = await photoTagDb.getUntaggedIds(['a', 'b'], 10_000_000_000);

      expect(result).toEqual([]);
    });

    it('returns an empty list without querying when given no ids', async () => {
      const result = await photoTagDb.getUntaggedIds([]);

      expect(result).toEqual([]);
      expect(mockDb.getAllAsync).not.toHaveBeenCalled();
    });
  });

  describe('upsertVerdicts', () => {
    it('does nothing for an empty batch', async () => {
      await photoTagDb.upsertVerdicts([]);

      expect(mockDb.runAsync).not.toHaveBeenCalled();
    });

    it('stores ineligible verdicts with their reason', async () => {
      await photoTagDb.upsertVerdicts([
        baseVerdict({ eligible: false, reason: 'indoor', landscape: null }),
      ]);

      const values = callWith('INSERT OR REPLACE INTO photo_quiz_verdicts')?.[1] as unknown[];
      expect(values[1]).toBe(0);
      expect(values[2]).toBe('indoor');
      expect(values[3]).toBeNull();
    });

    it('stores the landscape for eligible verdicts', async () => {
      await photoTagDb.upsertVerdicts([baseVerdict()]);

      const values = callWith('INSERT OR REPLACE INTO photo_quiz_verdicts')?.[1] as unknown[];
      expect(values[1]).toBe(1);
      expect(values[3]).toBe('coastal');
      expect(values[4]).toBe('gemini-2.5-flash-lite/v1');
    });

    it('batches large verdict sets', async () => {
      const verdicts = Array.from({ length: 130 }, (_, i) => baseVerdict({ id: `photo-${i}` }));

      await photoTagDb.upsertVerdicts(verdicts);

      const inserts = mockDb.runAsync.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === 'string' &&
          call[0].includes('INSERT OR REPLACE INTO photo_quiz_verdicts')
      );
      expect(inserts).toHaveLength(3); // 50 + 50 + 30
    });
  });

  describe('getAllVerdicts', () => {
    it('maps rows into a map keyed by asset id', async () => {
      mockDb.getAllAsync.mockResolvedValue([
        {
          id: 'photo-1',
          eligible: 1,
          reason: null,
          landscape: 'alpine',
          classifier_version: 'gemini-2.5-flash-lite/v1',
          classified_at: 5,
        },
        {
          id: 'photo-2',
          eligible: 0,
          reason: 'people_present',
          landscape: null,
          classifier_version: 'gemini-2.5-flash-lite/v1',
          classified_at: 6,
        },
      ]);

      const result = await photoTagDb.getAllVerdicts();

      expect(result.size).toBe(2);
      expect(result.get('photo-1')?.eligible).toBe(true);
      expect(result.get('photo-1')?.landscape).toBe('alpine');
      expect(result.get('photo-2')?.eligible).toBe(false);
      expect(result.get('photo-2')?.reason).toBe('people_present');
    });
  });

  describe('getTagCoverageStats', () => {
    it('aggregates counts by status and current-version coverage', async () => {
      mockDb.getAllAsync.mockResolvedValue([
        { status: 'ok', tagger_version: photoTagDb.TAGGER_VERSION, count: 10 },
        { status: 'no-local-image', tagger_version: photoTagDb.TAGGER_VERSION, count: 3 },
        { status: 'ok', tagger_version: 0, count: 5 },
      ]);

      const stats = await photoTagDb.getTagCoverageStats();

      expect(stats.total).toBe(18);
      expect(stats.currentVersion).toBe(13);
      expect(stats.byStatus).toEqual({ ok: 15, 'no-local-image': 3 });
    });
  });
});
