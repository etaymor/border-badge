/**
 * quizBuildJob - Registers the Guess Where build as a durable library job.
 *
 * Before this existed the build ran inline from a React mutation that
 * `QuizCreationScreen` owned, and the screen's unmount effect aborted it. That
 * meant leaving the screen destroyed up to 90 seconds of hunting and up to
 * `CLASSIFICATION_BUDGET_PER_QUIZ` classified images. Ownership now lives here,
 * so the build survives navigation and the screen is only a view onto it.
 *
 * The heavyweight outcome stays on a module-level ref rather than in the store
 * (same contract as `photoScanService.consumeResult`), because two mounted
 * screens must not both act on one finished build.
 *
 * SUSPEND SURVIVAL. The build is registered as ONE step whose `run` advances
 * the stage machine in `quizBuildSteps` by exactly one unit — a hunt pass, a
 * settle, an upload — and the runtime persists the returned checkpoint after
 * every one. So an iOS suspend costs at most the unit that was in flight, and
 * the next foreground resumes from the stage the checkpoint names rather than
 * restarting. `isDone` is the stage machine's own terminal state, which is why
 * the runtime re-enters the step until the build actually finishes.
 */

import { Analytics } from '@services/analytics';

import { CLASSIFICATION_BUDGET_PER_QUIZ } from './candidateSelection';
import { advanceQuizBuild, beginQuizRun, readQuizRunOutcome } from './quizBuildSteps';
import { initialQuizCheckpoint } from './quizCheckpoint';
import type { QuizBuildCheckpoint } from './quizCheckpoint';
import { loadDraftState } from './quizDraftStore';
import type { QuizCreationOutcome, QuizCreationProgress, QuizRunEnv } from './quizCreationTypes';

import { registerJob } from '@services/jobs/jobRegistry';
import { startJob, cancelJob } from '@services/jobs/jobRuntime';
import { authSessionGate, mediaLibraryPermissionGate } from '@services/jobs/jobGates';
import type { GateRecord, JobGate, JobRunContext, JobStartResult } from '@services/jobs/jobTypes';
import { patchJobSlice, type QuizBuildDetail } from '@stores/libraryJobStore';

/**
 * A build that has finished but not yet been handed to a screen. Held here,
 * never in the store: `consumeQuizOutcome` must be atomic so a second caller
 * (a re-mounted screen, the banner) cannot act on the same result twice.
 */
let lastOutcome: QuizCreationOutcome | null = null;

export interface QuizBuildOptions {
  /** Where the build was launched from, for funnel attribution. */
  entryPoint?: string;
  /**
   * Photos a resumable draft already holds. The screen used to paint these
   * optimistically in its own state before firing the mutation; now that the
   * store is the single source of progress, the seed travels with the job so
   * the grid is populated from the first frame rather than blanking until the
   * first upload tick.
   */
  seedPickUris?: string[];
  /** Which step the seed represents ('building' when resuming uploads). */
  seedStep?: QuizBuildDetail['step'];
}

export function hasQuizOutcome(): boolean {
  return lastOutcome !== null;
}

/**
 * Atomically take ownership of the finished build and clear the ref.
 * Idempotent: a second call returns null.
 */
export function consumeQuizOutcome(): QuizCreationOutcome | null {
  const outcome = lastOutcome;
  lastOutcome = null;
  if (outcome) patchJobSlice('quiz-build', { hasResult: false });
  return outcome;
}

/** Map a pipeline progress event onto the store's scalar slice. */
function publish(ctx: JobRunContext, progress: QuizCreationProgress): void {
  const total = progress.total ?? 0;
  const current = progress.current ?? 0;
  const detail: QuizBuildDetail = {
    step: progress.step,
    pickUris: progress.pickUris ?? [],
    examined: progress.examined ?? 0,
  };
  ctx.emit(
    {
      current,
      total,
      percentage: total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0,
      phase: progress.step,
    },
    detail
  );
}

/**
 * The persisted draft must still exist. QUIZ-BUILD ONLY.
 *
 * A checkpoint that names a `quizId` with no local draft behind it means the
 * owner deleted the challenge from My Quizzes while the app was suspended.
 * Resuming can only walk into a 404 chain, so fail cleanly instead.
 */
const draftStillExistsGate: JobGate = {
  id: 'draft-still-exists',
  async check(_kind, record: GateRecord) {
    const checkpoint = record.checkpoint as QuizBuildCheckpoint | undefined;
    if (!checkpoint?.quizId) return { status: 'pass' };
    const draft = await loadDraftState().catch(() => undefined);
    // `undefined` is a read failure, not an absent draft: defer rather than
    // throw away a good breadcrumb over one bad SQLite read.
    if (draft === undefined) return { status: 'defer', reason: 'draft-read-failed' };
    if (draft) return { status: 'pass' };
    return {
      status: 'fail',
      failure: {
        reason: 'draft-gone',
        title: 'Challenge Gone',
        message: 'That challenge is no longer available. Start a new one when you are ready.',
      },
    };
  },
};

/**
 * Move the store slice to its terminal state for `result`.
 *
 * Called from the step loop the moment an outcome exists — not only at settle
 * — because the trip continuation runs as a stage AFTER the challenge is
 * built, and the user must not wait on it. Calling it twice is harmless: both
 * calls write the same patch.
 */
