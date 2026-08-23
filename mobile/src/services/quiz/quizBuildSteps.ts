/**
 * quizBuildSteps - The Guess Where build as a checkpointed state machine.
 *
 * ONE unit of work per `advanceQuizBuild` call, chosen by the checkpoint's
 * stage. Two drivers turn that into a build, and they must stay behaviorally
 * identical:
 *
 *   - `quizBuildJob` registers it as a job step, so the runtime persists the
 *     checkpoint between units and can stop between any two of them. That is
 *     what makes a build survive an iOS suspend rather than merely surviving
 *     navigation.
 *   - `createQuizFromLibrary` calls it in a plain loop, checkpointing nowhere.
 *     Same code, same order, no durability.
 *
 * WHY A STATE MACHINE AND NOT A LIST OF STEPS. The draft-gone path has to jump
 * BACKWARDS: a persisted draft can reference a server draft the owner deleted
 * from My Quizzes, and the only recovery is to start one fresh build. A forward
 * -only step list cannot express that, so the stage lives in the checkpoint and
 * every unit is free to return any stage - including an earlier one.
 *
 * The heavyweight state (pool, session, ledger) is NOT in the checkpoint; it
 * lives on the module refs below for the life of the process, exactly as
 * `photoScanService`'s result Maps do. A resumed build finds those refs empty
 * and rebuilds them from SQLite - see `quizPoolSetup.ts`.
 */

import { CLASSIFICATION_BUDGET_PER_QUIZ } from './candidateSelection';
import { runOneHuntPass, settleQuizRun } from './quizHuntLoop';
import { setUpQuizRun, gamePickUris, withPickUris } from './quizPoolSetup';
import type { QuizRunState } from './quizPoolSetup';
import { clearDraftState, loadDraftState } from './quizDraftStore';
import { runQuizTripContinuation } from './quizTripContinuation';
import { uploadAndFinalize } from './quizUpload';
import { isPast, restartCheckpoint } from './quizCheckpoint';
import type { QuizBuildCheckpoint } from './quizCheckpoint';

import type { QuizCreationOutcome, QuizDraftState, QuizRunEnv } from './quizCreationTypes';

/** In-memory state of the build running in THIS process. Null before setup. */
let run: QuizRunState | null = null;
/** The settled game awaiting upload, and the live slot URIs to report against. */
let pendingUpload: { state: QuizDraftState; getPickUris: () => string[] } | null = null;
/** Terminal outcome, once a unit has produced one. */
let outcome: QuizCreationOutcome | null = null;

/** Drop everything from a previous build. Called by both drivers before the first unit. */
export function beginQuizRun(): void {
  run?.huntClock.stop();
  run = null;
  pendingUpload = null;
  outcome = null;
}

/** The terminal outcome, or null while the build is still going. */
export function readQuizRunOutcome(): QuizCreationOutcome | null {
  return outcome;
}

/** True once the build has produced a terminal outcome. */
export function isQuizBuildDone(checkpoint: QuizBuildCheckpoint): boolean {
  return checkpoint.stage === 'done';
}

function finish(checkpoint: QuizBuildCheckpoint, result: QuizCreationOutcome): QuizBuildCheckpoint {
  outcome = result;
  return { ...checkpoint, stage: 'done' };
}

/**
 * Look for a persisted draft that already carries final picks. When one
 * exists, the hunt is over and only uploads remain - the resumable path that
 * makes an interrupted upload cost nothing (KTD7).
 */
async function doDraftCheck(
  checkpoint: QuizBuildCheckpoint,
  nextStage: QuizBuildCheckpoint['stage']
): Promise<QuizBuildCheckpoint> {
  const persisted = await loadDraftState();
  if (persisted && persisted.picks.length > 0) {
    pendingUpload = {
      state: persisted,
      getPickUris: () => persisted.picks.map((pick) => pick.uri),
    };
    return { ...checkpoint, stage: 'upload', quizId: persisted.quizId };
  }
  return { ...checkpoint, stage: nextStage };
}

/**
 * Build (or rebuild) the in-memory run state. `nextStage` is the caller's
 * current stage, so a resume that only needed the pool rebuilt lands back
 * exactly where it was rather than restarting the hunt.
 */
