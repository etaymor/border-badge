/**
 * quizPoolSetup - Everything that has to happen ONCE before the hunt can draw
 * its first batch, and everything a resumed build has to rebuild.
 *
 * Refresh the photo cache, geo-gate and de-duplicate the pool, apply the
 * on-device pre-filter, seed from verdicts this device has already paid for,
 * and mint (or reuse) the server draft.
 *
 * RESUME IS WHY THIS IS A MODULE. None of it is stored in the checkpoint - the
 * pool is tens of thousands of candidates and the session holds Maps. Instead
 * this whole function re-runs on resume, which is cheap in the way that
 * matters: `seedFromVerdicts` reads back every classification the interrupted
 * run already bought, so a resumed build re-derives its state from SQLite
 * rather than re-buying it. The one thing that must NOT be re-derived is the
 * order photos were locked in, so `rehydrateLedger` replays the checkpoint's
 * slots BEFORE seeding offers anything new.
 */

import { features } from '@config/features';
import { Analytics } from '@services/analytics';
import { getAllCountries, getHomeCountry } from '@services/countriesDb';
import { iso1A2Code } from '@services/photoImport/countryCoder';
import { ensureFreshLibrary } from '@services/photoImport/photoBackgroundSync';
import { getAllCachedPhotos } from '@services/photoImport/photoCacheDb';
import { api } from '@services/api';
import type { CachedPhoto } from '@services/photoImport/types';

import {
  CLASSIFICATION_BUDGET_PER_QUIZ,
  FIRST_BATCH_MAX,
  QUIZ_MAX_PHOTOS,
  QUIZ_MIN_PHOTOS,
  orderByCountrySpread,
  prepareCandidatePool,
  selectEligibilityBatch,
  toCandidate,
} from './candidateSelection';
import type { GeoEligibleCandidate } from './candidateSelection';
import { CANDIDATE_OVERSELECT, createClassificationSession } from './quizClassification';
import type { ClassificationSession } from './quizClassification';
import { decoratePoolWithTags, formatTagFunnel } from './quizCandidateTags';
import type { DecoratedPool } from './quizCandidateTags';
import { discardDraft, getUsedAssetIds, loadDraftState, saveDraftState } from './quizDraftStore';
import { rehydrateLedger } from './quizCheckpoint';
import { createHuntClock } from './quizHuntClock';
import type { HuntClock } from './quizHuntClock';
import type { QuizBuildCheckpoint } from './quizCheckpoint';
import { computeAgreement } from './tagAgreement';
import { loadCurrentVerdicts, seedFromVerdicts } from './quizVerdictStore';

import type { QuizCreationOutcome, QuizCreationProgress, QuizRunEnv } from './quizCreationTypes';

/**
 * The heavyweight state of one build, held in memory for the life of the
 * process. Never serialized: see `quizCheckpoint.ts` for what actually
 * survives a suspend.
 */
export interface QuizRunState {
  quizId: string;
  session: ClassificationSession;
  rankedPool: GeoEligibleCandidate[];
  poolById: Map<string, GeoEligibleCandidate>;
  validCodes: Set<string>;
  usedAssetIds: Set<string>;
  homeCountries: Set<string>;
  /** Previously-used photos, held back until the fresh library runs dry (KTD12). */
  reserve: GeoEligibleCandidate[];
  decorated: DecoratedPool;
  seededEligible: number;
  draftCreatedAt: number;
  /**
   * When THIS process started hunting. Deliberately not in the checkpoint: the
   * soft deadline exists to cap how long a user waits, and time the app spent
   * suspended is not time anyone waited. Used for the funnel log only; the
   * deadline itself reads `huntClock`.
   */
  huntStartedAt: number;
  /**
   * Executing-time accumulator for the soft deadline. Wall-clock time counts
   * frozen minutes (iOS < 26 backgrounding) as hunting; this does not. See
   * `quizHuntClock`.
   */
  huntClock: HuntClock;
  /** Images sent / photos passed BEFORE this process took over, from the checkpoint. */
  priorSent: number;
  priorEligible: number;
  /**
   * The larger opening draw (KTD3). Only pass 0 uses it; a resumed build that
   * is already past its first pass recomputes it here and never reads it.
   */
  firstBatch: GeoEligibleCandidate[];
}

