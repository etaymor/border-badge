/**
 * Per-dispatch vision preparation telemetry (U3/R4).
 *
 * The Sept 2026 Paris import spent most of its time preparing vision images
 * that never arrived — every request carried zero images — and nothing in
 * production said so. This accumulator makes preparation cost and vision
 * coverage visible on `photo_import_suggestions_completed` and, for imports the
 * user abandons mid-flight, on `photo_import_workflow_exited`.
 *
 * Scope mirrors `DispatchTelemetry`: a fresh (non-retry) main dispatch begins a
 * new run, and retries fold into the run they repair. The run survives the
 * controller's `reset()` so the exit event can read it after navigation.
 *
 * Counts only. No photo id, URI or coordinate is recorded (R27).
 */

export interface PrepTelemetry {
  /** Summed milliseconds spent preparing batches (the dispatch waited on this). */
  prepareMsTotal: number;
  /** The slowest single batch preparation, in milliseconds. */
  prepareMsMax: number;
  /** Photos handed to the native encoder. */
  visionImagesAttempted: number;
  /** Attempted photos that came back as a usable image. */
  visionImagesProduced: number;
  /** Attempted photos whose native encode hit the timeout. */
  visionImagesTimedOut: number;
  /** Cluster photos excluded from vision selection as iCloud-only (KTD1). */
  visionPhotosSkippedOffloaded: number;
  /** The dispatch breaker (KTD2) opened during the run. */
  breakerOpened: boolean;
}

export interface PrepTelemetrySink {
  recordPrepareMs(ms: number): void;
  /** One attempted photo. Neither flag set means a decode failure. */
  recordPhotoOutcome(outcome: { produced: boolean; timedOut: boolean }): void;
  recordSkippedOffloaded(count: number): void;
  recordBreakerOpened(): void;
  snapshot(): PrepTelemetry;
}

export function createPrepTelemetry(): PrepTelemetrySink {
  const totals: PrepTelemetry = {
    prepareMsTotal: 0,
    prepareMsMax: 0,
    visionImagesAttempted: 0,
    visionImagesProduced: 0,
    visionImagesTimedOut: 0,
    visionPhotosSkippedOffloaded: 0,
    breakerOpened: false,
  };

  return {
    recordPrepareMs: (ms) => {
      const clamped = Math.max(0, Math.round(ms));
      totals.prepareMsTotal += clamped;
      if (clamped > totals.prepareMsMax) totals.prepareMsMax = clamped;
    },
    recordPhotoOutcome: ({ produced, timedOut }) => {
      totals.visionImagesAttempted += 1;
      if (produced) totals.visionImagesProduced += 1;
      if (timedOut) totals.visionImagesTimedOut += 1;
    },
    recordSkippedOffloaded: (count) => {
      if (count > 0) totals.visionPhotosSkippedOffloaded += count;
    },
    recordBreakerOpened: () => {
      totals.breakerOpened = true;
    },
    snapshot: () => ({ ...totals }),
  };
}

/** Time `work` and record it as one preparation. */
export async function measurePrepare<T>(
  sink: PrepTelemetrySink,
  work: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await work();
  } finally {
    sink.recordPrepareMs(Date.now() - startedAt);
  }
}

let currentRun: PrepTelemetrySink = createPrepTelemetry();

/** Start a fresh run: call once per fresh (non-retry) main dispatch. */
export function beginPrepTelemetryRun(): PrepTelemetrySink {
  currentRun = createPrepTelemetry();
  return currentRun;
}

/** The run in progress, for retries that fold into it. */
export function currentPrepTelemetry(): PrepTelemetrySink {
  return currentRun;
}

/** Snapshot of the current run, for the analytics events. */
export function getPrepTelemetry(): PrepTelemetry {
  return currentRun.snapshot();
}
