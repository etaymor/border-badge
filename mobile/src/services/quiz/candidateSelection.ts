/**
 * Quiz candidate selection - pure logic for choosing which library photos to
 * send through the eligibility gate and which eligible photos become the quiz.
 *
 * Responsibilities:
 * - KTD2: border/no-fix exclusion. A photo is geo-ineligible when the cached
 *   country code is null (ocean / no GPS fix), when its code does not map to
 *   the app's country table, or when a cheap 4-point probe at
 *   +/-BORDER_PROBE_DELTA_DEG around the coordinate resolves to more than one
 *   country (border-ambiguous ground truth).
 * - KTD3: sampling budget. Candidates are stratified by country (round-robin,
 *   newest first within a country) so a single photo-dense country cannot
 *   monopolize the vision budget.
 * - KTD12/R17: freshness. Asset ids already used by the owner's existing
 *   quizzes sort strictly after every fresh candidate, so repeats only happen
 *   once the fresh pool is exhausted.
 *
 * Everything here is pure and synchronous; the country coder is injected so
 * tests never touch the ~2.2MB country-coder dataset. Callers pass the LAZY
 * accessor from `@services/photoImport/countryCoder` - never a top-level
 * `@rapideditor/country-coder` import (kept off the boot path deliberately).
 */

import { haversine } from '@services/photoImport/photoClustering';

import type { CachedPhoto } from '@services/photoImport/types';

/** country-coder's iso1A2Code call shape (the subset we use). */
export type CountryCoderFn = (
  coordinate: [number, number],
  options?: { level?: string }
) => string | null;

/** Minimal shape of a cached library photo considered for a quiz. */
export interface QuizPhotoCandidate {
  id: string;
  uri: string;
  /** Unix timestamp (ms). */
  creationTime: number;
  latitude: number;
  longitude: number;
  /** Precomputed country code from the photo cache; null = no fix. */
  countryCode: string | null;
}

/** A candidate that passed the geo gate; countryCode is resolved and valid. */
export interface GeoEligibleCandidate extends QuizPhotoCandidate {
  countryCode: string;
  /** Scenic lookalike tag from the eligibility classifier; omitted on swaps. */
  landscape?: string | null;
}

/** Map a cached library photo to the candidate shape used for selection. */
export function toCandidate(cached: CachedPhoto): QuizPhotoCandidate {
  return {
    id: cached.id,
    uri: cached.uri,
    creationTime: cached.creationTime,
    latitude: cached.latitude,
    longitude: cached.longitude,
    countryCode: cached.countryCode,
  };
}

/**
 * Near-duplicate window (BUG-2): burst frames, HDR pairs, and re-saves land
 * seconds apart at effectively the same coordinate. Frames this close in time
 * AND space play as the same photo, so only one of them may reach a quiz.
 */
export const NEAR_DUPLICATE_WINDOW_MS = 90_000;
export const NEAR_DUPLICATE_RADIUS_M = 100;

function isNearDuplicatePair(a: QuizPhotoCandidate, b: QuizPhotoCandidate): boolean {
  return (
    a.countryCode !== null &&
    a.countryCode === b.countryCode &&
    Math.abs(a.creationTime - b.creationTime) < NEAR_DUPLICATE_WINDOW_MS &&
    haversine(a.latitude, a.longitude, b.latitude, b.longitude) < NEAR_DUPLICATE_RADIUS_M
  );
}

/**
 * Collapse near-duplicate runs to their newest frame. Groups chain
 * transitively off each group's latest frame, so a long burst spanning more
 * than one window still collapses to a single photo. Input order is preserved.
 */
export function collapseNearDuplicates<T extends GeoEligibleCandidate>(candidates: T[]): T[] {
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
  const keep = new Set(groups.map((group) => group[group.length - 1].id));
  return candidates.filter((candidate) => keep.has(candidate.id));
}

/**
 * Drop pool entries that are near-duplicates of any anchor (including the
 * anchors themselves). Used by the swap picker so a quiz's own photos - and
 * their burst siblings - never re-enter the candidate list (BUG-2).
 */
export function filterNearDuplicatesOf<T extends QuizPhotoCandidate>(
  pool: T[],
  anchors: QuizPhotoCandidate[]
): T[] {
  if (anchors.length === 0) return pool;
  return pool.filter(
    (candidate) =>
      !anchors.some(
        (anchor) => anchor.id === candidate.id || isNearDuplicatePair(anchor, candidate)
      )
  );
}