export type SetupResult =
  | { status: 'ready'; run: QuizRunState }
  /** A terminal outcome reached before the hunt could start (decline, outage). */
  | { status: 'outcome'; outcome: QuizCreationOutcome };

/**
 * Decorate a progress callback so every emission carries the running pick
 * URIs. The creation screen renders the game live - hero = the most recent
 * find, thumbnail grid = every locked slot in order - so the list rides along
 * with each count update instead of arriving only at the end. The getter is
 * read per emission, so callers hand over a live view, not a copy.
 */
export function withPickUris(
  onProgress: ((progress: QuizCreationProgress) => void) | undefined,
  getPickUris: () => string[]
): ((progress: QuizCreationProgress) => void) | undefined {
  if (!onProgress) return undefined;
  // Reuse the last emitted array when its contents are unchanged, so
  // consumers comparing by reference see churn only when a pick actually
  // lands (the getter builds a fresh array on every read).
  let lastEmitted: string[] | null = null;
  return (progress) => {
    const next = getPickUris();
    const prev = lastEmitted;
    const pickUris =
      prev !== null &&
      prev.length === next.length &&
      next.every((uri, index) => prev[index] === uri)
        ? prev
        : next;
    lastEmitted = pickUris;
    onProgress({ ...progress, pickUris });
  };
}

/** The game's live slot URIs, for `withPickUris`. */
export function gamePickUris(run: QuizRunState): string[] {
  return run.session.ledger.picks.map((candidate) => candidate.uri);
}

/**
 * Upper bound on the game `ledger.finalize()` could reach: the locked slots
 * plus whatever the relaxed passes might still promote off the bench. Used
 * only to decide whether to keep hunting - the real size comes from
 * `finalize()` itself, once.
 */
export function finalizableCount(run: QuizRunState): number {
  const { ledger } = run.session;
  return Math.min(QUIZ_MAX_PHOTOS, ledger.picks.length + ledger.bench.length);
}

/**
 * The fresh library has nothing more to give: let previously-used photos fill
 * what the hunt could not. Called only at exhaustion points, never to shortcut
 * a hunt that could still find unseen photos.
 */
export function offerReserve(run: QuizRunState): void {
  for (const candidate of run.reserve) run.session.ledger.offer(candidate);
  run.session.ledger.topUp();
}

/**
 * Emit one aggregate agreement event per creation.
 *
 * Aggregate only - no per-photo events, no asset ids. Silent when nothing was
 * both predicted and classified, which is the normal case on a device with no
 * tag coverage yet.
 */
export function reportPrefilterAgreement(run: QuizRunState): void {
  const agreement = computeAgreement(run.session.verdictsById, run.decorated.tierById);
  if (agreement.compared === 0) return;
  Analytics.quizPrefilterAgreement({
    compared: agreement.compared,
    likelySent: agreement.byTier.likely.sent,
    likelyPassed: agreement.byTier.likely.passed,
    unknownSent: agreement.byTier.unknown.sent,
    unknownPassed: agreement.byTier.unknown.passed,
    marginalSent: agreement.byTier.marginal.sent,
    marginalPassed: agreement.byTier.marginal.passed,
    likelyRejected: agreement.likelyRejected,
    dropped: run.decorated.dropped,
    untagged: run.decorated.untagged,
    seededEligible: run.seededEligible,
  });
}

/**
 * Bring the cache up to date, build the pool, restore what is already known,
 * and make sure a server draft exists.
 *
 * Runs on a fresh build AND on every resume. `checkpoint` carries what the
 * interrupted run had already achieved; on a fresh build it is the initial
 * one and every restore below is a no-op.
 */