function publishOutcome(result: QuizCreationOutcome | null): void {
  if (result?.status === 'created') {
    patchJobSlice('quiz-build', {
      phase: 'completed',
      hasResult: true,
      failure: null,
      resultRoute: { screen: 'QuizPlay', params: { quizId: result.quizId } },
    });
    return;
  }

  if (result) {
    // thin-library / service-error / interrupted are all outcomes the screen
    // renders itself, so keep the result available and let it reattach.
    patchJobSlice('quiz-build', {
      phase: 'completed',
      hasResult: true,
      resultRoute: { screen: 'QuizCreation' },
    });
    return;
  }

  patchJobSlice('quiz-build', {
    phase: 'failed',
    hasResult: false,
    failure: {
      reason: 'service-error',
      title: 'Something Went Wrong',
      message: 'We could not check your photos right now. Your library is fine.',
    },
    resultRoute: { screen: 'QuizCreation' },
  });
}

registerJob<QuizBuildCheckpoint, QuizBuildOptions>({
  kind: 'quiz-build',

  steps: [
    {
      id: 'build',
      isDone: (c) => c.stage === 'done',
      run: async (ctx, c) => {
        const env: QuizRunEnv = {
          signal: ctx.signal,
          onProgress: (progress) => publish(ctx, progress),
          heartbeat: () => ctx.heartbeat(),
        };
        const next = await advanceQuizBuild(env, c);
        // Read after every unit rather than only at the end: a unit that ends
        // the build sets the outcome and the stage together, and `onSettle`
        // must find it there however the loop exited.
        const settled = readQuizRunOutcome();
        if (settled && !lastOutcome) {
          lastOutcome = settled;
          // Publish BEFORE the trip-continuation stage runs. Segmentation is
          // the by-product; the challenge is what the user waited for, and
          // making them wait for the by-product would invert that.
          publishOutcome(settled);
        }
        return next;
      },
    },
  ],

  initialCheckpoint: () => initialQuizCheckpoint(CLASSIFICATION_BUDGET_PER_QUIZ),

  /**
   * Deliberately NOT gated on subscription or home country.
   *
   * `FREE_LIMITS` has no quiz entry — the Guess Where loop is ungated on
   * purpose, because metering a viral loop defeats its purpose. And the build
   * reads home country only as a DEPRIORITIZATION signal (it catches to null
   * and merely ranks home-country photos lower), so a missing one must never
   * block a resume. Both omissions are explicit so that adding either gate
   * later has to be a conscious act.
   */
  gates: [mediaLibraryPermissionGate, authSessionGate, draftStillExistsGate],

  /**
   * Shorter than the trip scan's hour: a whole build is minutes, so an
   * hour-old breadcrumb is certainly dead, and resuming one would re-POST
   * against a server draft the user has long forgotten.
   */
  stalenessMs: 30 * 60 * 1000,

  /**
   * A single `classifyBatch` can run most of a minute, so this threshold is
   * only safe because the pipeline emits progress (and therefore heartbeats)
   * around every prepare chunk and every upload PUT.
   */
  stuckThresholdMs: 5 * 60 * 1000,

  autoDismissMs: 30_000,

  /**
   * MUST stay false. The trip scan's result is cheap to recompute, but a
   * finished quiz is not: letting the banner's auto-dismiss consume the
   * outcome would silently discard a built challenge after a green flash.
   */
  consumeOnDismiss: false,

  onStart: (options, info) => {
    lastOutcome = null;
    // Drop any in-memory state from a previous build BEFORE the first unit.
    // A resume rebuilds what it needs from SQLite; see `quizPoolSetup`.
    beginQuizRun();
    if (info.resumed) {
      // The one number that says whether durability actually saves runs.
      // Fired here (not in the pipeline) because only the runtime can tell a
      // continuation from a fresh build.
      const from = info.checkpoint as QuizBuildCheckpoint | undefined;
      Analytics.quizBuildResumed({
        stage: from?.stage ?? 'unknown',
        passes: from?.passes ?? 0,
        foundCount: from?.pickAssetIds?.length ?? 0,
      });
    }
    const seedPickUris = options?.seedPickUris ?? [];
    const seedStep = options?.seedStep ?? 'scanning';
    patchJobSlice('quiz-build', {
      detail: { step: seedStep, pickUris: seedPickUris, examined: 0 },
      progress: {
        current: 0,
        total: seedPickUris.length,
        percentage: 0,
        phase: seedStep,
      },
    });
  },

  onSettle: (outcome) => {
    if (outcome === 'suspended') {
      // The runtime yielded between units and kept the breadcrumb. The build
      // is not over, so the slice must keep reading as running rather than
      // flashing a failure the next foreground would immediately undo.
      return;
    }
    if (outcome === 'cancelled') {
      // The persisted draft stays resumable (KTD7) — cancelling the job must
      // not discard picks the user already paid to classify.
      lastOutcome = null;
      return;
    }

    publishOutcome(lastOutcome);
  },

  isAlertFailure: () => false,
});

/** Start a build, or attach to one already running. */
export function startQuizBuild(options: QuizBuildOptions = {}): Promise<JobStartResult> {
  return startJob('quiz-build', options);
}

/** Stop a build. The persisted draft is left resumable on purpose. */
export function cancelQuizBuild(): void {
  cancelJob('quiz-build');
}
