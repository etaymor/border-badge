/**
 * Tests for jobRuntime - the shell every library job runs inside.
 *
 * These lock in the concurrency properties that were previously proven only
 * for the trip scan, plus the two that are new: mutual exclusion between kinds
 * and the queue drain.
 */

import {
  __resetRuntimeForTesting,
  cancelJob,
  getLastProgressAt,
  isAnyLibraryJobRunning,
  isJobRunning,
  markJobFailed,
  startJob,
} from '@services/jobs/jobRuntime';
import { __clearRegistryForTesting, registerJob } from '@services/jobs/jobRegistry';
import { __resetJobRuntimeStateForTesting, setYieldProvider } from '@services/jobs/jobRuntimeState';
import { resetLibraryJobStore, useLibraryJobStore } from '@stores/libraryJobStore';
import type { JobDescriptor } from '@services/jobs/jobRegistry';
import type { JobRunContext, LibraryJobKind } from '@services/jobs/jobTypes';

// --- Mocks ---

const mockMetadata = new Map<string, string>();

jest.mock('@services/photoImport/photoCacheDb', () => ({
  getMetadata: jest.fn(async (key: string) => mockMetadata.get(key) ?? null),
  setMetadata: jest.fn(async (key: string, value: string) => {
    mockMetadata.set(key, value);
  }),
}));

// --- Helpers ---

interface FakeJobOptions {
  runs?: number;
}

function makeDescriptor(
  kind: LibraryJobKind,
  overrides: Partial<JobDescriptor<{ n: number }, FakeJobOptions>> = {}
): JobDescriptor<{ n: number }, FakeJobOptions> {
  return {
    kind,
    steps: [
      {
        id: 'count',
        isDone: (c) => c.n >= 1,
        run: async (_ctx: JobRunContext, c) => ({ n: c.n + 1 }),
      },
    ],
    initialCheckpoint: () => ({ n: 0 }),
    gates: [],
    stalenessMs: 60_000,
    stuckThresholdMs: 5_000,
    autoDismissMs: 30_000,
    consumeOnDismiss: true,
    onStart: jest.fn(),
    onSettle: jest.fn(),
    isAlertFailure: () => true,
    ...overrides,
  };
}

/** Let the unawaited runJob promise chain settle. */
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

describe('startJob', () => {
  it('writes the durable breadcrumb BEFORE reporting started', async () => {
    registerJob(makeDescriptor('trip-scan'));

    const result = await startJob('trip-scan', {});
    expect(result).toEqual({ status: 'started' });
    // The record exists the moment 'started' is returned, so a crash right
    // here still leaves a breadcrumb for foreground auto-resume.
    expect(mockMetadata.get('job:trip-scan:state')).toBeTruthy();
  });

  it('dual-writes the legacy trip-scan flag for rollback safety', async () => {
    registerJob(makeDescriptor('trip-scan'));
    await startJob('trip-scan', {});
    expect(mockMetadata.get('scan_in_progress')).toBe('true');
    expect(mockMetadata.get('scan_started_at')).toBeTruthy();
  });

  it('is atomic: a second start while running reports already-running', async () => {
    let release: () => void = () => {};
    const blocked = new Promise<void>((r) => {
      release = r;
    });
    registerJob(
      makeDescriptor('trip-scan', {
        steps: [
          {
            id: 'block',
            isDone: (c) => c.n >= 1,
            run: async (_ctx, c) => {
              await blocked;
              return { n: c.n + 1 };
            },
          },
        ],
      })
    );

    await startJob('trip-scan', {});
    const second = await startJob('trip-scan', {});
    expect(second).toEqual({ status: 'already-running' });
    release();
    await flush();
  });

  it('does not leak the in-memory lock when the breadcrumb write throws', async () => {
    const { setMetadata } = jest.requireMock('@services/photoImport/photoCacheDb');
    setMetadata.mockRejectedValueOnce(new Error('disk full'));
    registerJob(makeDescriptor('trip-scan'));

    await expect(startJob('trip-scan', {})).rejects.toThrow('disk full');
    expect(isJobRunning('trip-scan')).toBe(false);
    expect(isAnyLibraryJobRunning()).toBe(false);
  });

  it('rejects an unregistered kind rather than throwing', async () => {
    const result = await startJob('quiz-build', {});
    expect(result).toEqual({ status: 'rejected', reason: 'not-registered' });
  });
});

