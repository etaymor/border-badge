/**
 * Tests for jobResume - foreground auto-resume and stuck detection.
 *
 * This is the successor to `photoScanResume.test.ts`. Every case that suite
 * proved for the trip scan is preserved here, but parameterized by kind rather
 * than hard-wired to the scan: the ordering rules (await a pending cancel
 * BEFORE reading the breadcrumb, clear a stale record BEFORE deferring to
 * another running job) are what kept a fast cancel + foreground bounce from
 * resurrecting a scan, and they now protect the quiz build too.
 *
 * Individual gate logic lives in `jobGates.test.ts`; what is tested here is the
 * orchestration around gates — which outcome clears the breadcrumb, which one
 * leaves it for the next foreground.
 */

import { __clearRegistryForTesting, registerJob } from '@services/jobs/jobRegistry';
import {
  __resetRuntimeForTesting,
  cancelJob,
  getCancelInFlight,
  getLastProgressAt,
  isJobRunning,
  markForegroundReturn,
  startJob,
} from '@services/jobs/jobRuntime';
import {
  __resetJobRuntimeStateForTesting,
  registerJobDriver,
} from '@services/jobs/jobRuntimeState';
import { detectStuckJobs, tryResumeJob, tryResumeJobs } from '@services/jobs/jobResume';
import { patchJobSlice, resetLibraryJobStore, useLibraryJobStore } from '@stores/libraryJobStore';
import type { JobDescriptor } from '@services/jobs/jobRegistry';
import type { GateOutcome, JobRunContext, LibraryJobKind } from '@services/jobs/jobTypes';

// --- Mocks ---

const mockMetadata = new Map<string, string>();

jest.mock('@services/photoImport/photoCacheDb', () => ({
  getMetadata: jest.fn(async (key: string) => mockMetadata.get(key) ?? null),
  setMetadata: jest.fn(async (key: string, value: string) => {
    mockMetadata.set(key, value);
  }),
}));

// Registration is normally lazy-required by `ensureJobsRegistered`. These tests
// register their own descriptors, so the real pipelines must not load: they
// would pull expo native bridges into the graph and overwrite the fakes.
jest.mock('@services/photoImport/photoScanService', () => ({}));
jest.mock('@services/quiz/quizBuildJob', () => ({}));

// --- Helpers ---

/** A step that never finishes, so `isJobRunning` stays true for assertions. */
const neverEndingStep = {
  id: 'forever',
  isDone: () => false,
  run: async (_ctx: JobRunContext, c: { n: number }) =>
    new Promise<{ n: number }>(() => c) as Promise<{ n: number }>,
};

function makeDescriptor(
  kind: LibraryJobKind,
  overrides: Partial<JobDescriptor<{ n: number }, unknown>> = {}
): JobDescriptor<{ n: number }, unknown> {
  return {
    kind,
    steps: [neverEndingStep],
    initialCheckpoint: () => ({ n: 0 }),
    gates: [],
    stalenessMs: 60 * 60 * 1000,
    stuckThresholdMs: 5 * 60 * 1000,
    autoDismissMs: 30_000,
    consumeOnDismiss: true,
    onStart: jest.fn(),
    onSettle: jest.fn(),
    isAlertFailure: () => true,
    ...overrides,
  };
}

function writeBreadcrumb(kind: LibraryJobKind, startedAt: number, options: unknown = {}): void {
  mockMetadata.set(`job:${kind}:state`, JSON.stringify({ v: 1, startedAt, options }));
}

async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  mockMetadata.clear();
  __clearRegistryForTesting();
  __resetRuntimeForTesting();
  __resetJobRuntimeStateForTesting();
  resetLibraryJobStore();
  jest.clearAllMocks();
});

const KINDS: LibraryJobKind[] = ['trip-scan', 'quiz-build'];