/**
 * Diversity keys (game variety): two photos from the same calendar day - or
 * the same (country, year) pair - play as near-repeats even when they are
 * genuinely distinct shots. UTC days keep the keys deterministic; a photo's
 * exact local midnight is irrelevant to variety.
 */
export function photoDayKey(candidate: QuizPhotoCandidate): string {
  return new Date(candidate.creationTime).toISOString().slice(0, 10);
}

function countryYearKey(candidate: GeoEligibleCandidate): string {
  return `${candidate.countryCode}:${new Date(candidate.creationTime).getUTCFullYear()}`;
}

/**
 * Drop pool entries that share a calendar day with any anchor. Used by the
 * swap picker: a replacement photo from the same day as one already in the
 * quiz would break the no-same-day-in-one-game rule.
 */
export function filterSameDayAs<T extends QuizPhotoCandidate>(
  pool: T[],
  anchors: QuizPhotoCandidate[]
): T[] {
  if (anchors.length === 0) return pool;
  const anchorDays = new Set(anchors.map(photoDayKey));
  return pool.filter((candidate) => !anchorDays.has(photoDayKey(candidate)));
}

export type GeoExclusionReason = 'no-country' | 'unmapped-territory' | 'border-ambiguous';

export type CandidateCountryResolution =
  | { eligible: true; countryCode: string }
  | { eligible: false; reason: GeoExclusionReason };

/** First vision batch cap (matches the server's per-request image cap). */
export const FIRST_BATCH_MAX = 50;
/** Single resample pass cap (KTD3). */
export const RESAMPLE_BATCH_MAX = 20;
/** Client-side mirror of the server's ~70-image per-draft budget (KTD3). */
export const CLASSIFICATION_BUDGET_PER_QUIZ = 70;
/** Quiz size bounds (mirror the backend finalize bounds). */
export const QUIZ_MIN_PHOTOS = 5;
export const QUIZ_MAX_PHOTOS = 10;
/** ~2km probe offset used for the border-ambiguity check (KTD2). */
export const BORDER_PROBE_DELTA_DEG = 0.02;

/**
 * 4-point probe around the coordinate: north, south, east, west at
 * +/-BORDER_PROBE_DELTA_DEG. Ambiguous when any probe resolves to a DIFFERENT
 * country. Null probes are ignored - open water next to a coastal photo is
 * not a competing country.
 */
export function isBorderAmbiguous(candidate: GeoEligibleCandidate, coder: CountryCoderFn): boolean {
  const { latitude, longitude, countryCode } = candidate;
  const probes: Array<[number, number]> = [
    [longitude, latitude + BORDER_PROBE_DELTA_DEG],
    [longitude, latitude - BORDER_PROBE_DELTA_DEG],
    [longitude + BORDER_PROBE_DELTA_DEG, latitude],
    [longitude - BORDER_PROBE_DELTA_DEG, latitude],
  ];
  for (const probe of probes) {
    const code = coder(probe, { level: 'territory' });
    if (code && code !== countryCode) {
      return true;
    }
  }
  return false;
}

/**
 * Full geo-eligibility resolution for one photo (KTD2).
 *
 * Uses the cached country code when present (the scan precomputed it); falls
 * back to the coder only when the cache carries no verdict at all.
 */
export function resolveCandidateCountry(
  candidate: QuizPhotoCandidate,
  coder: CountryCoderFn,
  validCodes: Set<string>
): CandidateCountryResolution {
  const code =
    candidate.countryCode ??
    coder([candidate.longitude, candidate.latitude], { level: 'territory' });
  if (!code) {
    return { eligible: false, reason: 'no-country' };
  }
  if (!validCodes.has(code)) {
    return { eligible: false, reason: 'unmapped-territory' };
  }
  if (isBorderAmbiguous({ ...candidate, countryCode: code }, coder)) {
    return { eligible: false, reason: 'border-ambiguous' };
  }
  return { eligible: true, countryCode: code };
}

/**
 * Order one country's candidates by DAY spread: newest first, but each
 * distinct day's first photo comes before any day's second photo. Same-day
 * repeats therefore enter a capped batch only sparingly - after every day
 * has had its turn - instead of one busy day monopolizing the country's
 * slots.
 */
