/**
 * quizHuntLoop - ONE pass of the eligibility hunt, plus the settle that ends it.
 *
 * The hunt used to be a `while` inside the creation function. It is now a
 * function the DRIVER calls repeatedly, because that is what makes a build
 * survive an iOS suspend: the job runtime writes a durable checkpoint between
 * passes and can stop between them, and `createQuizFromLibrary` calls the same
 * function in a plain loop. Neither driver knows anything about hunting; this
 * module knows nothing about jobs.
 *
 * The stop conditions and their ORDER are load-bearing and unchanged from the
 * loop this replaces. What may end the hunt, in order of how much it costs the
 * user:
 *   - a full game (QUIZ_MAX_PHOTOS)                      the good stop
 *   - the soft deadline, once the game is at least legal
 *   - the per-draft image budget (client mirror, or a server 429)
 *   - the candidate pool running dry
 *   - repeated failed passes
 * Only the last two can still end in a decline, and both mean the library
 * really has nothing more to offer.
 */

import { iso1A2Code } from '@services/photoImport/countryCoder';

import {
  CLASSIFICATION_BUDGET_PER_QUIZ,
  FIRST_BATCH_MAX,
  QUIZ_MAX_PHOTOS,
  QUIZ_MIN_PHOTOS,
  nextResampleSize,
  orderByCountrySpread,
  selectEligibilityBatch,
} from './candidateSelection';
import {
  CANDIDATE_OVERSELECT,
  classifyBatch,
  dominantRejectionReason,
  reportFound,
  summarizeRejections,
} from './quizClassification';
import type { ClassifyBatchResult } from './quizClassification';
import { discardDraft, saveDraftState } from './quizDraftStore';
import {
  finalizableCount,
  gamePickUris,
  offerReserve,
  reportPrefilterAgreement,
  withPickUris,
} from './quizPoolSetup';
import type { QuizRunState } from './quizPoolSetup';
import type { QuizBuildCheckpoint } from './quizCheckpoint';

import type { QuizCreationOutcome, QuizDraftState, QuizRunEnv } from './quizCreationTypes';

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

export type HuntPassResult =
  /** Draw again. */
  | { status: 'continue'; checkpoint: QuizBuildCheckpoint }
  /** The hunt is over for one of the reasons in the module header. */
  | { status: 'done'; checkpoint: QuizBuildCheckpoint }
  /** The server draft is gone: clear the local mirror and start one fresh build. */
  | { status: 'draft-gone' }
  | { status: 'cancelled' };

/** Fold everything this pass learned back into the durable checkpoint. */
function snapshot(
  run: QuizRunState,
  checkpoint: QuizBuildCheckpoint,
  patch: Partial<QuizBuildCheckpoint>
): QuizBuildCheckpoint {
  const { session } = run;
  return {
    ...checkpoint,
    quizId: run.quizId,
    sentCount: run.priorSent + session.sentCount,
    gateEligible: run.priorEligible + session.eligible.length,
    classifiedIds: [...session.classifiedIds],
    pickAssetIds: session.ledger.picks.map((candidate) => candidate.id),
    ...patch,
  };
}

/** The hunt is over for this run: stop its executing-time clock. */
function stopped<T>(run: QuizRunState, result: T): T {
  run.huntClock.stop();
  return result;
}

/** Images the SERVER has received for this draft, across suspends. */
function totalSent(run: QuizRunState): number {
  return run.priorSent + run.session.sentCount;
}

/** Photos that have cleared the gate for this draft, across suspends. */
function totalEligible(run: QuizRunState): number {
  return run.priorEligible + run.session.eligible.length;
}

/**
 * Run exactly one pass. Pass 0 is the larger opening draw; every pass after it
 * is sized by the pass rate observed so far.
 */
