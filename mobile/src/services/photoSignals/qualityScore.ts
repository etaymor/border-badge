/**
 * Composite photo quality - one scoring function for every surface.
 *
 * Surfaces differ in how they USE the score (quiz tie-break, vision-photo
 * pick, curation sort), not in what a good photo is, so there is deliberately
 * no per-purpose weight table. Weights are plain constants: retuning ships
 * over-the-air.
 *
 * Apple's aesthetic score is normalized by RANK WITHIN THE POOL being scored,
 * not against a persisted library distribution: raw values (-1..1, range
 * undocumented) are not comparable across libraries, and rank compares a photo
 * against the candidates it actually competes with. A photo with no measured
 * aesthetics scores the pool-neutral 0.5 - "unmeasured" must never read as
 * "unattractive".
 */

import type { PhotoIntentTag } from '@services/photoImport/photoTagDb';

import type { CaptureContext } from './captureContext';

export interface QualityInput {
  id: string;
  /** Apple aesthetics, when measured. */
  aestheticScore: number | null;
  intent?: PhotoIntentTag;
  context?: CaptureContext;
}

// Intent: explicit user evidence. A favorite lifts a photo past half the
// pool's aesthetic spread (and past any near-identical burst sibling), and the
// ordering favorite > edited > album > burst-pick encodes "survived the cull"
// strength. Capped so stacked intent cannot drown a truly bad aesthetic rank.
export const WEIGHT_FAVORITE = 0.5;
export const WEIGHT_EDITED = 0.35;
export const WEIGHT_IN_ALBUM = 0.25;
export const WEIGHT_BURST_PICK = 0.15;
export const INTENT_CAP = 0.75;

// Context: soft priors, sized well under the intent terms.
export const WEIGHT_GOLDEN_HOUR = 0.15;
export const WEIGHT_VIEWPOINT = 0.1;
export const WEIGHT_RETRY_INTEREST = 0.1;
export const PENALTY_MOVING_CAPTURE = 0.25;
export const PENALTY_SAVED_FROM_SOCIAL = 0.5;

/** Altitude delta treated as "climbed somewhere for this shot". */
export const VIEWPOINT_ALTITUDE_DELTA_M = 50;
/** Retries at or above this count read as "the user cared about this scene". */
export const RETRY_INTEREST_THRESHOLD = 3;

function intentScore(intent: PhotoIntentTag | undefined): number {
  if (!intent) return 0;
  let score = 0;
  if (intent.isFavorite) score += WEIGHT_FAVORITE;
  if (intent.hasAdjustments) score += WEIGHT_EDITED;
  if (intent.inUserAlbum) score += WEIGHT_IN_ALBUM;
  if (intent.burstIsRepresentative) score += WEIGHT_BURST_PICK;
  return Math.min(score, INTENT_CAP);
}

function contextScore(context: CaptureContext | undefined): number {
  if (!context) return 0;
  let score = 0;
  if (context.goldenHour) score += WEIGHT_GOLDEN_HOUR;
  if (context.altitudeDelta != null && context.altitudeDelta >= VIEWPOINT_ALTITUDE_DELTA_M) {
    score += WEIGHT_VIEWPOINT;
  }
  if (context.retryCount >= RETRY_INTEREST_THRESHOLD) score += WEIGHT_RETRY_INTEREST;
  if (context.movingCapture) score -= PENALTY_MOVING_CAPTURE;
  if (context.savedFromSocialLikely) score -= PENALTY_SAVED_FROM_SOCIAL;
  return score;
}

/**
 * Score a pool of photos. Higher is better; values are ordinal within this
 * pool only - never persist them or compare across pools.
 */
export function computeQualityScores(items: QualityInput[]): Map<string, number> {
  const scores = new Map<string, number>();
  if (items.length === 0) return scores;

  // Pool-relative aesthetic rank in 0..1. Ties share the average of their
  // positions so identical scores get identical ranks regardless of input
  // order; a single measured item ranks mid-pool rather than claiming the top.
  const measured = items
    .filter((item) => item.aestheticScore != null)
    .sort((a, b) => a.aestheticScore! - b.aestheticScore!);
  const aestheticRank = new Map<string, number>();
  for (let index = 0; index < measured.length; ) {
    let end = index;
    while (
      end + 1 < measured.length &&
      measured[end + 1].aestheticScore === measured[index].aestheticScore
    ) {
      end++;
    }
    const rank = measured.length === 1 ? 0.5 : (index + end) / 2 / (measured.length - 1);
    for (let i = index; i <= end; i++) aestheticRank.set(measured[i].id, rank);
    index = end + 1;
  }

  for (const item of items) {
    scores.set(
      item.id,
      (aestheticRank.get(item.id) ?? 0.5) + intentScore(item.intent) + contextScore(item.context)
    );
  }
  return scores;
}
