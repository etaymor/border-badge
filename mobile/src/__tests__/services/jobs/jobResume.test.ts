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
  isJobRunning,
  startJob,
} from '@services/jobs/jobRuntime';
import { __resetJobRuntimeStateForTesting } from '@services/jobs/jobRuntimeState';
import { detectStuckJobs, tryResumeJob } from '@services/jobs/jobResume';
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