function orderByDaySpread(list: GeoEligibleCandidate[]): GeoEligibleCandidate[] {
  const sorted = [...list].sort((a, b) => b.creationTime - a.creationTime);
  const byDay = new Map<string, GeoEligibleCandidate[]>();
  for (const candidate of sorted) {
    const key = photoDayKey(candidate);
    const day = byDay.get(key);
    if (day) {
      day.push(candidate);
    } else {
      byDay.set(key, [candidate]);
    }
  }
  const days = [...byDay.values()];
  const ordered: GeoEligibleCandidate[] = [];
  for (let index = 0; ordered.length < sorted.length; index++) {
    for (const day of days) {
      if (index < day.length) ordered.push(day[index]);
    }
  }
  return ordered;
}

/**
 * Round-robin candidates across countries, day-spread newest-first within a
 * country. Country order within each cycle is deterministic (largest pool
 * first, then code) so tests and retries behave identically. Yields lazily
 * so consumers that stop at a limit never materialize the full interleaving.
 */
function* roundRobinByCountry(candidates: GeoEligibleCandidate[]): Generator<GeoEligibleCandidate> {
  const byCountry = new Map<string, GeoEligibleCandidate[]>();
  for (const candidate of candidates) {
    const list = byCountry.get(candidate.countryCode);
    if (list) {
      list.push(candidate);
    } else {
      byCountry.set(candidate.countryCode, [candidate]);
    }
  }
  for (const [code, list] of byCountry) {
    byCountry.set(code, orderByDaySpread(list));
  }
  const countries = [...byCountry.keys()].sort((a, b) => {
    const sizeDiff = byCountry.get(b)!.length - byCountry.get(a)!.length;
    return sizeDiff !== 0 ? sizeDiff : a.localeCompare(b);
  });

  let yielded = 0;
  for (let index = 0; yielded < candidates.length; index++) {
    for (const country of countries) {
      const list = byCountry.get(country)!;
      if (index < list.length) {
        yield list[index];
        yielded += 1;
      }
    }
  }
}

/**
 * Lazily iterate candidates by country spread with freshness segments:
 * 1. fresh photos in preferred countries
 * 2. fresh photos in deprioritized countries
 * 3. previously used photos in preferred countries (KTD12: only after ALL fresh)
 * 4. previously used photos in deprioritized countries
 * Each segment is independently round-robined across countries.
 */
function* iterateCountrySpread(
  candidates: GeoEligibleCandidate[],
  usedAssetIds: Set<string>,
  deprioritizedCountries: Set<string>
): Generator<GeoEligibleCandidate> {
  const segments: [
    GeoEligibleCandidate[],
    GeoEligibleCandidate[],
    GeoEligibleCandidate[],
    GeoEligibleCandidate[],
  ] = [[], [], [], []];
  for (const candidate of candidates) {
    const usedOffset = usedAssetIds.has(candidate.id) ? 2 : 0;
    const deprioritizedOffset = deprioritizedCountries.has(candidate.countryCode) ? 1 : 0;
    segments[usedOffset + deprioritizedOffset].push(candidate);
  }
  for (const segment of segments) {
    yield* roundRobinByCountry(segment);
  }
}

/**
 * Order candidates by country spread (see `iterateCountrySpread` for the
 * segment rules). `limit` caps the result: accumulation stops once the limit
 * is reached, and the output is always the identical prefix of the unlimited
 * ordering.
 */
export function orderByCountrySpread(
  candidates: GeoEligibleCandidate[],
  usedAssetIds: Set<string> = new Set(),
  deprioritizedCountries: Set<string> = new Set(),
  limit: number = Infinity
): GeoEligibleCandidate[] {
  const ordered: GeoEligibleCandidate[] = [];
  for (const candidate of iterateCountrySpread(candidates, usedAssetIds, deprioritizedCountries)) {
    if (ordered.length >= limit) break;
    ordered.push(candidate);
  }
  return ordered;
}

export interface SelectEligibilityBatchOptions {
  /** All cached photos not yet ruled out (may include null country codes). */
  pool: QuizPhotoCandidate[];
  /** Codes present in the app's country table (KTD2 mapping check). */
  validCodes: Set<string>;
  /** Injected lazy country coder (border probe). */
  coder: CountryCoderFn;
  /** Batch cap: FIRST_BATCH_MAX or RESAMPLE_BATCH_MAX (KTD3). */
  limit: number;
  /** Asset ids already used in the owner's existing quizzes (KTD12). */
  usedAssetIds?: Set<string>;
  /** Photos already sent to the classifier this creation (never re-send). */
  excludeIds?: Set<string>;
  /** Countries already classified - resample prefers unclassified ones. */
  deprioritizedCountries?: Set<string>;
}