export async function runOneHuntPass(
  env: QuizRunEnv,
  run: QuizRunState,
  checkpoint: QuizBuildCheckpoint
): Promise<HuntPassResult> {
  const { session } = run;
  const { ledger } = session;
  const huntProgress = withPickUris(env.onProgress, () => gamePickUris(run));

  // ---- Pass 0: the opening batch (KTD3) -----------------------------------
  if (checkpoint.passes === 0) {
    if (run.firstBatch.length === 0) {
      // The verdict cache already filled the game, so there is nothing to
      // classify. A clean pass with the full budget intact, not a failure.
      return { status: 'continue', checkpoint: snapshot(run, checkpoint, { passes: 1 }) };
    }
    const result = await classifyBatch(
      run.quizId,
      run.firstBatch,
      FIRST_BATCH_MAX,
      session,
      huntProgress
    );
    env.heartbeat?.();
    if (result === 'draft-gone') return stopped(run, { status: 'draft-gone' });
    if (env.signal?.aborted) return stopped(run, { status: 'cancelled' });
    ledger.topUp();
    reportFound(session, huntProgress);
    return {
      status: 'continue',
      checkpoint: snapshot(run, checkpoint, {
        passes: 1,
        // When a pass fails the server tells us nothing, so keep the full
        // figure rather than assuming zero - a failed pass has to leave room
        // for the retry. The mirror clamp is applied separately, per pass.
        budgetRemaining:
          typeof result === 'object' ? result.budgetRemaining : CLASSIFICATION_BUDGET_PER_QUIZ,
        consecutiveFailures: typeof result === 'object' ? 0 : 1,
        budgetExceeded: result === 'budget-exceeded',
        classifiedCountries: run.firstBatch.map((candidate) => candidate.countryCode),
      }),
    };
  }

  // ---- Stop conditions, in the order the original loop applied them -------
  if (checkpoint.budgetExceeded || ledger.picks.length >= QUIZ_MAX_PHOTOS) {
    return { status: 'done', checkpoint };
  }
  if (checkpoint.consecutiveFailures >= MAX_CONSECUTIVE_FAILED_PASSES) {
    return { status: 'done', checkpoint };
  }
  // Past the deadline with a playable game in hand: build it. Below the
  // minimum, the deadline is ignored - a slow hunt beats a false decline.
  // EXECUTING time, not wall time: a process frozen for three minutes while
  // backgrounded has not spent three minutes classifying (see quizHuntClock).
  if (
    run.huntClock.executingMs() >= HUNT_SOFT_DEADLINE_MS &&
    finalizableCount(run) >= QUIZ_MIN_PHOTOS
  ) {
    return { status: 'done', checkpoint };
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
    nextResampleSize(QUIZ_MAX_PHOTOS - finalizableCount(run), totalSent(run), totalEligible(run)),
    checkpoint.budgetRemaining,
    CLASSIFICATION_BUDGET_PER_QUIZ - totalSent(run)
  );
  if (resampleTarget <= 0) return { status: 'done', checkpoint };

  const classifiedCountries = new Set(checkpoint.classifiedCountries);
  const resampleBatch = selectEligibilityBatch({
    pool: run.rankedPool,
    validCodes: run.validCodes,
    prepared: true,
    coder: iso1A2Code,
    usedAssetIds: run.usedAssetIds,
    excludeIds: session.classifiedIds,
    // Countries already classified AND home rank last: each pass reaches
    // for photos from somewhere the vision gate has not seen yet.
    deprioritizedCountries: new Set([...run.homeCountries, ...classifiedCountries]),
    limit: resampleTarget * CANDIDATE_OVERSELECT,
  });
  // Pool exhausted: every remaining candidate has already been classified.
  if (resampleBatch.length === 0) {
    return { status: 'done', checkpoint: snapshot(run, checkpoint, { poolExhausted: true }) };
  }

  const result: ClassifyBatchResult = await classifyBatch(
    run.quizId,
    resampleBatch,
    resampleTarget,
    session,
    huntProgress
  );
  env.heartbeat?.();
  const passes = checkpoint.passes + 1;
  if (result === 'draft-gone') return stopped(run, { status: 'draft-gone' });
  if (env.signal?.aborted) return stopped(run, { status: 'cancelled' });

  if (result === 'no-images' || result === 'unavailable') {
    // 'no-images': nothing in this draw could be read locally (iCloud-
    // offloaded). The service is fine and the budget is untouched, so draw
    // again - those candidates are already in classifiedIds, so the next pass
    // reaches further into the library rather than re-picking them.
    return {
      status: 'continue',
      checkpoint: snapshot(run, checkpoint, {
        passes,
        consecutiveFailures: checkpoint.consecutiveFailures + 1,
      }),
    };
  }
  if (result === 'budget-exceeded') {
    // The server says this draft is done spending. Terminal, never
    // retryable: build with what the hunt already found.
    return {
      status: 'done',
      checkpoint: snapshot(run, checkpoint, { passes, budgetExceeded: true }),
    };
  }

  // Enough photos in hand for a full game: settle the remaining slots now
  // rather than hunting for a diversity the library may not have. This is
  // what ends the loop, and it ends it at exactly the point the old code
  // did - ten photos through the gate.
  ledger.topUp();
  reportFound(session, huntProgress);
  for (const candidate of resampleBatch) classifiedCountries.add(candidate.countryCode);
  return {
    status: 'continue',
    checkpoint: snapshot(run, checkpoint, {
      passes,
      consecutiveFailures: 0,
      budgetRemaining: result.budgetRemaining,
      classifiedCountries: [...classifiedCountries],
    }),
  };
}

