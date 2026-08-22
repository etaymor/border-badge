/**
 * Quiz creation orchestration for Guess Where - the sequencing only.
 *
 * One tap from the entry point to a built quiz awaiting owner play:
 *   draft -> refresh photo cache -> select candidates -> vision eligibility
 *   -> pick 5-10 with country spread -> upload via quiz signed URLs -> finalize.
 *
 * Each stage lives in its own module so a failure can be read (and tested) in
 * isolation; this file owns only the order they run in and what each outcome
 * means:
 * - `quizDraftStore`     resumable draft + used-asset ledger (KTD7/KTD12)
 * - `candidateSelection` which photos to spend the vision budget on (KTD2/KTD3)
 * - `quizImagePrep`      cached URI -> bytes, with iCloud recovery
 * - `quizClassification` the eligibility gate and its budget meters (R2)
 * - `quizUpload`         signed upload + finalize, resumable (KTD5/KTD7)
 * - `quizHttpErrors`     the two failures that must never look like an outage
 *
 * Key behaviors:
 * - KTD1: candidates come from the existing SQLite photo cache. Refresh uses
 *   the background-sync mechanics (incremental extract since last import) -
 *   never a forced full rescan. A fresh install with an empty cache runs the
 *   initial extraction here, so the flow works with photo permission as the
 *   only prerequisite (R7).
 * - KTD3: the first batch targets FIRST_BATCH_MAX images, then the hunt keeps
 *   drawing fresh batches - sized by the pass rate it is observing - until the
 *   game is FULL. Not until the first batch is spent: a library whose photos
 *   clear the vision gate only ~11% of the time (the measured case) yields a
 *   handful per 50, so stopping after a pass or two declined creations that
 *   had thousands of unexamined photos left. Only the image budget, the pool
 *   running dry, or repeated failures may end it short.
 * - Home-country photos are deprioritized: everyday life crowded the budget
 *   out on a large library and the creation declined as "not enough photos".
 *
 * Module-load discipline: this file is evaluated at app boot (the creation
 * screen is registered in the root navigator), so country-coder access goes
 * through the LAZY accessor - never a top-level `@rapideditor/country-coder`
 * import.
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
  nextResampleSize,
  orderByCountrySpread,
  prepareCandidatePool,
  selectEligibilityBatch,
  toCandidate,
} from './candidateSelection';
import type { GeoEligibleCandidate } from './candidateSelection';
import {
  CANDIDATE_OVERSELECT,
  classifyBatch,
  createClassificationSession,
  dominantRejectionReason,
  reportFound,
  summarizeRejections,
} from './quizClassification';
import type { ClassifyBatchResult } from './quizClassification';
import {
  clearDraftState,
  discardDraft,
  getUsedAssetIds,
  loadDraftState,
  saveDraftState,
} from './quizDraftStore';
import { decoratePoolWithTags, formatTagFunnel } from './quizCandidateTags';
import type { DecoratedPool } from './quizCandidateTags';
import { computeAgreement } from './tagAgreement';
import { loadCurrentVerdicts, seedFromVerdicts } from './quizVerdictStore';
import { uploadAndFinalize } from './quizUpload';

import type {
  CreateQuizOptions,
  QuizCreationOutcome,
  QuizCreationProgress,
  QuizDraftState,
} from './quizCreationTypes';

// The creation pipeline's public surface. Callers (screens, hooks, the swap
// flow) import from here rather than reaching into the stages.
export type {
  CreateQuizOptions,
  DraftPick,
  QuizCreationOutcome,
  QuizCreationProgress,
  QuizCreationStep,
  QuizDraftState,
} from './quizCreationTypes';
export { markAssetsUsed } from './quizDraftStore';
export { clearDraftState, discardDraft, getUsedAssetIds, loadDraftState };
export { prepareQuizUploadImage } from './quizImagePrep';

/**
 * When to stop hunting for a BETTER game and build the one we have.
 *
 * Deliberately gated on already holding QUIZ_MIN_PHOTOS: past this point the
 * deadline can end a good run early, but it can never turn a winnable run into
 * a "Not Enough Photos Yet". Below the minimum the hunt continues to the image
 * budget, because the alternative is declining while the library still has
 * thousands of unexamined photos - the whole reason this loop exists.
 */
export const HUNT_SOFT_DEADLINE_MS = 90_000;

/**
 * Consecutive failed passes tolerated before the hunt gives up.
 *
 * Applies to both an unreachable service and batches where nothing could be
 * read locally. One bad pass out of the ten a long hunt may run is not a
 * reason to throw the other nine away.
 */