describe.each(KINDS)('tryResumeJob(%s) gates', (kind) => {
  it('skips with no-flag when no breadcrumb exists', async () => {
    registerJob(makeDescriptor(kind));

    const result = await tryResumeJob(kind);

    expect(result).toEqual({ status: 'skipped', reason: 'no-flag' });
    expect(isJobRunning(kind)).toBe(false);
  });

  it('starts the job when a breadcrumb exists and every gate passes', async () => {
    registerJob(makeDescriptor(kind));
    writeBreadcrumb(kind, Date.now());

    const result = await tryResumeJob(kind);

    expect(result).toEqual({ status: 'started' });
    expect(isJobRunning(kind)).toBe(true);
  });

  it('hands the recovered checkpoint and options back to the job', async () => {
    const onStart = jest.fn();
    registerJob(makeDescriptor(kind, { onStart }));
    mockMetadata.set(
      `job:${kind}:state`,
      JSON.stringify({ v: 1, startedAt: Date.now(), options: { seed: 7 }, checkpoint: { n: 3 } })
    );

    await tryResumeJob(kind);
    await flush();

    expect(onStart).toHaveBeenCalledWith({ seed: 7 }, { resumed: true, checkpoint: { n: 3 } });
  });

  it('clears a stale breadcrumb and surfaces a failure rather than resuming', async () => {
    registerJob(makeDescriptor(kind, { stalenessMs: 1000 }));
    writeBreadcrumb(kind, Date.now() - 5000);

    const result = await tryResumeJob(kind);

    expect(result).toEqual({ status: 'failed-gate', gateId: 'staleness' });
    expect(mockMetadata.get(`job:${kind}:state`)).toBe('');
    expect(useLibraryJobStore.getState().jobs[kind].failure?.reason).toBe('stale');
    expect(isJobRunning(kind)).toBe(false);
  });

  it('skips when this kind is already running, without re-reading the breadcrumb', async () => {
    registerJob(makeDescriptor(kind));
    await startJob(kind, {});
    writeBreadcrumb(kind, Date.now());

    const result = await tryResumeJob(kind);

    expect(result).toEqual({ status: 'skipped', reason: 'already-running' });
  });

  it('DEFERS on an unhydrated store instead of clearing a good breadcrumb', async () => {
    const defer: GateOutcome = { status: 'defer', reason: 'not-hydrated' };
    registerJob(makeDescriptor(kind, { gates: [{ id: 'hydration', check: () => defer }] }));
    writeBreadcrumb(kind, Date.now());

    const result = await tryResumeJob(kind);

    expect(result).toEqual({ status: 'skipped', reason: 'deferred' });
    // The breadcrumb survives — the next foreground tries again.
    expect(mockMetadata.get(`job:${kind}:state`)).toBeTruthy();
    expect(isJobRunning(kind)).toBe(false);
  });

  it('clears the breadcrumb and fails when a gate says resume is impossible', async () => {
    registerJob(
      makeDescriptor(kind, {
        gates: [
          {
            id: 'permission',
            check: () => ({
              status: 'fail',
              failure: { reason: 'no-permission', title: 't', message: 'm' },
            }),
          },
        ],
      })
    );
    writeBreadcrumb(kind, Date.now());

    const result = await tryResumeJob(kind);

    expect(result).toEqual({ status: 'failed-gate', gateId: 'permission' });
    expect(mockMetadata.get(`job:${kind}:state`)).toBe('');
    expect(useLibraryJobStore.getState().jobs[kind].failure?.reason).toBe('no-permission');
  });

  it('DEFERS when a gate throws, so one bad read cannot discard a good breadcrumb', async () => {
    registerJob(
      makeDescriptor(kind, {
        gates: [
          {
            id: 'explodes',
            check: () => {
              throw new Error('sqlite is having a day');
            },
          },
        ],
      })
    );
    writeBreadcrumb(kind, Date.now());

    const result = await tryResumeJob(kind);

    expect(result).toEqual({ status: 'skipped', reason: 'deferred' });
    expect(mockMetadata.get(`job:${kind}:state`)).toBeTruthy();
  });

  it('awaits a pending cancel before reading, so a fast cancel + bounce cannot resurrect it', async () => {
    registerJob(makeDescriptor(kind));
    await startJob(kind, {});
    // cancelJob kicks off the breadcrumb clear WITHOUT awaiting it. Resuming
    // before that lands would read the record the cancel is about to erase.
    cancelJob(kind);
    expect(getCancelInFlight(kind)).not.toBeNull();

    const result = await tryResumeJob(kind);

    expect(result).toEqual({ status: 'skipped', reason: 'no-flag' });
    expect(isJobRunning(kind)).toBe(false);
  });
});

