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
 *   then day-spread across that country's whole history) so neither a single
 *   photo-dense country nor a single recent trip monopolizes the vision
 *   budget.
 * - KTD12/R17: freshness. Asset ids already used by the owner's existing
 *   quizzes sort strictly after every fresh candidate, so repeats only happen
 *   once the fresh pool is exhausted.
 *
 * Everything here is pure and synchronous; the country coder is injected so
 * tests never touch the ~2.2MB country-coder dataset. Callers pass the LAZY
 * accessor from `@services/photoImport/countryCoder` - never a top-level
 * `@rapideditor/country-coder` import (kept off the boot path deliberately).
 */

import { collapseNearDuplicates } from '@services/photoSignals/nearDuplicates';

import type { CachedPhoto } from '@services/photoImport/types';

import { DEFAULT_TIER, TIER_ORDER } from './tagSignals';
import type { PrefilterTier, TagSignals } from './tagSignals';

// The near-duplicate machinery moved to the shared signal layer so photo
// import and curation can use it; re-exported here so quiz callers and tests
// are unchanged.
export {
  NEAR_DUPLICATE_RADIUS_M,
  NEAR_DUPLICATE_WINDOW_MS,
  collapseNearDuplicates,
  filterNearDuplicatesOf,
  isNearDuplicatePair,
} from '@services/photoSignals/nearDuplicates';

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
  /** Pixel dimensions when the scan captured them (saved-from-social check). */
  width?: number;
  height?: number;
  /**
   * On-device Vision signals, attached by the caller when available. Absent for
   * untagged photos, on Android, and in builds without the native module -- in
   * all of which cases ordering must be exactly what it was before tagging
   * existed. See `tagSignals.ts`.
   */
  tags?: TagSignals;
  /** Pre-computed tier for `tags`; absent means `DEFAULT_TIER`. */
  tier?: PrefilterTier;
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
    width: cached.width,
    height: cached.height,
  };
}

/**
 * Pick the frame of a near-duplicate run that should survive: the highest
 * composite quality, falling back to the newest frame (the collapse default)
 * when nothing is scored - so an untagged pool collapses exactly as it always
 * has. "Favorited beats edited beats prettiest" needs no special casing here
 * because the quality weights already encode that ordering.
 */