const MAX_CONSECUTIVE_FAILED_PASSES = 2;

/**
 * Emit one aggregate agreement event per creation.
 *
 * Aggregate only - no per-photo events, no asset ids. Silent when nothing was
 * both predicted and classified, which is the normal case on a device with no
 * tag coverage yet.
 */
function reportPrefilterAgreement(
  verdictsById: Map<string, boolean>,
  decorated: DecoratedPool,
  seededEligible: number
): void {
  const agreement = computeAgreement(verdictsById, decorated.tierById);
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
    dropped: decorated.dropped,
    untagged: decorated.untagged,
    seededEligible,
  });
}

/**
 * Decorate a progress callback so every emission carries the running pick
 * URIs. The creation screen renders the game live - hero = the most recent
 * find, thumbnail grid = every locked slot in order - so the list rides along
 * with each count update instead of arriving only at the end. The getter is
 * read per emission, so callers hand over a live view, not a copy.
 */
function withPickUris(
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

/**
 * Build a quiz from the photo library, end to end.
 *
 * Resumable: when a persisted draft already carries final picks, this skips
 * straight to the remaining uploads + finalize without re-uploading completed
 * photos. A persisted draft WITHOUT picks (e.g. a classifier retry) reuses
 * the server draft id so retries do not burn the draft-creation rate limit.
 */
export async function createQuizFromLibrary(
  options: CreateQuizOptions = {}
): Promise<QuizCreationOutcome> {
  return runQuizCreation(options, false);
}

/**
 * The one draft-gone path (shared by eligibility, upload-urls, and finalize
 * 404s): the persisted draft references a server draft that no longer exists
 * (e.g. the owner deleted it from My Quizzes), so resuming it can only 404
 * forever. Clear the local mirror and start ONE fresh creation; a second
 * draft-gone in the same run is a genuine server anomaly - surface retryable.
 */
async function restartAfterDraftGone(
  options: CreateQuizOptions,
  alreadyRestarted: boolean
): Promise<QuizCreationOutcome> {
  await clearDraftState();
  if (alreadyRestarted) {
    return { status: 'service-error', stage: 'classify' };
  }
  return runQuizCreation(options, true);
}

async function runQuizCreation(
  options: CreateQuizOptions,
  restartedAfterDraftGone: boolean
): Promise<QuizCreationOutcome> {
  const { onProgress, signal } = options;

  const persisted = await loadDraftState();
  if (persisted && persisted.picks.length > 0) {
    const outcome = await uploadAndFinalize(
      persisted,
      withPickUris(onProgress, () => persisted.picks.map((pick) => pick.uri)),
      signal
    );
    if (outcome === 'draft-gone') {
      return restartAfterDraftGone(options, restartedAfterDraftGone);
    }
    return outcome;
  }

  // Step 1: bring the photo cache up to date (KTD1) - via the shared
  // ensureFreshLibrary flow (P1). A fresh or writer-owned cache emits NO
  // scanning progress at all: the wizard's scan step only exists when a
  // scan actually runs.
  let cached: CachedPhoto[];
  const refresh = await ensureFreshLibrary({
    source: 'quiz',
    onProgress: (progress) => {
      onProgress?.({ step: 'scanning', current: progress.current, total: progress.total });
    },
    signal,
  });
  if (signal?.aborted) return { status: 'cancelled' };
  if (refresh.status === 'failed') {
    // A failed refresh with an existing cache degrades to stale candidates;
    // with no cache at all there is nothing to build from - retryable.
    cached = await getAllCachedPhotos().catch(() => []);
    if (cached.length === 0) {
      return { status: 'service-error', stage: 'scan' };
    }
  } else {
    // 'fresh', 'refreshed', 'deferred' (another writer owns the cache: use
    // it as-is), and 'no-permission' (screens gate permission before the
    // mutation ever starts; an empty cache is caught below) all proceed.
    cached = await getAllCachedPhotos();
  }
  if (signal?.aborted) return { status: 'cancelled' };

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

  // Step 2: select the first candidate batch (KTD2 + KTD3).
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

  // Step 2b: seed from verdicts this device has ALREADY paid for. Eligible
  // photos go straight into the game with their stored landscape; ineligible
  // ones go into classifiedIds so no pass re-draws them. On a repeat creation
  // this alone can fill the game, making it upload-bound instead of gate-bound.
  const session = createClassificationSession();
  const { classifiedIds, eligible } = session;
  // The running list the screen renders for the WHOLE run (hunt and upload
  // alike): the locked game, in slot order. Append-only, so a photo the screen
  // has shown is never replaced, reordered, or dropped (the old code showed
  // the raw eligible list here and the re-picked game later, and the two
  // disagreed - the grid visibly reset part-way through a 90s wait).
  const ledger = session.ledger;
  const gamePickUris = () => ledger.picks.map((candidate) => candidate.uri);
  const huntProgress = withPickUris(onProgress, gamePickUris);
  /**
   * Upper bound on the game `ledger.finalize()` could reach: the locked slots
   * plus whatever the relaxed passes might still promote off the bench. Used
   * only to decide whether to keep hunting - the real size comes from
   * `finalize()` itself, once.
   */
  const finalizableCount = () =>
    Math.min(QUIZ_MAX_PHOTOS, ledger.picks.length + ledger.bench.length);
  let seededEligible = 0;
  let seededIneligible = 0;
  let seededUsed = 0;
  /**
   * Cached-eligible photos the owner has ALREADY spent on a quiz (KTD12).
   * Held back from the ledger: a repeat creation must be built from photos
   * nobody has been challenged with yet, and the hunt below keeps classifying
   * unseen photos until it has them. These are offered only once the fresh
   * library is exhausted - the alternative is a decline. Before this split,
   * seeding offered them straight to the ledger (merely ordered last), so as
   * soon as the fresh eligible cache held fewer than ten photos the previous
   * game's photos were locked in, the game read as full, no new photo was ever
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
      reserve = orderByCountrySpread(
        seeded.eligible.filter((candidate) => usedAssetIds.has(candidate.id)),
        usedAssetIds,
        homeCountries,
        Infinity
      );
      seededEligible = seeded.eligibleCount;
      seededUsed = reserve.length;
      seededIneligible = seeded.ineligibleCount;
      if (ledger.picks.length > 0) {
        onProgress?.({
          step: 'checking',
          current: Math.min(ledger.picks.length, QUIZ_MAX_PHOTOS),
          total: QUIZ_MAX_PHOTOS,
          examined: classifiedIds.size,
          pickUris: gamePickUris(),
        });
      }
    }
  }

  /**
   * The fresh library has nothing more to give: let previously-used photos
   * fill what the hunt could not. Called only at exhaustion points, never to
   * shortcut a hunt that could still find unseen photos.
   */
  const offerReserve = (): void => {
    for (const candidate of reserve) ledger.offer(candidate);
    ledger.topUp();
  };

  // A game already filled from cache needs no candidates at all.
  const firstBatch =
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
        });
  // console.warn (not log) so the funnel survives the production console strip:
  // a thin-library decline is meaningless without knowing which stage ate the
  // candidates - cache size, geo coding, the on-device drops, or the vision gate.
  console.warn(
    `[QuizCreation] funnel: refresh=${refresh.status} cached=${cached.length} ` +
      `geocoded=${pool.reduce((count, photo) => count + (photo.countryCode ? 1 : 0), 0)} ` +
      `home=${homeCountry ?? 'unset'} used=${usedAssetIds.size} ${formatTagFunnel(decorated)} ` +
      `seeded=${seededEligible - seededUsed}/${seededUsed}/${seededIneligible} ` +
      `firstBatch=${firstBatch.length}`
  );
  // Nothing left to classify: every candidate already has a verdict. Only now
  // may photos from earlier quizzes fill the remaining slots.
  if (firstBatch.length === 0 && finalizableCount() < QUIZ_MAX_PHOTOS) offerReserve();
  // Nothing left to classify AND not even a relaxed game's worth in hand:
  // give up before creating a server draft. `finalizableCount` is the upper
  // bound on what `ledger.finalize()` could reach, so this never declines a
  // run the relaxation passes could still have saved.
  if (firstBatch.length === 0 && finalizableCount() < QUIZ_MIN_PHOTOS) {
    if (persisted) await discardDraft(persisted.quizId);
    return {
      status: 'thin-library',
      eligibleCount: finalizableCount(),
      // Distinguishes "no geotagged travel photos at all" from "photos exist
      // but the pre-filter or the gate ate them" - the decline copy differs.
      hasGeoCandidates: preparedPool.length > 0,
    };
  }

  // Step 3: server draft (reuse a persisted id so retries stay cheap).
  let quizId = persisted?.quizId ?? null;
  if (!quizId) {
    try {
      const { data } = await api.post<{ id: string; state: string }>('/quiz');
      quizId = data.id;
    } catch {
      return { status: 'service-error', stage: 'classify' };
    }
    await saveDraftState({ quizId, createdAt: Date.now(), picks: [] });
  }

  // Step 4: vision eligibility (R2), hunting until the game is full (KTD3).
  const startedAt = Date.now();
  // An empty first batch means the verdict cache already filled the game, so
  // there is nothing to classify. Treat it as a clean pass with the full budget
  // intact rather than as a failure - the hunt loop below simply never runs.
  let firstResult: ClassifyBatchResult = { budgetRemaining: CLASSIFICATION_BUDGET_PER_QUIZ };
  if (firstBatch.length > 0) {
    firstResult = await classifyBatch(quizId, firstBatch, FIRST_BATCH_MAX, session, huntProgress);
    if (firstResult === 'draft-gone') {
      return restartAfterDraftGone(options, restartedAfterDraftGone);
    }
    if (signal?.aborted) return { status: 'cancelled' };
    ledger.topUp();
    reportFound(session, huntProgress);
  }

  // Keep drawing fresh batches until the game is FULL - not until the first
  // batch is spent. A library with a low pass rate (the measured case: ~11% of
  // candidates clear the people/indoor gate) yields only a handful of photos
  // per 50, so stopping after one or two passes declined creations that had
  // thousands of unexamined photos left. What may end the hunt, in order of
  // how much it costs the user:
  //   - a full game (QUIZ_MAX_PHOTOS)                      the good stop
  //   - the soft deadline, once the game is at least legal
  //   - the per-draft image budget (client mirror, or a server 429)
  //   - the candidate pool running dry
  //   - repeated failed passes
  // Only the last two can still end in a decline, and both mean the library
  // really has nothing more to offer.
  const classifiedCountries = new Set(firstBatch.map((candidate) => candidate.countryCode));
  let lastResult = firstResult;
  // The server's own view of what this draft may still spend. When a pass
  // fails the server tells us nothing, so keep the last known figure rather
  // than assuming zero - a failed pass has to leave room for the retry below.
  // The mirror clamp is applied separately, per pass.
  let budgetRemaining =
    typeof firstResult === 'object' ? firstResult.budgetRemaining : CLASSIFICATION_BUDGET_PER_QUIZ;
  let consecutiveFailures = typeof firstResult === 'object' ? 0 : 1;
  let passes = 1;
  let poolExhausted = false;

  while (lastResult !== 'budget-exceeded' && ledger.picks.length < QUIZ_MAX_PHOTOS) {
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILED_PASSES) break;
    // Past the deadline with a playable game in hand: build it. Below the
    // minimum, the deadline is ignored - a slow hunt beats a false decline.
    if (Date.now() - startedAt >= HUNT_SOFT_DEADLINE_MS && finalizableCount() >= QUIZ_MIN_PHOTOS) {
      break;
    }
    // Sized by the pass rate seen so far, then clamped by BOTH budget meters:
    // the server's last reported remainder and our own mirror. The mirror is
    // recomputed every pass rather than carried, so images sent on a pass that
    // then failed still count - they were charged.
    const resampleTarget = Math.min(
      // How many more photos must clear the GATE before a full game is
      // reachable - not how many slots are still strictly diverse. Sizing by
      // the latter over-draws whenever diversity, rather than the gate, is
      // what is holding the game back.
      nextResampleSize(QUIZ_MAX_PHOTOS - finalizableCount(), session.sentCount, eligible.length),
      budgetRemaining,
      CLASSIFICATION_BUDGET_PER_QUIZ - session.sentCount
    );
    if (resampleTarget <= 0) break;

    const resampleBatch = selectEligibilityBatch({
      pool: rankedPool,
      validCodes,
      prepared: true,
      coder: iso1A2Code,
      usedAssetIds,
      excludeIds: classifiedIds,
      // Countries already classified AND home rank last: each pass reaches
      // for photos from somewhere the vision gate has not seen yet.
      deprioritizedCountries: new Set([...homeCountries, ...classifiedCountries]),
      limit: resampleTarget * CANDIDATE_OVERSELECT,
    });
    // Pool exhausted: every remaining candidate has already been classified.
    if (resampleBatch.length === 0) {
      poolExhausted = true;
      break;
    }

    const resampleResult = await classifyBatch(
      quizId,
      resampleBatch,
      resampleTarget,
      session,
      huntProgress
    );
    passes += 1;
    if (resampleResult === 'draft-gone') {
      return restartAfterDraftGone(options, restartedAfterDraftGone);
    }
    if (signal?.aborted) return { status: 'cancelled' };

    if (resampleResult === 'no-images') {
      // Nothing in this draw could be read locally (iCloud-offloaded). The
      // service is fine and the budget is untouched, so draw again - those
      // candidates are already in classifiedIds, so the next pass reaches
      // further into the library rather than re-picking them.
      consecutiveFailures += 1;
      continue;
    }
    if (resampleResult === 'unavailable') {
      consecutiveFailures += 1;
      continue;
    }
    if (resampleResult === 'budget-exceeded') {
      // The server says this draft is done spending. Terminal, never
      // retryable: build with what the hunt already found.
      lastResult = resampleResult;
      break;
    }
    consecutiveFailures = 0;
    // Enough photos in hand for a full game: settle the remaining slots now
    // rather than hunting for a diversity the library may not have. This is
    // what ends the loop, and it ends it at exactly the point the old code
    // did - ten photos through the gate.
    ledger.topUp();
    reportFound(session, huntProgress);
    for (const candidate of resampleBatch) classifiedCountries.add(candidate.countryCode);
    lastResult = resampleResult;
    budgetRemaining = resampleResult.budgetRemaining;
  }
  if (signal?.aborted) return { status: 'cancelled' };

  // Repeats are a last resort (KTD12): only when the fresh library ran dry, or
  // when the game would otherwise fall below playable. A soft-deadline or
  // budget stop with a playable all-fresh game keeps that shorter game.
  if (poolExhausted || finalizableCount() < QUIZ_MIN_PHOTOS) offerReserve();

  // The hunt is over: settle the game ONCE. Every slot locked during the hunt
  // keeps its photo and its position; this only appends, relaxing the day and
  // country-year rules over the bench when the library was too thin to fill
  // the game diversely.
  const picks = ledger.finalize();

  // Failing to build because passes were FAILING is a retryable outage;
  // failing to build after the library was honestly searched is a thin
  // library. `consecutiveFailures` is what separates them: it is zero only
  // when the last pass returned real verdicts, so a hunt that ended on a
  // failure - including one that ran out of candidates before its retry could
  // run - is never mislabeled as the user's library being too thin.
  if (picks.length < QUIZ_MIN_PHOTOS && consecutiveFailures > 0) {
    return { status: 'service-error', stage: 'classify' };
  }

  // Every classified photo that also had a tag tier is a free labeled example.
  // Aggregated per creation (never per photo), this is the only evidence that
  // can justify tightening the shadow-mode drop rules over-the-air.
  reportPrefilterAgreement(session.verdictsById, decorated, seededEligible);

  const reasonSummary = summarizeRejections(session);
  console.warn(
    `[QuizCreation] funnel: attempted=${classifiedIds.size} sent=${session.sentCount} ` +
      `eligible=${eligible.length} picks=${picks.length} benched=${ledger.bench.length} ` +
      `seeded=${seededEligible - seededUsed}/${seededUsed} passes=${passes} ` +
      `elapsedMs=${Date.now() - startedAt} offloaded=${session.offloadedFailures}` +
      (reasonSummary ? ` ${reasonSummary}` : '')
  );

  if (picks.length < QUIZ_MIN_PHOTOS) {
    // Genuine decline (AE2): the draft is deleted, not left dangling (KTD7).
    await discardDraft(quizId);
    return {
      status: 'thin-library',
      eligibleCount: picks.length,
      hasGeoCandidates: true,
      dominantReason: dominantRejectionReason(session.reasons),
    };
  }

  // Step 5: resumable state. The question order gets the R1 country spread;
  // the SET is already settled, so this reorders nothing the screen showed -
  // the grid keeps reading `ledger.picks` (see the upload call below).
  const ordered = orderByCountrySpread(picks, usedAssetIds, homeCountries, Infinity);
  const state: QuizDraftState = {
    quizId,
    createdAt: persisted?.createdAt ?? Date.now(),
    picks: ordered.map((pick) => ({
      assetId: pick.id,
      uri: pick.uri,
      countryCode: pick.countryCode,
      storagePath: null,
      uploaded: false,
      landscape: pick.landscape ?? null,
    })),
  };
  await saveDraftState(state);

  // Step 6: upload + finalize (resumable). The grid keeps reading the LEDGER,
  // not `state.picks`: the draft carries the spread question order, and
  // re-emitting that order here would shuffle a grid the user has been
  // watching fill for the last minute.
  const outcome = await uploadAndFinalize(state, withPickUris(onProgress, gamePickUris), signal);
  if (outcome === 'draft-gone') {
    return restartAfterDraftGone(options, restartedAfterDraftGone);
  }
  return outcome;
}