describe('mutual exclusion', () => {
  it('queues the second kind instead of preempting the first', async () => {
    let release: () => void = () => {};
    const blocked = new Promise<void>((r) => {
      release = r;
    });
    registerJob(
      makeDescriptor('trip-scan', {
        steps: [
          {
            id: 'block',
            isDone: (c) => c.n >= 1,
            run: async (_ctx, c) => {
              await blocked;
              return { n: c.n + 1 };
            },
          },
        ],
      })
    );
    const quizOnStart = jest.fn();
    registerJob(makeDescriptor('quiz-build', { onStart: quizOnStart }));

    await startJob('trip-scan', {});
    const queuedResult = await startJob('quiz-build', {});

    expect(queuedResult).toEqual({ status: 'queued', blockedBy: 'trip-scan' });
    // The waiting slice is what lets the quiz wizard explain the wait rather
    // than looking hung.
    expect(useLibraryJobStore.getState().jobs['quiz-build'].phase).toBe('waiting');
    expect(quizOnStart).not.toHaveBeenCalled();
    expect(isJobRunning('trip-scan')).toBe(true);

    release();
    await flush(20);

    // Draining the queue starts the quiz once the scan releases the cache.
    expect(quizOnStart).toHaveBeenCalled();
  });
});

describe('cancelJob', () => {
  it('clears the breadcrumb and exposes the in-flight clear for resume to await', async () => {
    registerJob(makeDescriptor('trip-scan'));
    await startJob('trip-scan', {});
    cancelJob('trip-scan');

    expect(isJobRunning('trip-scan')).toBe(false);
    await flush();
    // Legacy flag flipped false so a rolled-back bundle can't resurrect it.
    expect(mockMetadata.get('scan_in_progress')).toBe('false');
  });

  it('drops a queued job when that queued kind is cancelled', async () => {
    let release: () => void = () => {};
    const blocked = new Promise<void>((r) => {
      release = r;
    });
    registerJob(
      makeDescriptor('trip-scan', {
        steps: [
          {
            id: 'block',
            isDone: (c) => c.n >= 1,
            run: async (_ctx, c) => {
              await blocked;
              return { n: c.n + 1 };
            },
          },
        ],
      })
    );
    const quizOnStart = jest.fn();
    registerJob(makeDescriptor('quiz-build', { onStart: quizOnStart }));

    await startJob('trip-scan', {});
    await startJob('quiz-build', {});
    cancelJob('quiz-build');

    release();
    await flush(20);
    expect(quizOnStart).not.toHaveBeenCalled();
  });
});

describe('the step loop', () => {
  it('checkpoints after every step so a resume can pick up mid-sequence', async () => {
    const saved: unknown[] = [];
    registerJob(
      makeDescriptor('trip-scan', {
        steps: [
          {
            id: 'multi',
            isDone: (c) => c.n >= 3,
            run: async (ctx, c) => {
              saved.push(c.n);
              ctx.heartbeat();
              return { n: c.n + 1 };
            },
          },
        ],
      })
    );

    await startJob('trip-scan', {});
    await flush(30);

    expect(saved).toEqual([0, 1, 2]);
    const record = JSON.parse(mockMetadata.get('job:trip-scan:state') || '{}');
    // The breadcrumb is cleared on completion, so the record is gone.
    expect(record.checkpoint).toBeUndefined();
  });

  it('resumes from a supplied checkpoint instead of the initial one', async () => {
    const seen: number[] = [];
    registerJob(
      makeDescriptor('trip-scan', {
        steps: [
          {
            id: 'multi',
            isDone: (c) => c.n >= 3,
            run: async (_ctx, c) => {
              seen.push(c.n);
              return { n: c.n + 1 };
            },
          },
        ],
      })
    );

    await startJob('trip-scan', {}, { checkpoint: { n: 2 } });
    await flush(20);
    expect(seen).toEqual([2]);
  });

  it('reports cancelled to onSettle when aborted mid-step', async () => {
    const onSettle = jest.fn();
    let release: () => void = () => {};
    const blocked = new Promise<void>((r) => {
      release = r;
    });
    registerJob(
      makeDescriptor('trip-scan', {
        onSettle,
        steps: [
          {
            id: 'block',
            isDone: (c) => c.n >= 2,
            run: async (_ctx, c) => {
              if (c.n === 0) await blocked;
              return { n: c.n + 1 };
            },
          },
        ],
      })
    );

    await startJob('trip-scan', {});
    cancelJob('trip-scan');
    release();
    await flush(20);

    // The generation guard means the cancelled run must not report completed.
    const outcomes = onSettle.mock.calls.map((c) => c[0]);
    expect(outcomes.every((o) => o !== 'completed')).toBe(true);
  });

  it('surfaces a thrown step as a failed outcome without leaking the lock', async () => {
    const onSettle = jest.fn();
    registerJob(
      makeDescriptor('trip-scan', {
        onSettle,
        steps: [
          {
            id: 'boom',
            isDone: () => false,
            run: async () => {
              throw new Error('step exploded');
            },
          },
        ],
      })
    );

    await startJob('trip-scan', {});
    await flush(20);

    expect(onSettle).toHaveBeenCalledWith('failed', expect.anything(), expect.any(Error));
    expect(isAnyLibraryJobRunning()).toBe(false);
  });
});