function bestFrame<T extends GeoEligibleCandidate>(group: T[]): T {
  let best = group[group.length - 1];
  for (const candidate of group) {
    if ((candidate.tags?.qualityScore ?? 0) > (best.tags?.qualityScore ?? 0)) best = candidate;
  }
  return best;
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

export function countryYearKey(candidate: GeoEligibleCandidate): string {
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
/** Resample pass bounds; the size between them is chosen per pass (KTD3). */
export const RESAMPLE_BATCH_MIN = 20;
export const RESAMPLE_BATCH_MAX = 50;
/**
 * Client-side mirror of the server's per-draft budget (KTD3). MUST equal
 * `quiz_classification_budget_per_quiz` - a client that believes it has more
 * budget than the server just walks into a 429 it could have avoided.
 */
export const CLASSIFICATION_BUDGET_PER_QUIZ = 300;

/**
 * Assumed pass rate before the gate has told us anything, and the floor used
 * once it has. The floor matters more than the guess: a pass rate of 0 (every
 * photo so far rejected) must not divide into an infinite batch.
 */
const ASSUMED_PASS_RATE = 0.2;
const MIN_ASSUMED_PASS_RATE = 0.05;

/**
 * How many images the next resample pass should ask for.
 *
 * Sized by the pass rate observed so far, because the two libraries this has
 * to serve want opposite things. One where nearly everything passes should
 * draw small batches and stop as soon as the game is full; one where ~5%
 * passes needs ~200 more images, and asking for those 20 at a time turns a
 * creation into ten round trips. Scaling by the observed rate lets the same
 * budget be spent in ~6 requests instead of ~13 - well inside the endpoint's
 * 30/hour limit either way, but far less waiting.
 *
 * Callers still clamp the result by the remaining budget; this only decides
 * how much is worth asking for.
 */
export function nextResampleSize(needed: number, sent: number, eligible: number): number {
  const rate = sent > 0 ? Math.max(eligible / sent, MIN_ASSUMED_PASS_RATE) : ASSUMED_PASS_RATE;
  const wanted = Math.ceil(Math.max(needed, 0) / rate);
  return Math.min(RESAMPLE_BATCH_MAX, Math.max(RESAMPLE_BATCH_MIN, wanted));
}
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
 * Visit `length` positions in maximum-spread order: both ends first, then the
 * midpoint of each remaining gap, recursively (0, n-1, mid, quarters, ...).
 *
 * Deterministic, so retries and tests behave identically - the reason this is
 * a bisection rather than a shuffle.
 */
function spreadIndices(length: number): number[] {
  if (length <= 2) return Array.from({ length }, (_, index) => index);
  const ordered: number[] = [];
  const seen = new Set<number>();
  const visit = (index: number) => {
    if (!seen.has(index)) {
      seen.add(index);
      ordered.push(index);
    }
  };
  visit(0);
  visit(length - 1);
  const gaps: Array<[number, number]> = [[0, length - 1]];
  while (gaps.length > 0) {
    const [low, high] = gaps.shift()!;
    if (high - low < 2) continue;
    const middle = Math.floor((low + high) / 2);
    visit(middle);
    gaps.push([low, middle], [middle, high]);
  }
  return ordered;
}

/**
 * Order one country's candidates by DAY spread, across the WHOLE history of
 * that country rather than starting from the most recent day.
 *
 * Two rules, in order:
 * 1. Days are visited in maximum-spread order (oldest, newest, then the gaps),
 *    so a country visited three times contributes a day from each visit before
 *    it contributes a second day from any of them.
 * 2. Each day's first photo comes before any day's second photo, so one busy
 *    day cannot monopolize the country's slots.
 *
 * Deliberately NOT newest-first: the vision budget only reaches ~70 photos, and
 * taking the newest days first spent all of them on whichever trip happened
 * most recently - or, worse, on the everyday photos taken since. Spreading
 * across the years is what makes the sample look like a travel archive.
 */
function orderByDaySpread(list: GeoEligibleCandidate[]): GeoEligibleCandidate[] {
  const sorted = [...list].sort((a, b) => a.creationTime - b.creationTime);
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
  // Within a day, best photo first. Rule 2 above means each day's FIRST photo is
  // its representative in the round-robin, so this is the cheapest available
  // "better photos" lever: same days, same counts, better picture from each.
  //
  // Array.prototype.sort is stable, and untagged candidates all score 0, so a
  // pool with no tags comes out in exactly the chronological order it went in.
  for (const day of byDay.values()) {
    day.sort((a, b) => (b.tags?.qualityScore ?? 0) - (a.tags?.qualityScore ?? 0));
  }
  // Chronological (insertion order follows `sorted`), then spread.
  const chronologicalDays = [...byDay.values()];
  const days = spreadIndices(chronologicalDays.length).map((index) => chronologicalDays[index]);
  const ordered: GeoEligibleCandidate[] = [];
  for (let index = 0; ordered.length < sorted.length; index++) {
    for (const day of days) {
      if (index < day.length) ordered.push(day[index]);
    }
  }
  return ordered;
}

/**
 * Round-robin candidates across countries, day-spread across each country's
 * whole history. Country order within each cycle is deterministic (largest
 * pool first, then code) so tests and retries behave identically. Yields
 * lazily so consumers that stop at a limit never materialize the full
 * interleaving.
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
 *
 * Within each segment, candidates are further split by on-device quality tier
 * (`likely` before `unknown` before `marginal`) and each tier is independently
 * round-robined across countries. Freshness outranks quality deliberately: a
 * gorgeous photo already used in another challenge is still a repeat.
 *
 * When nothing is tagged, every candidate lands in the single default tier, so
 * the tier split collapses and the output is byte-identical to the ordering
 * before tagging existed. `candidateSelection.test.ts` locks that down.
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
    for (const tier of TIER_ORDER) {
      const inTier = segment.filter((candidate) => (candidate.tier ?? DEFAULT_TIER) === tier);
      if (inTier.length > 0) yield* roundRobinByCountry(inTier);
    }
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

/**
 * The half of batch selection that costs O(library): the cheap geo gate over
 * every cached photo, then the near-duplicate collapse (a sort plus a windowed
 * scan).
 *
 * Split out so a creation pays it ONCE. Neither step depends on which photos
 * have already been classified or which countries the current pass wants, so
 * repeating it per resample was pure waste - invisible at two passes, a
 * multi-second stall on a large library once the hunt runs seven or more.
 */
export function prepareCandidatePool(
  pool: QuizPhotoCandidate[],
  validCodes: Set<string>
): GeoEligibleCandidate[] {
  const cheapEligible: GeoEligibleCandidate[] = [];
  for (const photo of pool) {
    // Cached verdicts are authoritative: null means the scan already coded
    // this photo as no-fix/ocean - do not spend coder work re-checking it.
    const code = photo.countryCode;
    if (!code || !validCodes.has(code)) continue;
    cheapEligible.push({ ...photo, countryCode: code });
  }
  // Burst frames must not each spend a vision-budget slot (BUG-2): collapse
  // near-duplicates before any batch is ordered and capped.
  return collapseNearDuplicates(cheapEligible);
}

export interface SelectEligibilityBatchOptions {
  /**
   * Candidates to draw from. Either raw cached photos (prepared internally) or
   * the output of `prepareCandidatePool`, which is what a multi-pass creation
   * should pass so the O(library) work happens once.
   */
  pool: QuizPhotoCandidate[];
  /** Codes present in the app's country table (KTD2 mapping check). */
  validCodes: Set<string>;
  /** Set when `pool` is already the output of `prepareCandidatePool`. */
  prepared?: boolean;
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
 * The O(library) half (geo gate + near-duplicate collapse) is
 * `prepareCandidatePool`; pass its output with `prepared: true` to skip it.
 * What remains is lazy: `excludeIds` is a Set lookup during the walk and the
 * 4-point border probe only runs on candidates actually reached, so a pass
 * costs ~limit rather than the library size.
 */
export function selectEligibilityBatch(
  options: SelectEligibilityBatchOptions
): GeoEligibleCandidate[] {
  const {
    pool,
    validCodes,
    prepared,
    coder,
    limit,
    usedAssetIds,
    excludeIds,
    deprioritizedCountries,
  } = options;

  const collapsed = prepared
    ? (pool as GeoEligibleCandidate[])
    : prepareCandidatePool(pool, validCodes);

  // Walk the spread ordering lazily: already-classified and border-ambiguous
  // candidates are skipped and replaced by the next in line, so this may
  // consume more than `limit` ordered entries - but never materializes the
  // full interleaving.
  const batch: GeoEligibleCandidate[] = [];
  for (const candidate of iterateCountrySpread(
    collapsed,
    usedAssetIds ?? new Set(),
    deprioritizedCountries ?? new Set()
  )) {
    if (batch.length >= limit) break;
    if (excludeIds?.has(candidate.id)) continue;
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
  const collapsed = collapseNearDuplicates([...uniqueById.values()], bestFrame);
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
