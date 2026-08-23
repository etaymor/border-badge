/**
 * jobRegistry - Where job owners declare themselves to the runtime.
 *
 * The runtime must never import `photoScanService` or `quizBuildJob` directly:
 * those modules import the runtime to start themselves, so a direct edge would
 * close a cycle. Instead each owner calls `registerJob(descriptor)` at import
 * time and the runtime looks its descriptor up by kind.
 */

import type { JobGate, JobRunOutcome, JobStep, LibraryJobKind } from './jobTypes';

/** What the runtime can tell an owner about how this run began. */
export interface JobStartInfo {
  resumed: boolean;
  /** The recovered checkpoint, when resuming. Absent on a fresh start. */
  checkpoint?: unknown;
}

export interface JobDescriptor<C = unknown, O = unknown> {
  kind: LibraryJobKind;

  /**
   * Ordered work. The runtime owns the loop over these and writes a checkpoint
   * after each, which is what makes the sequence yieldable to a future
   * background task without touching any job body.
   */
  steps: JobStep<C>[];
  initialCheckpoint(options: O): C;

  /** Resume gates, evaluated in order. First non-pass wins. */
  gates: JobGate[];

  /** A durable record older than this is treated as dead rather than resumed. */
  stalenessMs: number;

  /**
   * No heartbeat for this long while running means the job is stuck. Any step
   * that can exceed it between checkpoints must call `ctx.heartbeat()`.
   */
  stuckThresholdMs: number;

  /** How long the banner shows a finished job before it auto-dismisses. */
  autoDismissMs: number;

  /**
   * Whether the banner's auto-dismiss should also consume the pending result.
   * True for the trip scan (its result is cheap to recompute). MUST be false
   * for any job whose result would be lost — dismissing a bar must never
   * silently discard finished work.
   */
  consumeOnDismiss: boolean;

  /**
   * Owner hook: reset store slice and module refs before the loop starts.
   * `info.resumed` is true when the foreground auto-resume path started this
   * run rather than the user, which is the only moment an owner can tell a
   * continuation from a fresh build.
   */
  onStart(options: O, info: JobStartInfo): void | Promise<void>;

  /** Owner hook: publish results / analytics once the loop ends. */
  onSettle(outcome: JobRunOutcome, options: O, error?: unknown): void | Promise<void>;

  /**
   * True for failure reasons that should drop the screen to idle and alert.
   * False for reasons that keep the screen in place with an inline retry.
   */
  isAlertFailure(reason: string): boolean;
}

const registry = new Map<LibraryJobKind, JobDescriptor<never, never>>();

export function registerJob<C, O>(descriptor: JobDescriptor<C, O>): void {
  registry.set(descriptor.kind, descriptor as unknown as JobDescriptor<never, never>);
}

export function getDescriptor(kind: LibraryJobKind): JobDescriptor<never, never> | undefined {
  return registry.get(kind);
}

export function allDescriptors(): JobDescriptor<never, never>[] {
  return [...registry.values()];
}

/** Test-only. */
export function __clearRegistryForTesting(): void {
  registry.clear();
}
