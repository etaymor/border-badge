import {
  computeQualityScores,
  INTENT_CAP,
  PENALTY_SAVED_FROM_SOCIAL,
  WEIGHT_EDITED,
  WEIGHT_FAVORITE,
  WEIGHT_GOLDEN_HOUR,
} from '@services/photoSignals/qualityScore';

import type { PhotoIntentTag } from '@services/photoImport/photoTagDb';
import type { CaptureContext } from '@services/photoSignals/captureContext';
import type { QualityInput } from '@services/photoSignals/qualityScore';

function intent(overrides: Partial<PhotoIntentTag> = {}): PhotoIntentTag {
  return {
    id: 'x',
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

function context(overrides: Partial<CaptureContext> = {}): CaptureContext {
  return {
    dwellBeforeSec: null,
    retryCount: 1,
    goldenHour: false,
    night: false,
    altitudeDelta: null,
    movingCapture: false,
    savedFromSocialLikely: false,
    ...overrides,
  };
}

const item = (id: string, aestheticScore: number | null, rest: Partial<QualityInput> = {}) => ({
  id,
  aestheticScore,
  ...rest,
});

describe('computeQualityScores', () => {
  it('rank-normalizes aesthetics within the pool', () => {
    const scores = computeQualityScores([item('low', -0.5), item('mid', 0.1), item('high', 0.9)]);
    expect(scores.get('low')).toBe(-0.5);
    expect(scores.get('mid')).toBe(0);
    expect(scores.get('high')).toBe(0.5);
  });

  it('gives tied aesthetics identical ranks regardless of input order', () => {
    const scores = computeQualityScores([item('a', 0.5), item('b', 0.5), item('c', -1)]);
    expect(scores.get('a')).toBe(scores.get('b'));
  });

  it('scores an unmeasured photo at the 0 neutral, not the bottom', () => {
    const scores = computeQualityScores([item('measured', 0.9), item('unmeasured', null)]);
    expect(scores.get('unmeasured')).toBe(0);
  });

  it('ranks a single measured photo neutral rather than at the top', () => {
    const scores = computeQualityScores([item('only', 0.99), item('none', null)]);
    expect(scores.get('only')).toBe(0);
  });

  it('scores an all-neutral row exactly like no row at all', () => {
    // Consumers default rowless photos to 0; a neutral row must tie them.
    const scores = computeQualityScores([item('neutral-row', null, { intent: intent() })]);
    expect(scores.get('neutral-row')).toBe(0);
  });

  it('lets a favorite win among aesthetically similar photos', () => {
    const scores = computeQualityScores([
      item('plain', 0.2),
      item('favorite', 0.2, { intent: intent({ isFavorite: true }) }),
    ]);
    expect(scores.get('favorite')!).toBeGreaterThan(scores.get('plain')!);
  });

  it('does not let a favorite leapfrog the full aesthetic spread', () => {
    // The favorite weight is deliberately half the rank range: user intent is
    // strong evidence, but the pool's clear best photo stays reachable.
    const scores = computeQualityScores([
      item('best', 0.9),
      item('worst-but-loved', -0.9, { intent: intent({ isFavorite: true }) }),
      item('mid', 0.1),
    ]);
    expect(scores.get('best')!).toBeGreaterThan(scores.get('worst-but-loved')!);
  });

  it('caps stacked intent evidence', () => {
    const scores = computeQualityScores([
      item('stacked', null, {
        intent: intent({
          isFavorite: true,
          hasAdjustments: true,
          inUserAlbum: true,
          burstIsRepresentative: true,
        }),
      }),
    ]);
    expect(scores.get('stacked')).toBe(INTENT_CAP);
  });

  it('encodes favorite above edited', () => {
    expect(WEIGHT_FAVORITE).toBeGreaterThan(WEIGHT_EDITED);
  });

  it('applies context bonuses and penalties', () => {
    const scores = computeQualityScores([
      item('golden', null, { context: context({ goldenHour: true }) }),
      item('saved', null, { context: context({ savedFromSocialLikely: true }) }),
    ]);
    expect(scores.get('golden')).toBeCloseTo(WEIGHT_GOLDEN_HOUR);
    expect(scores.get('saved')).toBeCloseTo(-PENALTY_SAVED_FROM_SOCIAL);
  });

  it('returns an empty map for an empty pool', () => {
    expect(computeQualityScores([]).size).toBe(0);
  });
});
