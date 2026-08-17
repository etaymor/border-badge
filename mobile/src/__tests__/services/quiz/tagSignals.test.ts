/**
 * Threshold table for the on-device pre-filter.
 *
 * The asymmetry under test throughout: a mis-RANKED photo still reaches the paid
 * gate and costs nothing; a mis-DROPPED photo is invisible forever. So the drop
 * cases below are deliberately few and the "must NOT drop" cases are the ones
 * that matter most.
 */

import type { PhotoMlTag, PhotoTagLabel } from '@services/photoImport/photoTagDb';
import {
  classifyPrefilter,
  deriveSignals,
  DEFAULT_TIER,
  PEOPLE_PROMINENCE_DROP,
  TIER_ORDER,
} from '@services/quiz/tagSignals';

function makeTag(overrides: Partial<PhotoMlTag> = {}): PhotoMlTag {
  return {
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
    labels: [],
    aestheticScore: null,
    isUtility: null,
    computedAt: 1_700_000_000_000,
    ...overrides,
  };
}

const labels = (...pairs: Array<[string, number]>): PhotoTagLabel[] =>
  pairs.map(([identifier, confidence]) => ({ identifier, confidence }));

const tierOf = (overrides: Partial<PhotoMlTag>) =>
  classifyPrefilter(deriveSignals(makeTag(overrides)));

describe('deriveSignals', () => {
  describe('people prominence', () => {
    it('is zero when no person was detected', () => {
      expect(deriveSignals(makeTag()).peopleProminence).toBe(0);
    });

    it('uses the largest human box directly', () => {
      expect(deriveSignals(makeTag({ humanCount: 1, maxHumanArea: 0.42 })).peopleProminence).toBe(
        0.42
      );
    });

    it('scales a face up to approximate the whole body', () => {
      // A face filling 5% of the frame implies a person filling far more than 5%.
      expect(
        deriveSignals(makeTag({ faceCount: 1, maxFaceArea: 0.05 })).peopleProminence
      ).toBeCloseTo(0.3);
    });

    it('takes the larger of the two estimates, never the sum', () => {
      const signals = deriveSignals(makeTag({ maxHumanArea: 0.5, maxFaceArea: 0.02 }));

      expect(signals.peopleProminence).toBe(0.5);
    });

    it('caps at 1 so a huge face estimate cannot exceed the frame', () => {
      expect(deriveSignals(makeTag({ maxFaceArea: 0.9 })).peopleProminence).toBe(1);
    });
  });

  describe('outdoor score', () => {
    it('is positive for outdoor scene labels', () => {
      expect(
        deriveSignals(makeTag({ labels: labels(['mountain', 0.8], ['sky', 0.6]) })).outdoorScore
      ).toBeGreaterThan(0);
    });

    it('is negative for enclosed interiors', () => {
      expect(
        deriveSignals(makeTag({ labels: labels(['kitchen', 0.7]) })).outdoorScore
      ).toBeLessThan(0);
    });

    it('is negative for food close-ups', () => {
      expect(deriveSignals(makeTag({ labels: labels(['pizza', 0.9]) })).outdoorScore).toBeLessThan(
        0
      );
    });

    it('treats covered-but-open places as outdoor, matching the server gate', () => {
      // The original gate counted markets and platforms as indoor and rejected
      // nearly every photo of a real library. Do not regress that here.
      expect(
        deriveSignals(makeTag({ labels: labels(['street', 0.7], ['plaza', 0.5]) })).outdoorScore
      ).toBeGreaterThan(0);
    });

    it('ignores labels below the confidence floor', () => {
      expect(deriveSignals(makeTag({ labels: labels(['mountain', 0.05]) })).outdoorScore).toBe(0);
    });
  });

  describe('category', () => {
    it.each([
      ['temple', 'landmark'],
      ['beach', 'scenery'],
      ['skyline', 'building'],
      ['receipt', 'other'],
    ])('reads %s as %s', (label, expected) => {
      expect(deriveSignals(makeTag({ labels: labels([label, 0.8]) })).categoryGuess).toBe(expected);
    });

    it('is unknown when nothing scores', () => {
      expect(deriveSignals(makeTag()).categoryGuess).toBe('unknown');
    });
  });

  describe('quality', () => {
    it('passes through a measured aesthetic score', () => {
      expect(deriveSignals(makeTag({ aestheticScore: 0.7 })).qualityScore).toBe(0.7);
    });

    it('is neutral, not negative, when the OS cannot measure it', () => {
      // iOS < 18 has no aesthetics API. Treating null as -1 would sink every
      // photo on older devices below every photo on newer ones.
      expect(deriveSignals(makeTag({ aestheticScore: null })).qualityScore).toBe(0);
    });
  });

  describe('non-ok rows', () => {
    it('reads an iCloud-offloaded photo as fully neutral', () => {
      const signals = deriveSignals(makeTag({ status: 'no-local-image' }));

      expect(signals).toMatchObject({
        peopleProminence: 0,
        outdoorScore: 0,
        categoryGuess: 'unknown',
        qualityScore: 0,
      });
    });

    it('still trusts the screenshot flag, which needs no pixels', () => {
      expect(
        deriveSignals(makeTag({ status: 'no-local-image', isScreenshot: true })).utilityLikely
      ).toBe(true);
    });
  });
});