async function doSetup(
  env: QuizRunEnv,
  checkpoint: QuizBuildCheckpoint,
  nextStage: QuizBuildCheckpoint['stage']
): Promise<QuizBuildCheckpoint> {
  const result = await setUpQuizRun(env, checkpoint);
  if (result.status === 'outcome') return finish(checkpoint, result.outcome);
  run = result.run;
  return { ...checkpoint, stage: nextStage, quizId: result.run.quizId };
}

/**
 * The one draft-gone path (shared by eligibility, upload-urls, and finalize
 * 404s): the persisted draft references a server draft that no longer exists,
 * so resuming it can only 404 forever. Clear the local mirror and start ONE
 * fresh build; a second draft-gone in the same build is a genuine server
 * anomaly - surface it as retryable.
 */
async function restartAfterDraftGone(
  checkpoint: QuizBuildCheckpoint
): Promise<QuizBuildCheckpoint> {
  await clearDraftState();
  if (checkpoint.restarted) {
    return finish(checkpoint, { status: 'service-error', stage: 'classify' });
  }
  run?.huntClock.stop();
  run = null;
  pendingUpload = null;
  return restartCheckpoint(CLASSIFICATION_BUDGET_PER_QUIZ);
}

/**
 * Run exactly one unit of the build and return the next checkpoint.
 *
 * Never throws for an expected failure: every terminal condition becomes an
 * outcome on the module ref plus a `done` stage.
 */
export async function advanceQuizBuild(
  env: QuizRunEnv,
  checkpoint: QuizBuildCheckpoint
): Promise<QuizBuildCheckpoint> {
  if (env.signal?.aborted) {
    run?.huntClock.stop();
    // A cancel AFTER the challenge exists must not overwrite it with
    // 'cancelled' - the user would lose a finished game to a stopped
    // continuation. Only an abort with nothing built yet is a cancellation.
    if (outcome) return { ...checkpoint, stage: 'done' };
    return finish(checkpoint, { status: 'cancelled' });
  }

  switch (checkpoint.stage) {
    case 'draft-check':
      return doDraftCheck(checkpoint, 'setup');

    case 'setup':
      return doSetup(env, checkpoint, 'hunt');

    case 'hunt': {
      // A resume arrives here with the refs empty: rebuild them first, staying
      // on this stage so the hunt picks up rather than starting over.
      if (!run) return doSetup(env, checkpoint, 'hunt');
      const result = await runOneHuntPass(env, run, checkpoint);
      if (result.status === 'draft-gone') return restartAfterDraftGone(checkpoint);
      if (result.status === 'cancelled') return finish(checkpoint, { status: 'cancelled' });
      if (result.status === 'done') return { ...result.checkpoint, stage: 'settle' };
      return result.checkpoint;
    }

    case 'settle': {
      if (!run) return doSetup(env, checkpoint, 'settle');
      const result = await settleQuizRun(env, run, checkpoint);
      if (result.status === 'outcome') return finish(checkpoint, result.outcome);
      const settled = run;
      pendingUpload = {
        state: result.state,
        // The grid keeps reading the LEDGER, not `state.picks`: the draft
        // carries the spread question order, and re-emitting that order here
        // would shuffle a grid the user has been watching fill for a minute.
        getPickUris: () => gamePickUris(settled),
      };
      return { ...checkpoint, stage: 'upload', quizId: result.state.quizId };
    }

    case 'upload': {
      // A resume that lands straight on upload has no ref yet; the persisted
      // draft is the whole state it needs.
      if (!pendingUpload) return doDraftCheck(checkpoint, 'setup');
      const { state, getPickUris } = pendingUpload;
      const result = await uploadAndFinalize(
        state,
        withPickUris(env.onProgress, getPickUris),
        env.signal
      );
      env.heartbeat?.();
      if (result === 'draft-gone') return restartAfterDraftGone(checkpoint);
      outcome = result;
      // Publish the outcome NOW and let the trip continuation run after it:
      // nothing about segmentation may stand between the user and the
      // challenge they just waited for.
      return { ...checkpoint, stage: result.status === 'created' ? 'trips' : 'done' };
    }

    case 'trips': {
      // Best-effort by construction; see `quizTripContinuation`.
      await runQuizTripContinuation(env.signal);
      env.heartbeat?.();
      return { ...checkpoint, stage: 'done' };
    }

    case 'done':
    default:
      return { ...checkpoint, stage: 'done' };
  }
}

/** Test-only: inspect whether the process still holds in-memory build state. */
export function __hasRunStateForTesting(): boolean {
  return run !== null || pendingUpload !== null;
}

export { isPast };
