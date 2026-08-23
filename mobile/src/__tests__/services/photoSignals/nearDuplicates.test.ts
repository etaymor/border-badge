/**
 * The base collapse/window behavior is regression-locked through the quiz
 * re-exports in candidateSelection.test.ts; this file covers what is new in
 * the shared module: the representative picker.
 */

import { collapseNearDuplicates } from '@services/photoSignals/nearDuplicates';

import type { NearDupePhoto } from '@services/photoSignals/nearDuplicates';

interface ScoredPhoto extends NearDupePhoto {
  quality: number;
}

function photo(id: string, creationTime: number, quality = 0): ScoredPhoto {
  return { id, creationTime, latitude: 48.85, longitude: 2.35, countryCode: 'FR', quality };
}

const bestQuality = (group: ScoredPhoto[]): ScoredPhoto => {
  let best = group[group.length - 1];
  for (const candidate of group) {
    if (candidate.quality > best.quality) best = candidate;
  }
  return best;
};

describe('collapseNearDuplicates representative picker', () => {
  it('keeps the newest frame by default (pre-signals behavior)', () => {
    const collapsed = collapseNearDuplicates([photo('a', 1_000), photo('b', 2_000)]);
    expect(collapsed.map((p) => p.id)).toEqual(['b']);
  });

  it('keeps the highest-quality frame when a picker is provided', () => {
    const collapsed = collapseNearDuplicates(
      [photo('a', 1_000, 0.9), photo('b', 2_000, 0.1)],
      bestQuality
    );
    expect(collapsed.map((p) => p.id)).toEqual(['a']);
  });

  it('falls back to the newest frame on quality ties', () => {
    const collapsed = collapseNearDuplicates(
      [photo('a', 1_000, 0.5), photo('b', 2_000, 0.5)],
      bestQuality
    );
    expect(collapsed.map((p) => p.id)).toEqual(['b']);
  });

  it('picks per group, preserving input order of survivors', () => {
    const farApart = 10 * 60_000;
    const collapsed = collapseNearDuplicates(
      [
        photo('a1', 1_000, 0.2),
        photo('a2', 2_000, 0.8),
        photo('b1', farApart, 0.9),
        photo('b2', farApart + 1_000, 0.3),
      ],
      bestQuality
    );
    expect(collapsed.map((p) => p.id)).toEqual(['a2', 'b1']);
  });
});