export type SettleResult =
  /** The game is built and persisted; the upload step takes it from here. */
  { status: 'ready'; state: QuizDraftState } | { status: 'outcome'; outcome: QuizCreationOutcome };

/**
 * The hunt is over: settle the game ONCE.
 *
 * Every slot locked during the hunt keeps its photo and its position; this
 * only appends, relaxing the day and country-year rules over the bench when
 * the library was too thin to fill the game diversely.
 */
export async function settleQuizRun(
  env: QuizRunEnv,
  run: QuizRunState,
  checkpoint: QuizBuildCheckpoint
): Promise<SettleResult> {
  const { session } = run;
  run.huntClock.stop();
  if (env.signal?.aborted) return { status: 'outcome', outcome: { status: 'cancelled' } };

  // Repeats are a last resort (KTD12): only when the fresh library ran dry, or
  // when the game would otherwise fall below playable. A soft-deadline or
  // budget stop with a playable all-fresh game keeps that shorter game.
  if (checkpoint.poolExhausted || finalizableCount(run) < QUIZ_MIN_PHOTOS) offerReserve(run);

  const picks = session.ledger.finalize();

  // Failing to build because passes were FAILING is a retryable outage;
  // failing to build after the library was honestly searched is a thin
  // library. `consecutiveFailures` is what separates them: it is zero only
  // when the last pass returned real verdicts, so a hunt that ended on a
  // failure - including one that ran out of candidates before its retry could
  // run - is never mislabeled as the user's library being too thin.
  if (picks.length < QUIZ_MIN_PHOTOS && checkpoint.consecutiveFailures > 0) {
    return { status: 'outcome', outcome: { status: 'service-error', stage: 'classify' } };
  }

  // Every classified photo that also had a tag tier is a free labeled example.
  // Aggregated per creation (never per photo), this is the only evidence that
  // can justify tightening the shadow-mode drop rules over-the-air.
  reportPrefilterAgreement(run);

  const reasonSummary = summarizeRejections(session);
  // `repeats` is the number the owner actually feels: how many photos of the
  // finished game they have already been challenged with. It is never a
  // failure of the ledger - the ledger holds every one of them back - it is
  // the backfill above firing because the fresh pool ran dry, and it stayed
  // invisible in this log while it did.
  const repeats = picks.filter((pick) => run.usedAssetIds.has(pick.id)).length;
  console.warn(
    `[QuizCreation] funnel: attempted=${session.classifiedIds.size} sent=${totalSent(run)} ` +
      `eligible=${totalEligible(run)} picks=${picks.length} benched=${session.ledger.bench.length} ` +
      `repeats=${repeats} reserve=${run.reserve.length} exhausted=${checkpoint.poolExhausted} ` +
      `seeded=${run.seededEligible - run.reserve.length}/${run.reserve.length} ` +
      `passes=${checkpoint.passes} elapsedMs=${Date.now() - run.huntStartedAt} ` +
      `offloaded=${session.offloadedFailures}` +
      (reasonSummary ? ` ${reasonSummary}` : '')
  );

  if (picks.length < QUIZ_MIN_PHOTOS) {
    // Genuine decline (AE2): the draft is deleted, not left dangling (KTD7).
    await discardDraft(run.quizId);
    return {
      status: 'outcome',
      outcome: {
        status: 'thin-library',
        eligibleCount: picks.length,
        hasGeoCandidates: true,
        dominantReason: dominantRejectionReason(session.reasons),
      },
    };
  }

  // Resumable state. The question order gets the R1 country spread; the SET is
  // already settled, so this reorders nothing the screen showed - the grid
  // keeps reading `ledger.picks` (see the upload step).
  const ordered = orderByCountrySpread(picks, run.usedAssetIds, run.homeCountries, Infinity);
  const state: QuizDraftState = {
    quizId: run.quizId,
    createdAt: run.draftCreatedAt,
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
  return { status: 'ready', state };
}
