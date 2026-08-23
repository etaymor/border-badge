/**
 * Quiz creation for Guess Where - the public entry point and the in-process
 * driver.
 *
 * One tap from the entry point to a built quiz awaiting owner play:
 *   draft -> refresh photo cache -> select candidates -> vision eligibility
 *   -> pick 5-10 with country spread -> upload via quiz signed URLs -> finalize.
 *
 * Each stage lives in its own module so a failure can be read (and tested) in
 * isolation:
 * - `quizDraftStore`     resumable draft + used-asset ledger (KTD7/KTD12)
 * - `candidateSelection` which photos to spend the vision budget on (KTD2/KTD3)
 * - `quizImagePrep`      cached URI -> bytes, with iCloud recovery
 * - `quizClassification` the eligibility gate and its budget meters (R2)
 * - `quizPoolSetup`      cache refresh, pool build, verdict seeding, draft mint
 * - `quizHuntLoop`       one eligibility pass, and the settle that ends the hunt
 * - `quizBuildSteps`     the stage machine those two are driven by
 * - `quizUpload`         signed upload + finalize, resumable (KTD5/KTD7)
 * - `quizHttpErrors`     the two failures that must never look like an outage
 *
 * THIS FILE IS ONE OF TWO DRIVERS. It runs the stage machine straight through
 * in a single process and checkpoints nowhere, which is what every existing
 * caller and test expects. The other driver is `quizBuildJob`, which hands the
 * same machine to the library job runtime so the runtime can persist the
 * checkpoint between stages and continue after iOS suspends the app. Neither
 * driver contains any creation logic - if behavior differs between them, that
 * is a bug in one of these two loops, not in the pipeline.
 *
 * Key behaviors (unchanged, and now enforced in `quizPoolSetup`/`quizHuntLoop`):
 * - KTD1: candidates come from the existing SQLite photo cache. Refresh uses
 *   the background-sync mechanics (incremental extract since last import) -
 *   never a forced full rescan.
 * - KTD3: the first batch targets FIRST_BATCH_MAX images, then the hunt keeps
 *   drawing fresh batches - sized by the pass rate it is observing - until the
 *   game is FULL.
 * - Home-country photos are deprioritized: everyday life crowded the budget
 *   out on a large library and the creation declined as "not enough photos".
 *
 * Module-load discipline: this file is evaluated at app boot (the creation
 * screen is registered in the root navigator), so country-coder access goes
 * through the LAZY accessor - never a top-level `@rapideditor/country-coder`
 * import.
 */

import { CLASSIFICATION_BUDGET_PER_QUIZ } from './candidateSelection';
import { advanceQuizBuild, beginQuizRun, readQuizRunOutcome } from './quizBuildSteps';
import { initialQuizCheckpoint } from './quizCheckpoint';
import type { QuizBuildCheckpoint } from './quizCheckpoint';
import { clearDraftState, discardDraft, getUsedAssetIds, loadDraftState } from './quizDraftStore';

import type { CreateQuizOptions, QuizCreationOutcome } from './quizCreationTypes';

// The creation pipeline's public surface. Callers (screens, hooks, the swap
// flow) import from here rather than reaching into the stages.
export type {
  CreateQuizOptions,
  DraftPick,
  QuizCreationOutcome,
  QuizCreationProgress,
  QuizCreationStep,
  QuizDraftState,
  QuizRunEnv,
} from './quizCreationTypes';
export { markAssetsUsed } from './quizDraftStore';
export { clearDraftState, discardDraft, getUsedAssetIds, loadDraftState };
export { prepareQuizUploadImage } from './quizImagePrep';
export { HUNT_SOFT_DEADLINE_MS } from './quizHuntLoop';

/**
 * How many stage transitions one build may take before we call it a loop.
 *
 * Only reachable through a bug: every stage either advances, ends the build,
 * or (for the hunt) is bounded by the image budget and the failed-pass count.
 * A ceiling is still cheaper than a device spinning forever on a `while`.
 */
const MAX_STAGE_TRANSITIONS = 500;

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
  beginQuizRun();
  const env = {
    signal: options.signal,
    onProgress: options.onProgress,
  };

  let checkpoint: QuizBuildCheckpoint = initialQuizCheckpoint(CLASSIFICATION_BUDGET_PER_QUIZ);
  for (let transition = 0; transition < MAX_STAGE_TRANSITIONS; transition++) {
    if (checkpoint.stage === 'done') break;
    checkpoint = await advanceQuizBuild(env, checkpoint);
  }

  return (
    readQuizRunOutcome() ?? {
      status: 'service-error',
      stage: 'classify',
    }
  );
}