/**
 * Select the next batch of photos to send through the vision eligibility gate.
 *
 * Cheap checks (cached code present + mapped) run over the whole pool; the
 * 4-point border probe only runs while walking the ordered list, so coder
 * work is bounded by ~limit + rejected candidates rather than the library
 * size.
 */
export function selectEligibilityBatch(
  options: SelectEligibilityBatchOptions
): GeoEligibleCandidate[] {
  const { pool, validCodes, coder, limit, usedAssetIds, excludeIds, deprioritizedCountries } =
    options;

  const cheapEligible: GeoEligibleCandidate[] = [];
  for (const photo of pool) {
    if (excludeIds?.has(photo.id)) continue;
    // Cached verdicts are authoritative: null means the scan already coded
    // this photo as no-fix/ocean - do not spend coder work re-checking it.
    const code = photo.countryCode;
    if (!code || !validCodes.has(code)) continue;
    cheapEligible.push({ ...photo, countryCode: code });
  }

  // Burst frames must not each spend a vision-budget slot (BUG-2): collapse
  // near-duplicates before the batch is ordered and capped.
  const collapsed = collapseNearDuplicates(cheapEligible);

  // Walk the spread ordering lazily: border-ambiguous candidates are skipped
  // and replaced by the next in line, so this may consume more than `limit`
  // ordered entries - but never materializes the full interleaving.
  const batch: GeoEligibleCandidate[] = [];
  for (const candidate of iterateCountrySpread(
    collapsed,
    usedAssetIds ?? new Set(),
    deprioritizedCountries ?? new Set()
  )) {
    if (batch.length >= limit) break;
    if (isBorderAmbiguous(candidate, coder)) continue;
    batch.push(candidate);
  }
  return batch;
}

/**
 * Pick the final quiz photos from the vision-eligible set: country spread
 * first (R1), fresh before used (KTD12), capped at QUIZ_MAX_PHOTOS. Callers
 * decline the creation when fewer than QUIZ_MIN_PHOTOS come back (AE2).
 */
export function pickQuizPhotos(
  eligible: GeoEligibleCandidate[],
  usedAssetIds: Set<string> = new Set(),
  max: number = QUIZ_MAX_PHOTOS
): GeoEligibleCandidate[] {
  // Belt-and-braces same-id guard, then a final near-duplicate collapse:
  // burst siblings classified in SEPARATE batches can both reach the eligible
  // pool, and the picked quiz must never contain two of them (BUG-2).
  const uniqueById = new Map<string, GeoEligibleCandidate>();
  for (const candidate of eligible) {
    if (!uniqueById.has(candidate.id)) uniqueById.set(candidate.id, candidate);
  }
  const collapsed = collapseNearDuplicates([...uniqueById.values()]);
  const ordered = orderByCountrySpread(collapsed, usedAssetIds, new Set(), Infinity);

  // Diversity passes: a game should never repeat a calendar day or a
  // (country, year) pair - two shots from one day (or one trip) play as the
  // same question. Each pass relaxes one rule, and later passes run ONLY
  // when the library is too thin to fill the game diversely:
  //   1. distinct day AND distinct (country, year)
  //   2. distinct day (a country-year may repeat across different days)
  //   3. anything left (same-day repeats are the last resort)
  const picks: GeoEligibleCandidate[] = [];
  const pickedIds = new Set<string>();
  const usedDays = new Set<string>();
  const usedCountryYears = new Set<string>();
  const passes: Array<(candidate: GeoEligibleCandidate) => boolean> = [
    (candidate) =>
      !usedDays.has(photoDayKey(candidate)) && !usedCountryYears.has(countryYearKey(candidate)),
    (candidate) => !usedDays.has(photoDayKey(candidate)),
    () => true,
  ];
  for (const accept of passes) {
    for (const candidate of ordered) {
      if (picks.length >= max) break;
      if (pickedIds.has(candidate.id) || !accept(candidate)) continue;
      picks.push(candidate);
      pickedIds.add(candidate.id);
      usedDays.add(photoDayKey(candidate));
      usedCountryYears.add(countryYearKey(candidate));
    }
    if (picks.length >= max) break;
  }
  return picks;
}
