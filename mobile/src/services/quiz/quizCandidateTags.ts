/**
 * Attaching on-device signals to a candidate pool.
 *
 * Kept apart from `quizCreation.ts` (sequencing) and `candidateSelection.ts`
 * (pure ordering) because it is the one place that does I/O on behalf of
 * ordering: it reads the tag tables, interprets rows, and hands back a
 * decorated pool plus the funnel counts.
 *
 * Three signal families meet here, each independently optional:
 * - Vision pixel tags (`photo_ml_tags`) - the prefilter tiers.
 * - PhotoKit intent rows (`photo_intent_tags`) + derived capture context -
 *   the composite quality score and two down-rank-only priors.
 * - Nothing at all - byte-identical to the behavior before tagging existed.
 *
 * Every failure path degrades to the next-poorer family, never to an error.
 */

import { features } from '@config/features';
import { getIntentTagsForIds, getTagsForIds } from '@services/photoImport/photoTagDb';
import { computeCaptureContexts } from '@services/photoSignals/captureContext';
import { computeQualityScores } from '@services/photoSignals/qualityScore';

import { classifyPrefilter, deriveSignals } from './tagSignals';

import type { PhotoIntentTag } from '@services/photoImport/photoTagDb';
import type { CaptureContext } from '@services/photoSignals/captureContext';
import type { GeoEligibleCandidate } from './candidateSelection';
import type { PrefilterTier, TagSignals } from './tagSignals';

export interface DecoratedPool {
  /** Candidates that survived the drop rules, carrying tags + tier. */
  pool: GeoEligibleCandidate[];
  /** How many candidates the on-device prefilter removed outright. */
  dropped: number;
  /** Tier histogram of the surviving pool, for the funnel log. */
  tiers: Record<PrefilterTier, number>;
  /** Candidates with no usable Vision tag row - the coverage gap. */
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

/** Neutral signals for a photo with intent/context evidence but no Vision row. */
const neutralSignals = (): TagSignals => ({
  peopleProminence: 0,
  outdoorScore: 0,
  categoryGuess: 'unknown',
  utilityLikely: false,
  qualityScore: 0,
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

  // Intent + context are a second, independent signal family: their read
  // failure degrades to Vision-only, exactly as a Vision failure degrades to
  // nothing.
  let intentTags = new Map<string, PhotoIntentTag>();
  let contexts = new Map<string, CaptureContext>();
  if (features.enableIntentSignals) {
    try {
      intentTags = await getIntentTagsForIds(pool.map((candidate) => candidate.id));
      contexts = computeCaptureContexts(pool, intentTags);
    } catch {
      intentTags = new Map();
      contexts = new Map();
    }
  }

  // Composite quality is pool-relative (aesthetic rank among these candidates),
  // so it is computed once here rather than per photo.
  const quality =
    features.enableQualityRanking && features.enableIntentSignals
      ? computeQualityScores(
          pool.map((candidate) => ({
            id: candidate.id,
            aestheticScore: tags.get(candidate.id)?.aestheticScore ?? null,
            intent: intentTags.get(candidate.id),
            context: contexts.get(candidate.id),
          }))
        )
      : null;

  const decorated: GeoEligibleCandidate[] = [];
  let dropped = 0;
  let untagged = 0;

  for (const candidate of pool) {
    const row = tags.get(candidate.id);
    const context = contexts.get(candidate.id);
    const hasIntentEvidence =
      intentTags.has(candidate.id) ||
      context?.savedFromSocialLikely === true ||
      context?.movingCapture === true;

    if (!row && !hasIntentEvidence) {
      // No evidence of any kind: leave the candidate bare so a library with no
      // signals orders exactly as it did before tagging existed.
      untagged += 1;
      tiers.unknown += 1;
      decorated.push(candidate);
      continue;
    }

    const signals: TagSignals = row ? deriveSignals(row) : neutralSignals();
    if (!row) untagged += 1;
    if (context) {
      signals.savedFromSocialLikely = context.savedFromSocialLikely;
      signals.movingCapture = context.movingCapture;
    }
    if (quality) signals.qualityScore = quality.get(candidate.id) ?? signals.qualityScore;

    const tier = classifyPrefilter(signals);
    tiers[tier] += 1;
    // Agreement telemetry compares VISION predictions against the paid gate;
    // intent-only rows carry no Vision prediction, so they stay out of it.
    if (row) tierById.set(candidate.id, tier);
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
