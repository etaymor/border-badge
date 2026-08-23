/**
 * quizCheckpoint - The ~1KB of scalars that let a Guess Where build resume
 * after iOS suspended the JS runtime mid-hunt.
 *
 * The EXPENSIVE state is already durable and always was: `recordVerdicts`
 * persists every paid classification to `photo_quiz_verdicts`, `saveDraftState`
 * persists the server draft id, and `quizUpload` persists per-photo upload
 * progress. What was missing is only the cheap coordination state - which pass
 * we were on, what the budget meters read, and which photos had already been
 * locked into the game.
 *
 * WHY NO SERIALIZER. `pickLedger.offer()` is deterministic against the growing
 * `picks` prefix: a candidate is locked iff it clears the diversity rules
 * against the picks that came before it. So an ORDERED LIST OF ACCEPTED ASSET
 * IDS, replayed through `offer()` in the same order, reconstructs the exact
 * ledger - same photos, same slots. Nothing else about the ledger is stored.
 *
 * The BENCH is deliberately not persisted. Worst case a resumed run relaxes
 * over a thinner bench and builds a slightly shorter game; it can never build a
 * WRONG one, because every locked slot is replayed and locked again first.
 */

import type { GeoEligibleCandidate } from './candidateSelection';
import type { PickLedger } from './pickLedger';

/**
 * Where the build is. Strictly ordered: a step is skipped when the checkpoint
 * has advanced past it, which is what makes resume land in the right place.
 */
export type QuizBuildStage =
  | 'draft-check'
  | 'setup'
  | 'hunt'
  | 'settle'
  | 'upload'
  /**
   * Trip segmentation, run only after a challenge was actually created. It is
   * a STAGE rather than a fire-and-forget call so that it, too, survives a
   * suspend - and so cancelling the job stops it like everything else.
   */
  | 'trips'
  | 'done';

const STAGE_ORDER: QuizBuildStage[] = [
  'draft-check',
  'setup',
  'hunt',
  'settle',
  'upload',
  'trips',
  'done',
];

export function stageIndex(stage: QuizBuildStage): number {
  const index = STAGE_ORDER.indexOf(stage);
  // An unknown stage (a checkpoint written by a newer bundle, then rolled
  // back) is treated as the start rather than thrown on.
  return index === -1 ? 0 : index;
}

/** True when the checkpoint has moved past `stage`. */
export function isPast(checkpoint: QuizBuildCheckpoint, stage: QuizBuildStage): boolean {
  return stageIndex(checkpoint.stage) > stageIndex(stage);
}

export interface QuizBuildCheckpoint {
  v: 1;
  stage: QuizBuildStage;
  /** The server draft. Null until the setup step mints one. */
  quizId: string | null;
  /**
   * Asset ids LOCKED into the game, in slot order. Replayed through
   * `offer()` on resume - see the module header.
   */
  pickAssetIds: string[];
  /**
   * Every photo ATTEMPTED, so a resumed pass never re-draws one. Recoverable
   * from `photo_quiz_verdicts` for photos that reached the gate, but NOT for
   * ones that failed to prepare locally (iCloud-offloaded originals, ~45% of
   * candidates on a real library) - which is exactly the set a resume must
   * not spend the budget on twice.
   */
  classifiedIds: string[];
  /** Country codes a pass has already drawn from, so resumed passes reach elsewhere. */
  classifiedCountries: string[];
  /** Hunt passes completed. Pass 0 is the first (larger) batch. */
  passes: number;
  /** Images the SERVER received across every pass, including ones before a suspend. */
  sentCount: number;
  /** Photos that cleared the gate across every pass. Feeds the pass-rate estimate. */
  gateEligible: number;
  /** The server's last reported per-draft remainder. */
  budgetRemaining: number;
  consecutiveFailures: number;
  poolExhausted: boolean;
  /** The server said this draft is done spending. Terminal, never retryable. */
  budgetExceeded: boolean;
  /**
   * True once a draft-gone 404 has already forced one fresh restart. A second
   * one in the same build is a genuine server anomaly, not a deleted draft.
   */
  restarted: boolean;
}

export function initialQuizCheckpoint(budget: number): QuizBuildCheckpoint {
  return {
    v: 1,
    stage: 'draft-check',
    quizId: null,
    pickAssetIds: [],
    classifiedIds: [],
    classifiedCountries: [],
    passes: 0,
    sentCount: 0,
    gateEligible: 0,
    budgetRemaining: budget,
    consecutiveFailures: 0,
    poolExhausted: false,
    budgetExceeded: false,
    restarted: false,
  };
}

/**
 * Start over from the top, keeping only the fact that we already restarted
 * once. Used for the draft-gone path: the persisted draft referenced a server
 * draft that no longer exists, so resuming it can only 404 forever.
 */
export function restartCheckpoint(budget: number): QuizBuildCheckpoint {
  return { ...initialQuizCheckpoint(budget), restarted: true };
}

/**
 * Replay locked slots into a fresh ledger, in their original order.
 *
 * Ids the pool no longer offers (a photo deleted from the library between
 * suspend and resume) are skipped rather than treated as an error - the hunt
 * simply has one more slot to fill. Returns how many were restored.
 */
export function rehydrateLedger(
  pickAssetIds: string[],
  poolById: Map<string, GeoEligibleCandidate>,
  ledger: PickLedger
): number {
  let restored = 0;
  for (const id of pickAssetIds) {
    const candidate = poolById.get(id);
    if (!candidate) continue;
    if (ledger.offer(candidate)) restored += 1;
  }
  return restored;
}