describe('tryResumeJob mutual exclusion', () => {
  it('skips a resumable job while the other kind holds the cache', async () => {
    registerJob(makeDescriptor('trip-scan'));
    registerJob(makeDescriptor('quiz-build'));
    await startJob('trip-scan', {});
    writeBreadcrumb('quiz-build', Date.now());

    const result = await tryResumeJob('quiz-build');

    expect(result).toEqual({ status: 'skipped', reason: 'other-job-running' });
    // Deliberately NOT cleared: the quiz still deserves its resume, just later.
    expect(mockMetadata.get('job:quiz-build:state')).toBeTruthy();
  });

  it('still clears a STALE breadcrumb even while the other kind runs', async () => {
    registerJob(makeDescriptor('trip-scan'));
    registerJob(makeDescriptor('quiz-build', { stalenessMs: 1000 }));
    await startJob('trip-scan', {});
    writeBreadcrumb('quiz-build', Date.now() - 5000);

    const result = await tryResumeJob('quiz-build');

    // Staleness is checked BEFORE the other-job lock so a dead record cannot
    // linger behind a long-running sibling.
    expect(result).toEqual({ status: 'failed-gate', gateId: 'staleness' });
    expect(mockMetadata.get('job:quiz-build:state')).toBe('');
  });
});

describe('detectStuckJobs', () => {
  it('ignores a job that is not running', () => {
    registerJob(makeDescriptor('trip-scan'));
    expect(detectStuckJobs()).toEqual([]);
  });

  it('ignores a job that has only just started', async () => {
    registerJob(makeDescriptor('trip-scan'));
    await startJob('trip-scan', {});
    expect(detectStuckJobs()).toEqual([]);
  });

  it('fails a running job that has made no progress for its threshold', async () => {
    registerJob(makeDescriptor('trip-scan', { stuckThresholdMs: 1000 }));
    await startJob('trip-scan', {});
    await flush();
    patchJobSlice('trip-scan', { phase: 'running' });

    const realNow = Date.now;
    Date.now = () => realNow() + 60_000;
    try {
      expect(detectStuckJobs()).toEqual(['trip-scan']);
    } finally {
      Date.now = realNow;
    }
    expect(useLibraryJobStore.getState().jobs['trip-scan'].failure?.reason).toBe('stuck');
    expect(isJobRunning('trip-scan')).toBe(false);
  });
});

