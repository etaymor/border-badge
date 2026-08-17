/**
 * Attaching on-device signals to a candidate pool.
 *
 * Kept apart from `quizCreation.ts` (sequencing) and `candidateSelection.ts`
 * (pure ordering) because it is the one place that does I/O on behalf of
 * ordering: it reads the tag table, interprets rows, and hands back a decorated
 * pool plus the funnel counts.
 *
 * Every failure path here degrades to "no tags", which is byte-identical to the
 * behavior before tagging existed.
 */

import { features } from '@config/features';
import { getTagsForIds } from '@services/photoImport/photoTagDb';

import { classifyPrefilter, deriveSignals } from './tagSignals';

import type { GeoEligibleCandidate } from './candidateSelection';
import type { PrefilterTier } from './tagSignals';

export interface DecoratedPool {
  /** Candidates that survived the drop rules, carrying tags + tier. */
  pool: GeoEligibleCandidate[];
  /** How many candidates the on-device prefilter removed outright. */
  dropped: number;
  /** Tier histogram of the surviving pool, for the funnel log. */
  tiers: Record<PrefilterTier, number>;
  /** Candidates with no usable tag row - the coverage gap. */
  untagged: number;
  /** Predicted tier per candidate id, for agreement telemetry. */
  tierById: Map<string, PrefilterTier>;
}

const emptyTiers = (): Record<PrefilterTier, number> => ({
  drop: 0,
  likely: 0,
  unknown: 0,
  marginal: 0,
});

/**
 * Decorate a prepared pool with tags and drop the near-certain rejects.
 *
 * Returns the pool unchanged when the prefilter is off or the tag read fails -
 * a missing tag table must never cost a user their game.
 */
export async function decoratePoolWithTags(pool: GeoEligibleCandidate[]): Promise<DecoratedPool> {
  const tiers = emptyTiers();

  const tierById = new Map<string, PrefilterTier>();

  if (!features.enableTagPrefilter || pool.length === 0) {
    return { pool, dropped: 0, tiers, untagged: pool.length, tierById };
  }

  let tags;
  try {
    tags = await getTagsForIds(pool.map((candidate) => candidate.id));
  } catch {
    return { pool, dropped: 0, tiers, untagged: pool.length, tierById };
  }

  const decorated: GeoEligibleCandidate[] = [];
  let dropped = 0;
  let untagged = 0;

  for (const candidate of pool) {
    const row = tags.get(candidate.id);
    if (!row) {
      // No row means no prediction, so this photo is deliberately left OUT of
      // tierById: counting untagged photos as `unknown` agreement would dilute
      // the very rates the telemetry exists to measure.
      untagged += 1;
      tiers.unknown += 1;
      decorated.push(candidate);
      continue;
    }
    const signals = deriveSignals(row);
    const tier = classifyPrefilter(signals);
    tiers[tier] += 1;
    tierById.set(candidate.id, tier);
    if (tier === 'drop') {
      dropped += 1;
      continue;
    }
    decorated.push({ ...candidate, tags: signals, tier });
  }

  return { pool: decorated, dropped, tiers, untagged, tierById };
}

/** Compact funnel fragment, e.g. `tags=likely:12/unknown:80/marginal:9 dropped=4`. */
export function formatTagFunnel(decorated: DecoratedPool): string {
  const { tiers, dropped, untagged } = decorated;
  return (
    `tags=likely:${tiers.likely}/unknown:${tiers.unknown}/marginal:${tiers.marginal} ` +
    `dropped=${dropped} untagged=${untagged}`
  );
}
