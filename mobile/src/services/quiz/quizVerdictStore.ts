/**
 * Persistence for the PAID eligibility verdicts.
 *
 * Every `/quiz/eligibility` call costs money and ~1s of the user's time per
 * image, and until now the per-photo answer lived only in an in-memory
 * `ClassificationSession` and died with it. A second game therefore re-bought
 * verdicts the first game had already paid for, on the same photos, in the same
 * priority order.
 *
 * Storing BOTH outcomes matters, and it is the ineligible half that does most
 * of the work: knowing a photo already failed keeps the next hunt from drawing
 * it again, which is what turns a repeat creation from "several waves" into
 * "no classification at all".
 *
 * Protocol-safe: the server never re-validates per-photo classification at
 * finalize, so seeding picks from stored verdicts cannot desync anything.
 */

import { getAllVerdicts, upsertVerdicts } from '@services/photoImport/photoTagDb';
import type { PhotoQuizVerdict } from '@services/photoImport/photoTagDb';

import type { GeoEligibleCandidate } from './candidateSelection';

/**
 * Identifies the model + prompt that produced a verdict. Bump this whenever the
 * server's eligibility prompt or model changes: stored verdicts from a
 * different classifier are silently ignored rather than migrated, so a prompt
 * fix takes effect immediately instead of being masked by the cache.
 *
 * Must be kept in step with the backend's quiz eligibility classifier.
 */
export const QUIZ_CLASSIFIER_VERSION = 'gemini-2.5-flash-lite/v1';

export interface SeededVerdicts {
  /** Candidates whose stored verdict says eligible, in pool order. */
  eligible: GeoEligibleCandidate[];
  /** Ids with any usable stored verdict - eligible or not. */
  seenIds: Set<string>;
  eligibleCount: number;
  ineligibleCount: number;
}

/**
 * Load stored verdicts for the current classifier only.
 *
 * Bounded by the classification budget spent to date rather than by library
 * size, so reading the whole table is cheap even on a 50k-photo library.
 */
export async function loadCurrentVerdicts(): Promise<Map<string, PhotoQuizVerdict>> {
  try {
    const all = await getAllVerdicts();
    for (const [id, verdict] of all) {
      if (verdict.classifierVersion !== QUIZ_CLASSIFIER_VERSION) all.delete(id);
    }
    return all;
  } catch {
    // The cache is an optimization, never a dependency: a read failure must
    // degrade to today's behavior (classify everything), not fail the creation.
    return new Map();
  }
}

/**
 * Split a candidate pool against stored verdicts.
 *
 * `eligible` carries the stored `landscape` through, which is what lets a
 * seeded game build real decoys without re-classifying: landscape is chosen by
 * the vision gate and has no other local source.
 */
export function seedFromVerdicts(
  pool: GeoEligibleCandidate[],
  verdicts: Map<string, PhotoQuizVerdict>
): SeededVerdicts {
  const eligible: GeoEligibleCandidate[] = [];
  const seenIds = new Set<string>();
  let ineligibleCount = 0;

  for (const candidate of pool) {
    const verdict = verdicts.get(candidate.id);
    if (!verdict) continue;
    seenIds.add(candidate.id);
    if (verdict.eligible) {
      eligible.push({ ...candidate, landscape: verdict.landscape ?? undefined });
    } else {
      ineligibleCount += 1;
    }
  }

  return { eligible, seenIds, eligibleCount: eligible.length, ineligibleCount };
}

/**
 * Persist verdicts for one classified batch. Fire-and-forget by design: the
 * creation must never slow down or fail because a cache write did.
 */
export function recordVerdicts(
  verdicts: Array<Omit<PhotoQuizVerdict, 'classifierVersion' | 'classifiedAt'>>
): void {
  if (verdicts.length === 0) return;
  const now = Date.now();
  void upsertVerdicts(
    verdicts.map((verdict) => ({
      ...verdict,
      classifierVersion: QUIZ_CLASSIFIER_VERSION,
      classifiedAt: now,
    }))
  ).catch(() => {
    // Losing a cache write costs one re-classification later, nothing more.
  });
}