describe('suspended and frozen jobs (continuation hardening)', () => {
  /**
   * With a continued-processing lease, a job can be SUSPENDED (the loop
   * yielded between units and kept the breadcrumb) or FROZEN (iOS stopped the
   * process mid-unit and thawed it on foreground). Neither is stuck, and
   * neither is stale just because time passed while the app was away.
   */

  function withNow<T>(now: number, fn: () => T): T {
    const realNow = Date.now;
    Date.now = () => now;
    try {
      return fn();
    } finally {
      Date.now = realNow;
    }
  }

  it('does not mark a suspended job stuck (running slice, not isJobRunning), and resumes it', async () => {
    const onStart = jest.fn();
    registerJob(makeDescriptor('trip-scan', { onStart, stuckThresholdMs: 5 * 60 * 1000 }));
    // The slice still reads `running` — a suspended job keeps it — but the
    // runtime is not executing it, and its last heartbeat was 6 minutes ago.
    patchJobSlice('trip-scan', { phase: 'running' });
    writeBreadcrumb('trip-scan', Date.now() - 6 * 60 * 1000);

    expect(withNow(Date.now() + 6 * 60 * 1000, () => detectStuckJobs())).toEqual([]);
    expect(useLibraryJobStore.getState().jobs['trip-scan'].phase).toBe('running');

    const results = await tryResumeJobs();
    expect(results['trip-scan']).toEqual({ status: 'started' });
    await flush();
    expect(onStart).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ resumed: true })
    );
  });

  it('still marks a job the runtime IS running stuck after the threshold', async () => {
    registerJob(makeDescriptor('trip-scan', { stuckThresholdMs: 5 * 60 * 1000 }));
    await startJob('trip-scan', {});
    await flush();
    patchJobSlice('trip-scan', { phase: 'running' });

    expect(withNow(Date.now() + 6 * 60 * 1000, () => detectStuckJobs())).toEqual(['trip-scan']);
  });

  it('measures staleness from lastCheckpointAt, falling back to startedAt', async () => {
    const THIRTY_MIN = 30 * 60 * 1000;
    registerJob(makeDescriptor('quiz-build', { stalenessMs: THIRTY_MIN }));
    mockMetadata.set(
      'job:quiz-build:state',
      JSON.stringify({
        v: 1,
        startedAt: Date.now() - 40 * 60 * 1000,
        lastCheckpointAt: Date.now() - 2 * 60 * 1000,
        options: {},
      })
    );
    expect(await tryResumeJob('quiz-build')).toEqual({ status: 'started' });

    cancelJob('quiz-build');
    await getCancelInFlight('quiz-build');
    // No lastCheckpointAt: a 40-minute-old start IS stale.
    writeBreadcrumb('quiz-build', Date.now() - 40 * 60 * 1000);
    expect(await tryResumeJob('quiz-build')).toEqual({
      status: 'failed-gate',
      gateId: 'staleness',
    });
  });

  it('starts a waiting job with resumed:true when its peer is no longer running', async () => {
    // A scan runs; a quiz queues behind it; the scan then yields (suspended),
    // which does NOT drain the queue. On the next foreground the scan's
    // breadcrumb is gone (say a gate cleared it), so the waiting quiz is the
    // foreground's to start.
    let yieldNow = false;
    registerJobDriver({ shouldYield: () => yieldNow });
    registerJob(
      makeDescriptor('trip-scan', {
        steps: [
          {
            id: 'one',
            isDone: (c) => c.n >= 2,
            run: async (_ctx, c) => {
              yieldNow = true;
              return { n: c.n + 1 };
            },
          },
        ],
      })
    );
    const quizOnStart = jest.fn();
    registerJob(makeDescriptor('quiz-build', { onStart: quizOnStart }));

    await startJob('trip-scan', {});
    expect(await startJob('quiz-build', { seed: 1 })).toEqual({
      status: 'queued',
      blockedBy: 'trip-scan',
    });
    await flush(30);
    expect(isJobRunning('trip-scan')).toBe(false);
    expect(useLibraryJobStore.getState().jobs['quiz-build'].phase).toBe('waiting');
    expect(quizOnStart).not.toHaveBeenCalled();

    // The scan's breadcrumb (and its legacy mirror) is cleared out from under it.
    mockMetadata.delete('job:trip-scan:state');
    mockMetadata.set('scan_in_progress', 'false');
    await tryResumeJobs();
    await flush();

    expect(quizOnStart).toHaveBeenCalledWith(
      { seed: 1 },
      expect.objectContaining({ resumed: true })
    );
    expect(isJobRunning('quiz-build')).toBe(true);
  });

  it('markForegroundReturn() re-stamps every running kind so a thaw is not read as silence', async () => {
    registerJob(makeDescriptor('trip-scan', { stuckThresholdMs: 1000 }));
    await startJob('trip-scan', {});
    await flush();
    patchJobSlice('trip-scan', { phase: 'running' });

    const later = Date.now() + 60_000;
    withNow(later, () => markForegroundReturn());
    expect(withNow(later + 500, () => detectStuckJobs())).toEqual([]);
    expect(getLastProgressAt('trip-scan')).toBe(later);
  });
});
