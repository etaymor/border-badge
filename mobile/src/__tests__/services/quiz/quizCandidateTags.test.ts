/**
 * The decoration seam: three signal families (Vision rows, intent rows,
 * nothing) must combine without ever making a pool worse than untagged.
 */

import { decoratePoolWithTags } from '@services/quiz/quizCandidateTags';

import type { PhotoIntentTag, PhotoMlTag } from '@services/photoImport/photoTagDb';
import type { GeoEligibleCandidate } from '@services/quiz/candidateSelection';

jest.mock('@config/features', () => ({
  features: {
    enableTagPrefilter: true,
    enableIntentSignals: true,
    enableQualityRanking: true,
  },
}));

const mockGetTagsForIds = jest.fn();
const mockGetIntentTagsForIds = jest.fn();
jest.mock('@services/photoImport/photoTagDb', () => ({
  getTagsForIds: (ids: string[]) => mockGetTagsForIds(ids),
  getIntentTagsForIds: (ids: string[]) => mockGetIntentTagsForIds(ids),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { features } = jest.requireMock('@config/features') as {
  features: Record<string, boolean>;
};

function candidate(
  id: string,
  overrides: Partial<GeoEligibleCandidate> = {}
): GeoEligibleCandidate {
  return {
    id,
    uri: `ph://${id}`,
    creationTime: Date.UTC(2024, 5, 20, 12, 0, 0),
    latitude: 41.9,
    longitude: 12.5,
    countryCode: 'IT',
    ...overrides,
  };
}

function mlTag(id: string, overrides: Partial<PhotoMlTag> = {}): PhotoMlTag {
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
    computedAt: 0,
    ...overrides,
  };
}

function intentTag(id: string, overrides: Partial<PhotoIntentTag> = {}): PhotoIntentTag {
  return {
    id,
    metaVersion: 1,
    isFavorite: false,
    hasAdjustments: false,
    subtypes: [],
    burstId: null,
    burstIsRepresentative: false,
    sourceUserLibrary: true,
    inUserAlbum: false,
    altitude: null,
    gpsSpeed: null,
    refreshedAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  features.enableTagPrefilter = true;
  features.enableIntentSignals = true;
  features.enableQualityRanking = true;
  mockGetTagsForIds.mockReset().mockResolvedValue(new Map());
  mockGetIntentTagsForIds.mockReset().mockResolvedValue(new Map());
});

describe('decoratePoolWithTags', () => {
  it('returns candidates bare when no signals of any kind exist', async () => {
    const pool = [candidate('a'), candidate('b')];
    const decorated = await decoratePoolWithTags(pool);
    expect(decorated.pool).toEqual(pool);
    expect(decorated.untagged).toBe(2);
    expect(decorated.tiers.unknown).toBe(2);
    expect(decorated.tierById.size).toBe(0);
  });

  it('skips the intent read entirely when intent signals are off', async () => {
    features.enableIntentSignals = false;
    await decoratePoolWithTags([candidate('a')]);
    expect(mockGetIntentTagsForIds).not.toHaveBeenCalled();
  });

  it('degrades to Vision-only when the intent read fails', async () => {
    mockGetTagsForIds.mockResolvedValue(new Map([['a', mlTag('a', { isScreenshot: true })]]));
    mockGetIntentTagsForIds.mockRejectedValue(new Error('db locked'));
    const decorated = await decoratePoolWithTags([candidate('a')]);
    expect(decorated.dropped).toBe(1);
  });

  it('demotes a saved-from-social photo to marginal, never drops it', async () => {
    mockGetIntentTagsForIds.mockResolvedValue(
      new Map([['a', intentTag('a', { sourceUserLibrary: false })]])
    );
    const decorated = await decoratePoolWithTags([candidate('a')]);
    expect(decorated.dropped).toBe(0);
    expect(decorated.tiers.marginal).toBe(1);
    expect(decorated.pool[0].tier).toBe('marginal');
  });

  it('keeps intent-only predictions out of the Vision agreement telemetry', async () => {
    mockGetIntentTagsForIds.mockResolvedValue(
      new Map([['a', intentTag('a', { sourceUserLibrary: false })]])
    );
    const decorated = await decoratePoolWithTags([candidate('a')]);
    expect(decorated.tierById.size).toBe(0);
  });

  it('boosts a favorited photo above its burst sibling via composite quality', async () => {
    const pool = [
      candidate('frame1'),
      candidate('frame2', { creationTime: Date.UTC(2024, 5, 20, 12, 0, 5) }),
    ];
    mockGetIntentTagsForIds.mockResolvedValue(
      new Map([
        ['frame1', intentTag('frame1', { isFavorite: true })],
        ['frame2', intentTag('frame2')],
      ])
    );
    const decorated = await decoratePoolWithTags(pool);
    const byId = new Map(decorated.pool.map((c) => [c.id, c]));
    expect(byId.get('frame1')!.tags!.qualityScore).toBeGreaterThan(
      byId.get('frame2')!.tags!.qualityScore
    );
  });

  it('keeps the raw aesthetic score when quality ranking is off', async () => {
    features.enableQualityRanking = false;
    mockGetTagsForIds.mockResolvedValue(new Map([['a', mlTag('a', { aestheticScore: 0.7 })]]));
    const decorated = await decoratePoolWithTags([candidate('a')]);
    expect(decorated.pool[0].tags!.qualityScore).toBe(0.7);
  });
});
