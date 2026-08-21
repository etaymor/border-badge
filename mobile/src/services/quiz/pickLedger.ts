/**
 * The pick ledger: which found photos are actually IN the game, decided as
 * they are found rather than re-decided at the end.
 *
 * The creation screen renders the hunt live - a slot grid of the photos found
 * so far. That preview used to be the raw eligible list, while the game was
 * chosen afterwards by a second, independent pass over the same photos
 * (`pickQuizPhotos`): de-dupe, re-order by country spread, then three
 * diversity passes. The two selections disagreed, so at the handover the grid
 * visibly swapped photos, shuffled the survivors, and shrank - a wait that
 * looked like it had crashed and started over.
 *
 * So the decision moves forward. `offer` applies the strict diversity rules
 * the moment a photo clears the vision gate: a photo that gets a slot KEEPS
 * that slot for the rest of the run, and one that loses a rule goes to the
 * bench instead of into the preview. `topUp` and `finalize` only ever APPEND -
 * they relax the rules over the bench - so `picks` is append-only from the
 * first find to the last upload. Nothing shown is ever taken back.
 *
 * `topUp` is what keeps the hunt from chasing an unreachable target. The
 * strict rules plateau on a perfectly ordinary library: three trips in one
 * year is three distinct (country, year) pairs, so strict selection alone
 * caps the game at three no matter how many photos pass the gate. Calling
 * `topUp` after every pass fills the remaining slots as soon as enough
 * photos are in hand for a full game - the same point the old code stopped
 * at, and the same game it would have built, just decided early enough to
 * show.
 *
 * The rules are exactly `pickQuizPhotos`'s (which remains the reference
 * implementation, used by nothing else in the hunt):
 *   1. distinct calendar day AND distinct (country, year), no near-duplicates
 *   2. distinct day (a country-year may repeat across different days)
 *   3. anything left (same-day repeats are the last resort)
 */

import {
  QUIZ_MAX_PHOTOS,
  countryYearKey,
  isNearDuplicatePair,
  photoDayKey,
} from './candidateSelection';
import type { GeoEligibleCandidate } from './candidateSelection';

export interface PickLedger {
  /**
   * The locked game, in the order the photos were found. Append-only: a live
   * view, safe to read on every progress emission.
   */
  readonly picks: GeoEligibleCandidate[];
  /** Cleared the vision gate but lost a diversity rule; kept for `finalize`. */
  readonly bench: GeoEligibleCandidate[];
  /** True when the candidate took a slot. */
  offer: (candidate: GeoEligibleCandidate) => boolean;
  /**
   * Fill the remaining slots from the bench, but ONLY once a full game is
   * reachable (locked + benched >= the game size). No-op otherwise, so a hunt
   * still in progress never spends its slots on same-day repeats it could
   * have filled properly a pass later. Idempotent.
   */
  topUp: () => void;
  /**
   * The hunt is over: fill whatever slots remain from the bench, however thin
   * the library turned out to be. Appends to `picks` in place and returns it.
   * Idempotent.
   */
  finalize: () => GeoEligibleCandidate[];
}

export function createPickLedger(max: number = QUIZ_MAX_PHOTOS): PickLedger {
  const picks: GeoEligibleCandidate[] = [];
  const bench: GeoEligibleCandidate[] = [];
  const seenIds = new Set<string>();
  const usedDays = new Set<string>();
  const usedCountryYears = new Set<string>();

  const isNearDuplicateOfPick = (candidate: GeoEligibleCandidate): boolean =>
    picks.some((pick) => isNearDuplicatePair(pick, candidate));

  const lock = (candidate: GeoEligibleCandidate): void => {
    picks.push(candidate);
    usedDays.add(photoDayKey(candidate));
    usedCountryYears.add(countryYearKey(candidate));
  };

  const offer = (candidate: GeoEligibleCandidate): boolean => {
    // Burst siblings can clear the gate in SEPARATE batches, so the same-id
    // guard and the near-duplicate check both have to live here rather than in
    // a single end-of-run sweep.
    if (seenIds.has(candidate.id)) return false;
    seenIds.add(candidate.id);
    if (
      picks.length >= max ||
      isNearDuplicateOfPick(candidate) ||
      usedDays.has(photoDayKey(candidate)) ||
      usedCountryYears.has(countryYearKey(candidate))
    ) {
      bench.push(candidate);
      return false;
    }
    lock(candidate);
    return true;
  };

  const promoteFrom = (accept: (candidate: GeoEligibleCandidate) => boolean): void => {
    for (const candidate of bench) {
      if (picks.length >= max) return;
      // `picks` grows inside this loop, so both checks see every photo
      // promoted a moment ago - two benched near-duplicates of each other
      // cannot both be pulled in.
      if (picks.includes(candidate) || isNearDuplicateOfPick(candidate)) continue;
      if (!accept(candidate)) continue;
      lock(candidate);
    }
  };

  const relax = (): void => {
    // Pass 2 (a country-year may repeat across different days) before pass 3
    // (same-day repeats, the last resort) - the same order pickQuizPhotos uses.
    if (picks.length < max) {
      promoteFrom((candidate) => !usedDays.has(photoDayKey(candidate)));
    }
    if (picks.length < max) {
      promoteFrom(() => true);
    }
  };

  const topUp = (): void => {
    if (picks.length + bench.length < max) return;
    relax();
  };

  const finalize = (): GeoEligibleCandidate[] => {
    relax();
    return picks;
  };

  return {
    picks,
    bench,
    offer,
    topUp,
    finalize,
  };
}