export async function setUpQuizRun(
  env: QuizRunEnv,
  checkpoint: QuizBuildCheckpoint
): Promise<SetupResult> {
  const { signal, onProgress } = env;

  // Step 1: bring the photo cache up to date (KTD1) - via the shared
  // ensureFreshLibrary flow (P1). A fresh or writer-owned cache emits NO
  // scanning progress at all: the wizard's scan step only exists when a
  // scan actually runs.
  let cached: CachedPhoto[];
  const refresh = await ensureFreshLibrary({
    source: 'quiz',
    // The job runtime marks 'quiz-build' running before this function's
    // caller (the job itself) even starts (jobRuntime.runStart), so the
    // freshness check must not read that as an already-active writer - else
    // it always defers to whatever the cache holds, which on a first build
    // is nothing, and the scan that should run never does.
    excludeKind: 'quiz-build',
    onProgress: (progress) => {
      env.heartbeat?.();
      onProgress?.({ step: 'scanning', current: progress.current, total: progress.total });
    },
    signal,
  });
  env.heartbeat?.();
  if (signal?.aborted) return { status: 'outcome', outcome: { status: 'cancelled' } };
  if (refresh.status === 'failed' || refresh.status === 'no-permission') {
    // A failed refresh (or a permission read that came back negative even
    // though the screen already gated permission before starting - the OS
    // authorization state can lag the grant by a beat right after the
    // system prompt is dismissed) degrades to stale candidates when a cache
    // already exists. On a first-ever build there IS no cache yet, so this
    // must NOT fall through to the geo gate: an empty pool there reads as
    // "no geotagged travel photos in your library", which is false - the
    // scan never ran. Retryable instead.
    cached = await getAllCachedPhotos().catch(() => []);
    if (cached.length === 0) {
      return { status: 'outcome', outcome: { status: 'service-error', stage: 'scan' } };
    }
  } else {
    // 'fresh', 'refreshed', and 'deferred' (another writer owns the cache:
    // use it as-is) all proceed.
    cached = await getAllCachedPhotos();
  }
  if (signal?.aborted) return { status: 'outcome', outcome: { status: 'cancelled' } };

  const persisted = await loadDraftState();
  const [countries, usedAssetIds, homeCountry] = await Promise.all([
    getAllCountries(),
    getUsedAssetIds(),
    getHomeCountry().catch(() => null),
  ]);
  const validCodes = new Set(countries.map((country) => country.code));
  const pool = cached.map(toCandidate);

  // Home-country photos are everyday life, not travel: on a large library they
  // crowd the vision budget with kitchens, kids, and receipts and the creation
  // declines with "not enough photos". Deprioritizing (rather than filtering)
  // uses the existing spread segments, so home photos are reached only once the
  // away-from-home pool is exhausted - a hard exclusion in practice, with an
  // automatic fallback for someone whose only geotagged photos are at home.
  const homeCountries = new Set(homeCountry ? [homeCountry] : []);

  // Step 2: select the candidate pool (KTD2 + KTD3).
  //
  // The geo gate and near-duplicate collapse run ONCE here: neither depends on
  // what a given pass has already classified, and the hunt below may run ten
  // passes over a library of tens of thousands of photos. Emit a progress tick
  // first so the wizard is not silent through it.
  onProgress?.({ step: 'checking', current: 0, total: QUIZ_MAX_PHOTOS, pickUris: [] });
  const preparedPool = prepareCandidatePool(pool, validCodes);

  // Step 2a: on-device pre-filter. Drops only the near-certain rejects
  // (screenshots, utility images, photos whose subject is a person) and tiers
  // the rest by quality so the paid gate sees the best candidates first.
  // Degrades to the undecorated pool whenever tags are missing or unreadable.
  const decorated = await decoratePoolWithTags(preparedPool);
  const rankedPool = decorated.pool;
  const poolById = new Map(rankedPool.map((candidate) => [candidate.id, candidate]));
  env.heartbeat?.();

  const session = createClassificationSession();
  const { classifiedIds, ledger } = session;

  // Step 2b (resume only): replay the slots the interrupted run had already
  // locked, BEFORE anything else may offer. `offer` is deterministic against
  // the growing picks prefix, so replaying in order restores the exact game -
  // and doing it first is what guarantees a user who saw seven photos comes
  // back to the same seven, not to seven the seed happened to pick.
  const restoredPicks = rehydrateLedger(checkpoint.pickAssetIds, poolById, ledger);
  for (const id of checkpoint.classifiedIds) classifiedIds.add(id);

  // Step 2c: seed from verdicts this device has ALREADY paid for. Eligible
  // photos go straight into the game with their stored landscape; ineligible
  // ones go into classifiedIds so no pass re-draws them. On a repeat creation
  // this alone can fill the game, making it upload-bound instead of gate-bound.
  const gamePicks = () => ledger.picks.map((candidate) => candidate.uri);
  let seededEligible = 0;
  let seededIneligible = 0;
  let seededUsed = 0;
  /**
   * Cached-eligible photos the owner has ALREADY spent on a quiz (KTD12).
   * Held back from the ledger: a repeat creation must be built from photos
   * nobody has been challenged with yet, and the hunt keeps classifying unseen
   * photos until it has them. These are offered only once the fresh library is
   * exhausted - the alternative is a decline. Before this split, seeding
   * offered them straight to the ledger (merely ordered last), so as soon as
   * the fresh eligible cache held fewer than ten photos the previous game's
   * photos were locked in, the game read as full, no new photo was ever
   * classified, and every creation after the first repeated the same ten.
   */
  let reserve: GeoEligibleCandidate[] = [];
  if (features.enableVerdictCache) {
    const verdicts = await loadCurrentVerdicts();
    if (verdicts.size > 0) {
      const seeded = seedFromVerdicts(rankedPool, verdicts);
      for (const id of seeded.seenIds) classifiedIds.add(id);
      const fresh = seeded.eligible.filter((candidate) => !usedAssetIds.has(candidate.id));
      // Order them the way a fresh hunt would, so a seeded game has the same
      // country/day spread as a classified one rather than whatever order the
      // cache happened to hold, then let the ledger lock its slots. They are
      // deliberately NOT pushed into `eligible`: that list is the GATE's
      // output and feeds the pass-rate estimate, and these photos were never
      // sent to it.
      for (const candidate of orderByCountrySpread(fresh, usedAssetIds, homeCountries, Infinity)) {
        ledger.offer(candidate);
      }
      ledger.topUp();
      // OLDEST USE FIRST, deliberately not country-spread order.
      //
      // A backfilled game is going to repeat something; which photo it repeats
      // is the whole difference between "huh, I've seen this before" and "this
      // is the same challenge I built last night". Country spread put the
      // reserve in the same order a fresh hunt would, which on a starved pool
      // reproduced the PREVIOUS game almost photo for photo. Ranking by
      // position in the used ledger (append-only, so oldest first - see
      // `getUsedAssetIds`) reaches for the photo the owner saw longest ago.
      //
      // Variety inside the game is not lost by dropping the spread: the ledger
      // still enforces distinct day and distinct (country, year) on every
      // offer, which is what actually keeps a game from playing as one trip.
      const usedRank = new Map([...usedAssetIds].map((id, index) => [id, index]));
      reserve = seeded.eligible
        .filter((candidate) => usedAssetIds.has(candidate.id))
        .sort((a, b) => (usedRank.get(a.id) ?? 0) - (usedRank.get(b.id) ?? 0));
      seededEligible = seeded.eligibleCount;
      seededUsed = reserve.length;
      seededIneligible = seeded.ineligibleCount;
    }
  }
  if (ledger.picks.length > 0) {
    onProgress?.({
      step: 'checking',
      current: Math.min(ledger.picks.length, QUIZ_MAX_PHOTOS),
      total: QUIZ_MAX_PHOTOS,
      examined: classifiedIds.size,
      pickUris: gamePicks(),
    });
  }

  const run: QuizRunState = {
    // Filled in below; the draft may be minted or reused.
    quizId: '',
    session,
    rankedPool,
    poolById,
    validCodes,
    usedAssetIds,
    homeCountries,
    reserve,
    decorated,
    seededEligible,
    draftCreatedAt: persisted?.createdAt ?? Date.now(),
    huntStartedAt: Date.now(),
    huntClock: createHuntClock(),
    priorSent: checkpoint.sentCount,
    priorEligible: checkpoint.gateEligible,
    firstBatch: [],
  };

  // A game already filled from cache needs no candidates at all.
  const firstBatch = (run.firstBatch =
    ledger.picks.length >= QUIZ_MAX_PHOTOS
      ? []
      : selectEligibilityBatch({
          pool: rankedPool,
          validCodes,
          prepared: true,
          coder: iso1A2Code,
          usedAssetIds,
          excludeIds: classifiedIds,
          deprioritizedCountries: homeCountries,
          limit: FIRST_BATCH_MAX * CANDIDATE_OVERSELECT,
        }));
  // console.warn (not log) so the funnel survives the production console strip:
  // a thin-library decline is meaningless without knowing which stage ate the
  // candidates - cache size, geo coding, the on-device drops, or the vision gate.
  console.warn(
    `[QuizCreation] funnel: refresh=${refresh.status} cached=${cached.length} ` +
      `geocoded=${pool.reduce((count, photo) => count + (photo.countryCode ? 1 : 0), 0)} ` +
      `home=${homeCountry ?? 'unset'} used=${usedAssetIds.size} ${formatTagFunnel(decorated)} ` +
      `seeded=${seededEligible - seededUsed}/${seededUsed}/${seededIneligible} ` +
      `restored=${restoredPicks} firstBatch=${firstBatch.length}`
  );
  // Nothing left to classify: every candidate already has a verdict. Only now
  // may photos from earlier quizzes fill the remaining slots.
  if (firstBatch.length === 0 && finalizableCount(run) < QUIZ_MAX_PHOTOS) offerReserve(run);
  // Nothing left to classify AND not even a relaxed game's worth in hand:
  // give up before creating a server draft. `finalizableCount` is the upper
  // bound on what `ledger.finalize()` could reach, so this never declines a
  // run the relaxation passes could still have saved.
  if (firstBatch.length === 0 && finalizableCount(run) < QUIZ_MIN_PHOTOS) {
    if (persisted) await discardDraft(persisted.quizId);
    return {
      status: 'outcome',
      outcome: {
        status: 'thin-library',
        eligibleCount: finalizableCount(run),
        // Distinguishes "no geotagged travel photos at all" from "photos exist
        // but the pre-filter or the gate ate them" - the decline copy differs.
        hasGeoCandidates: preparedPool.length > 0,
      },
    };
  }

  // Step 3: server draft (reuse a persisted id so retries stay cheap).
  let quizId = checkpoint.quizId ?? persisted?.quizId ?? null;
  if (!quizId) {
    try {
      const { data } = await api.post<{ id: string; state: string }>('/quiz');
      quizId = data.id;
    } catch {
      return { status: 'outcome', outcome: { status: 'service-error', stage: 'classify' } };
    }
    await saveDraftState({ quizId, createdAt: run.draftCreatedAt, picks: [] });
  }
  run.quizId = quizId;

  return { status: 'ready', run };
}

export { CLASSIFICATION_BUDGET_PER_QUIZ, FIRST_BATCH_MAX, QUIZ_MAX_PHOTOS, QUIZ_MIN_PHOTOS };
