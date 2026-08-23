/**
 * jobTypes - Shared vocabulary for the library job runtime.
 *
 * A "library job" is a long-running pass over the user's photo library that
 * must survive in-app navigation and auto-resume after iOS suspends the JS
 * runtime. Two kinds exist: the trip scan (clusters photos into trips) and the
 * quiz build (picks photos for a Guess Where challenge). They do different
 * work, but they share one SQLite cache, one refresh lock, one durable-flag
 * mechanism, one set of resume gates, and one progress affordance.
 *
 * This module is a LEAF: it imports nothing from `photoImport` or `quiz`, so
 * the runtime can describe jobs without depending on them. Job owners register
 * themselves via `jobRegistry` at import time.
 */

/** The two kinds of library job. Kind strings are durable — they appear in SQLite keys. */
export type LibraryJobKind = 'trip-scan' | 'quiz-build';

/**
 * Job lifecycle phase.
 *
 * `waiting` is distinct from `running`: jobs are mutually exclusive (they
 * contend for the same cache writer lock), so a second job queues rather than
 * preempting. A queued job renders its own explanatory state.
 */
export type JobPhase = 'idle' | 'waiting' | 'running' | 'completed' | 'failed';

/**
 * A user-facing job failure. Generalizes `PhotoScanFailure`; `reason` stays a
 * free string here because each descriptor owns its own reason vocabulary and
 * its own exhaustive `isAlertFailure` switch.
 */
export interface JobFailure {
  reason: string;
  title: string;
  message: string;
}

/** Scalar progress snapshot. Stored in the job store, so it must stay JSON-friendly. */
export interface JobProgress {
  current: number;
  total: number;
  percentage: number;
  /** Free-form sub-phase label owned by the descriptor (e.g. 'scanning', 'geocoding'). */
  phase?: string;
}

/**
 * The handle a job step uses to talk to the runtime.
 *
 * `shouldYield` is the driver seam. Between units the runtime asks every
 * registered `JobDriver` (see below) whether this run should stop at the next
 * boundary; in the foreground with no driver asking, it is always `false`, so
 * the step loop is behaviorally identical to the straight-line code it
 * replaced. The iOS BGProcessingTask driver and the continued-processing lease
 * driver both answer through that seam; because the runtime (not the job body)
 * owns the loop and the checkpoint is written after every step, both are
 * additive and no job body changes.
 */
export interface JobRunContext {
  signal: AbortSignal;
  /**
   * Stamp the stuck-detector heartbeat. Any step that can run longer than the
   * descriptor's `stuckThresholdMs` between checkpoints MUST call this, or a
   * slow-but-healthy job will be killed as stuck.
   */
  heartbeat(): void;
  /** Publish a progress snapshot and (optionally) the per-kind detail slice. */
  emit(progress: JobProgress | null, detail?: unknown): void;
  /** True when a registered driver wants this run to stop at the next unit boundary. */
  shouldYield(): boolean;
  saveCheckpoint(checkpoint: unknown): Promise<void>;
}

/**
 * One unit of job work.
 *
 * `isDone` lets the runtime re-enter a step until it reports completion, which
 * is what turns an unbounded `while` inside a job body (the quiz hunt loop)
 * into a checkpointed, yieldable sequence.
 */
export interface JobStep<C = unknown> {
  id: string;
  isDone(checkpoint: C): boolean;
  run(ctx: JobRunContext, checkpoint: C): Promise<C>;
}

/** Outcome of one full run of the step sequence. */
export type JobRunOutcome = 'completed' | 'cancelled' | 'suspended' | 'failed';

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

/**
 * What a driver learns when a run begins.
 *
 * `generation` is a process-monotonic counter that identifies this run and
 * only this run; a driver keys any per-run state on it so a stale event can
 * never match a newer run. `foregroundAtCall` is captured at `startJob` entry
 * (before the durable write), because the Photos permission prompt moves
 * AppState to `inactive` right after a legitimate user start.
 */
export interface JobDriverStartEvent {
  kind: LibraryJobKind;
  generation: number;
  resumed: boolean;
  foregroundAtCall: boolean;
}

export interface JobDriverSettleEvent {
  kind: LibraryJobKind;
  generation: number;
  outcome: JobRunOutcome;
}

export interface JobDriverHeartbeatEvent {
  kind: LibraryJobKind;
  generation: number;
}

/**
 * A runtime driver: something that watches job lifecycle and may ask the loop
 * to stop between units.
 *
 * `onSettled` is terminal per generation (a cancel that fires synchronously is
 * never followed by a second settle when the in-flight step returns).
 * `onIdle` fires after every drain attempt that leaves nothing running or
 * waiting. `shouldYield` is PULLED by the loop between units — a driver never
 * clears a flag, and answers only for the `(kind, generation)` it observed.
 */
export interface JobDriver {
  onStarted?(event: JobDriverStartEvent): void;
  onSettled?(event: JobDriverSettleEvent): void;
  onHeartbeat?(event: JobDriverHeartbeatEvent): void;
  onIdle?(): void;
  shouldYield?(kind: LibraryJobKind, generation: number): boolean;
}

export type JobStartResult =
  | { status: 'started' }
  | { status: 'already-running' }
  | { status: 'queued'; blockedBy: LibraryJobKind }
  | { status: 'rejected'; reason: string };

// ---------------------------------------------------------------------------
// Resume gates
// ---------------------------------------------------------------------------

/**
 * The durable breadcrumb shape a gate is handed. Declared structurally here
 * (rather than imported from `jobDurableFlag`) so this module stays a leaf.
 */
export interface GateRecord {
  startedAt: number;
  options?: unknown;
  checkpoint?: unknown;
  lastCheckpointAt?: number;
}

export type GateOutcome =
  | { status: 'pass' }
  /** Conditions are not yet knowable (a store has not rehydrated). Try again next foreground. */
  | { status: 'defer'; reason: string }
  /** Resume is impossible. The breadcrumb is cleared and the failure surfaced. */
  | { status: 'fail'; failure: JobFailure };

export interface JobGate {
  id: string;
  check(kind: LibraryJobKind, record: GateRecord): Promise<GateOutcome> | GateOutcome;
}