describe('the background-task yield seam', () => {
  /**
   * These pin the property that makes the BGProcessingTask phase additive: the
   * loop can be stopped between any two units WITHOUT the job body knowing,
   * and the durable breadcrumb is what carries the work forward.
   */

  it('stops between units and KEEPS the breadcrumb when asked to yield', async () => {
    const seen: number[] = [];
    let yieldNow = false;
    setYieldProvider(() => yieldNow);
    registerJob(
      makeDescriptor('trip-scan', {
        steps: [
          {
            id: 'multi',
            isDone: (c) => c.n >= 5,
            run: async (_ctx, c) => {
              seen.push(c.n);
              // Yield after the second unit, as an expiring background task
              // would.
              if (c.n >= 1) yieldNow = true;
              return { n: c.n + 1 };
            },
          },
        ],
      })
    );

    await startJob('trip-scan', {});
    await flush(30);

    // Stopped early...
    expect(seen).toEqual([0, 1]);
    // ...and the breadcrumb SURVIVED, carrying the checkpoint. This is the
    // difference between a yield and a completion: a cleared record would
    // silently throw the work away.
    const record = JSON.parse(mockMetadata.get('job:trip-scan:state') || '{}');
    expect(record.checkpoint).toEqual({ n: 2 });
  });

  it('resumes a yielded job from exactly where it stopped', async () => {
    const seen: number[] = [];
    // Yield exactly once, after the second unit — one expiring wake-up.
    let yieldsLeft = 1;
    let yieldNow = false;
    setYieldProvider(() => {
      if (!yieldNow || yieldsLeft <= 0) return false;
      yieldsLeft -= 1;
      yieldNow = false;
      return true;
    });
    registerJob(
      makeDescriptor('trip-scan', {
        steps: [
          {
            id: 'multi',
            isDone: (c) => c.n >= 5,
            run: async (_ctx, c) => {
              seen.push(c.n);
              if (c.n === 1) yieldNow = true;
              return { n: c.n + 1 };
            },
          },
        ],
      })
    );

    await startJob('trip-scan', {});
    await flush(30);
    const record = JSON.parse(mockMetadata.get('job:trip-scan:state') || '{}');
    expect(seen).toEqual([0, 1]);

    // A later wake-up picks the breadcrumb back up. No unit runs twice.
    await startJob('trip-scan', {}, { resumed: true, checkpoint: record.checkpoint });
    await flush(30);

    expect(seen).toEqual([0, 1, 2, 3, 4]);
  });

  it('never yields in the foreground', async () => {
    // The default provider is constant false, so a user watching a build sees
    // it run to completion exactly as before this seam existed.
    const seen: number[] = [];
    registerJob(
      makeDescriptor('trip-scan', {
        steps: [
          {
            id: 'multi',
            isDone: (c) => c.n >= 4,
            run: async (ctx, c) => {
              expect(ctx.shouldYield()).toBe(false);
              seen.push(c.n);
              return { n: c.n + 1 };
            },
          },
        ],
      })
    );

    await startJob('trip-scan', {});
    await flush(30);

    expect(seen).toEqual([0, 1, 2, 3]);
  });
});

describe('markJobFailed', () => {
  it('sets the failed phase and releases the lock', async () => {
    registerJob(makeDescriptor('trip-scan'));
    await startJob('trip-scan', {});

    markJobFailed('trip-scan', { reason: 'stuck', title: 'Stopped', message: 'no progress' });

    const slice = useLibraryJobStore.getState().jobs['trip-scan'];
    expect(slice.phase).toBe('failed');
    expect(slice.failure?.reason).toBe('stuck');
    expect(isJobRunning('trip-scan')).toBe(false);
  });
});

describe('heartbeat', () => {
  it('advances lastProgressAt so stuck detection stays quiet during slow work', async () => {
    registerJob(
      makeDescriptor('trip-scan', {
        steps: [
          {
            id: 'slow',
            isDone: (c) => c.n >= 1,
            run: async (ctx, c) => {
              ctx.heartbeat();
              return { n: c.n + 1 };
            },
          },
        ],
      })
    );

    await startJob('trip-scan', {});
    await flush(20);
    expect(getLastProgressAt('trip-scan')).toBeGreaterThan(0);
  });
});
