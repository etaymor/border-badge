/**
 * Near-duplicate photo detection - burst frames, HDR pairs, and re-saves land
 * seconds apart at effectively the same coordinate, and play as the same photo
 * on every surface (a quiz question, a vision batch, a preview strip).
 *
 * Moved here from `quiz/candidateSelection.ts` so photo import and curation can
 * reuse it without importing quiz code; the quiz module re-exports these, so
 * its callers and tests are unchanged.
 */

import { haversine } from '@services/photoImport/photoClustering';

/** The minimal shape the duplicate window needs. */
export interface NearDupePhoto {
  id: string;
  /** Unix timestamp (ms). */
  creationTime: number;
  latitude: number;
  longitude: number;
  countryCode: string | null;
}

export const NEAR_DUPLICATE_WINDOW_MS = 90_000;
export const NEAR_DUPLICATE_RADIUS_M = 100;

export function isNearDuplicatePair(a: NearDupePhoto, b: NearDupePhoto): boolean {
  return (
    a.countryCode !== null &&
    a.countryCode === b.countryCode &&
    Math.abs(a.creationTime - b.creationTime) < NEAR_DUPLICATE_WINDOW_MS &&
    haversine(a.latitude, a.longitude, b.latitude, b.longitude) < NEAR_DUPLICATE_RADIUS_M
  );
}

/**
 * Collapse near-duplicate runs to one representative each. Groups chain
 * transitively off each group's latest frame, so a long burst spanning more
 * than one window still collapses to a single photo. Input order is preserved.
 *
 * `pickRepresentative` chooses which member survives; the default keeps the
 * newest frame, which is the exact pre-signals behavior every existing call
 * site relies on. Signal-aware callers pass a quality-based picker instead.
 */
export function collapseNearDuplicates<T extends NearDupePhoto>(
  candidates: T[],
  pickRepresentative: (group: T[]) => T = (group) => group[group.length - 1]
): T[] {
  if (candidates.length < 2) return candidates;
  const sorted = [...candidates].sort((a, b) => a.creationTime - b.creationTime);
  const groups: T[][] = [];
  // Only groups whose latest frame is still inside the window can absorb the
  // next candidate, so the scan stays near-linear on real libraries.
  let open: T[][] = [];
  for (const candidate of sorted) {
    open = open.filter(
      (group) =>
        candidate.creationTime - group[group.length - 1].creationTime < NEAR_DUPLICATE_WINDOW_MS
    );
    const match = open.find((group) => isNearDuplicatePair(group[group.length - 1], candidate));
    if (match) {
      match.push(candidate);
    } else {
      const group = [candidate];
      groups.push(group);
      open.push(group);
    }
  }
  const keep = new Set(groups.map((group) => pickRepresentative(group).id));
  return candidates.filter((candidate) => keep.has(candidate.id));
}

/**
 * Drop pool entries that are near-duplicates of any anchor (including the
 * anchors themselves). Used by the swap picker so a quiz's own photos - and
 * their burst siblings - never re-enter the candidate list (BUG-2).
 */
export function filterNearDuplicatesOf<T extends NearDupePhoto>(
  pool: T[],
  anchors: NearDupePhoto[]
): T[] {
  if (anchors.length === 0) return pool;
  return pool.filter(
    (candidate) =>
      !anchors.some(
        (anchor) => anchor.id === candidate.id || isNearDuplicatePair(anchor, candidate)
      )
  );
}