describe('classifyPrefilter', () => {
  describe('drops (the only three)', () => {
    it('drops screenshots', () => {
      expect(tierOf({ isScreenshot: true })).toBe('drop');
    });

    it('drops Apple-flagged utility images', () => {
      expect(tierOf({ isUtility: true })).toBe('drop');
    });

    it('drops a photo whose subject is plainly a person', () => {
      expect(tierOf({ maxHumanArea: PEOPLE_PROMINENCE_DROP + 0.05 })).toBe('drop');
    });
  });

  describe('must NOT drop', () => {
    it('keeps a landscape containing distant figures', () => {
      // The server explicitly wants these: "a street scene with distant
      // passers-by is a good guess-where puzzle".
      const tier = tierOf({
        humanCount: 3,
        maxHumanArea: 0.04,
        labels: labels(['mountain', 0.8], ['sky', 0.5]),
      });

      expect(tier).toBe('likely');
    });

    it('keeps a photo sitting exactly on the prominence threshold', () => {
      expect(tierOf({ maxHumanArea: PEOPLE_PROMINENCE_DROP })).not.toBe('drop');
    });

    it('ranks indoor photos last rather than dropping them', () => {
      // v1 policy: indoor and food are `marginal` -- classified last, never
      // never. Tighten only once agreement telemetry says it is safe.
      expect(tierOf({ labels: labels(['kitchen', 0.8]) })).toBe('marginal');
    });

    it('ranks food photos last rather than dropping them', () => {
      expect(tierOf({ labels: labels(['pizza', 0.9]) })).toBe('marginal');
    });

    it('never drops a photo with no signal at all', () => {
      expect(tierOf({})).toBe('unknown');
    });

    it('never drops an iCloud-offloaded photo for being offloaded', () => {
      expect(tierOf({ status: 'no-local-image' })).toBe('unknown');
    });
  });

  describe('ranking', () => {
    it('marks outdoor scenery as likely', () => {
      expect(tierOf({ labels: labels(['beach', 0.9], ['ocean', 0.7]) })).toBe('likely');
    });

    it('marks outdoor landmarks as likely', () => {
      expect(tierOf({ labels: labels(['temple', 0.85]) })).toBe('likely');
    });

    it('marks street architecture as likely', () => {
      expect(tierOf({ labels: labels(['street', 0.8], ['skyline', 0.4]) })).toBe('likely');
    });

    it('demotes a scenic photo once a person becomes noticeable', () => {
      expect(tierOf({ maxHumanArea: 0.2, labels: labels(['beach', 0.9]) })).toBe('marginal');
    });
  });
});

describe('tier vocabulary', () => {
  it('orders tiers best-first and excludes drop', () => {
    expect(TIER_ORDER).toEqual(['likely', 'unknown', 'marginal']);
    expect(TIER_ORDER).not.toContain('drop');
  });

  it('defaults untagged candidates to a tier that TIER_ORDER contains', () => {
    // If these disagreed, untagged candidates would be silently skipped by the
    // ordering loop and vanish from every batch.
    expect(TIER_ORDER).toContain(DEFAULT_TIER);
  });
});
