/**
 * continuationLease - the lease driver's state machine.
 *
 * The driver is exercised through the REAL runtime registry (`_emitJob*`), so
 * what is tested is exactly what the runtime delivers; the native module is a
 * controllable fake whose listeners the test fires.
 */

import { AppState } from 'react-native';

// --- Mocks -----------------------------------------------------------------

// eslint-disable-next-line no-var
var mockNative: {
  available: boolean;
  capabilities: { continuedProcessing: boolean; graceWindow: boolean; lowPowerMode?: boolean };
  beginResult: { leaseId: string; state: string; reason?: string };
  begin: jest.Mock;
  end: jest.Mock;
  updateProgress: jest.Mock;
  updateTitle: jest.Mock;
  stateListeners: Array<(e: { leaseId: string; state: 'running' }) => void>;
  expiredListeners: Array<(e: { leaseId: string; tier: 'continued' | 'grace' }) => void>;
};

jest.mock('@modules/job-continuation', () => ({
  isJobContinuationAvailable: () => mockNative.available,
  jobContinuationCapabilities: () =>
    mockNative.available
      ? mockNative.capabilities
      : { continuedProcessing: false, graceWindow: false },
  backgroundRefreshStatus: async () => 'available',
  beginLease: (...args: unknown[]) => mockNative.begin(...args),
  endLease: (...args: unknown[]) => mockNative.end(...args),
  updateLeaseProgress: (...args: unknown[]) => mockNative.updateProgress(...args),
  updateLeaseTitle: (...args: unknown[]) => mockNative.updateTitle(...args),
  addLeaseStateListener: (l: (e: { leaseId: string; state: 'running' }) => void) => {
    mockNative.stateListeners.push(l);
    return () => {
      mockNative.stateListeners = mockNative.stateListeners.filter((x) => x !== l);
    };
  },
  addLeaseExpiredListener: (l: (e: { leaseId: string; tier: 'continued' | 'grace' }) => void) => {
    mockNative.expiredListeners.push(l);
    return () => {
      mockNative.expiredListeners = mockNative.expiredListeners.filter((x) => x !== l);
    };
  },
}));

// eslint-disable-next-line no-var
var mockInBgHandler = false;
jest.mock('@services/jobs/backgroundJobTask', () => ({
  isExecutingInBackgroundHandler: () => mockInBgHandler,
}));

// eslint-disable-next-line no-var
var mockFlag = true;
jest.mock('@config/features', () => ({
  features: {
    get enableJobContinuationLease() {
      return mockFlag;
    },
  },
}));

const mockTrack = jest.fn();
jest.mock('@services/analytics', () => {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get: (_t, name: string) => (props: unknown) => mockTrack(name, props),
  };
  return { Analytics: new Proxy({}, handler) };
});

import {
  __getLeaseForTesting,
  __resetContinuationLeaseForTesting,
  registerContinuationLease,
} from '@services/jobs/continuationLease';
import {
  __resetJobRuntimeStateForTesting,
  _emitJobHeartbeat,
  _emitJobIdle,
  _emitJobSettled,
  _emitJobStarted,
  shouldYieldNow,
} from '@services/jobs/jobRuntimeState';
import { useContinuationLeaseStore } from '@stores/continuationLeaseStore';
import { patchJobSlice, resetLibraryJobStore } from '@stores/libraryJobStore';
import type { JobDriverStartEvent } from '@services/jobs/jobTypes';

jest.useFakeTimers({ doNotFake: ['setImmediate'] });

function setAppState(state: string): void {
  (AppState as { currentState: string }).currentState = state;
}

/** Let the driver's serialized native queue drain. */
async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

function started(overrides: Partial<JobDriverStartEvent> = {}): JobDriverStartEvent {
  return {
    kind: 'trip-scan',
    generation: 1,
    resumed: false,
    foregroundAtCall: true,
    ...overrides,
  };
}

function tracked(name: string): unknown[] {
  return mockTrack.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
}

beforeEach(() => {
  mockNative = {
    available: true,
    capabilities: { continuedProcessing: true, graceWindow: true, lowPowerMode: false },
    beginResult: { leaseId: 'L1', state: 'pending' },
    begin: jest.fn(async () => mockNative.beginResult),
    end: jest.fn(async () => undefined),
    updateProgress: jest.fn(),
    updateTitle: jest.fn(),
    stateListeners: [],
    expiredListeners: [],
  };
  mockInBgHandler = false;
  mockFlag = true;
  mockTrack.mockClear();
  __resetContinuationLeaseForTesting();
  __resetJobRuntimeStateForTesting();
  resetLibraryJobStore();
  setAppState('active');
  jest.setSystemTime(1_000_000);
});

async function beginAndRun(event: Partial<JobDriverStartEvent> = {}): Promise<void> {
  registerContinuationLease();
  _emitJobStarted(started(event));
  await flush();
  for (const l of mockNative.stateListeners) l({ leaseId: 'L1', state: 'running' });
}

describe('registration', () => {
  it('flag false → no driver, no native call, but capabilities still tracked once', () => {
    mockFlag = false;
    registerContinuationLease();
    registerContinuationLease();
    _emitJobStarted(started());
    expect(mockNative.begin).not.toHaveBeenCalled();
    expect(tracked('jobContinuationCapabilities')).toHaveLength(1);
    expect(tracked('jobContinuationCapabilities')[0]).toMatchObject({ flagEnabled: false });
  });

  it('module absent → every lifecycle event is a no-op and nothing throws', async () => {
    mockNative.available = false;
    registerContinuationLease();
    _emitJobStarted(started());
    _emitJobHeartbeat({ kind: 'trip-scan', generation: 1 });
    _emitJobSettled({ kind: 'trip-scan', generation: 1, outcome: 'completed' });
    _emitJobIdle();
    await flush();
    expect(mockNative.begin).not.toHaveBeenCalled();
    expect(mockNative.end).not.toHaveBeenCalled();
    expect(shouldYieldNow('trip-scan', 1)).toBe(false);
    expect(tracked('jobContinuationCapabilities')[0]).toMatchObject({
      moduleAvailable: false,
      continuedProcessing: false,
    });
  });
});

describe('acquiring', () => {
  it('foreground start → begin once with the kind title; lease_begin tier continued', async () => {
    await beginAndRun();
    expect(mockNative.begin).toHaveBeenCalledTimes(1);
    expect(mockNative.begin).toHaveBeenCalledWith({
      title: 'Photo scan',
      subtitle: expect.any(String),
    });
    expect(tracked('leaseBegin')).toEqual([
      expect.objectContaining({ tier: 'continued', kind: 'trip-scan', resumed: false }),
    ]);
    expect(__getLeaseForTesting()).toMatchObject({
      leaseId: 'L1',
      phase: 'running',
      tier: 'continued',
    });
    expect(useContinuationLeaseStore.getState()).toEqual({
      phase: 'running',
      tier: 'continued',
      kind: 'trip-scan',
    });
    expect(tracked('leaseHandlerFired')).toHaveLength(1);
  });

  it('start inside the BG-task handler → no begin, skippedReason bg-handler', async () => {
    mockInBgHandler = true;
    registerContinuationLease();
    _emitJobStarted(started());
    await flush();
    expect(mockNative.begin).not.toHaveBeenCalled();
    expect(tracked('leaseBegin')[0]).toMatchObject({ tier: 'none', skippedReason: 'bg-handler' });
  });

  it('foregroundAtCall false → no begin; inactive-at-call (foregroundAtCall true) → begin', async () => {
    registerContinuationLease();
    _emitJobStarted(started({ foregroundAtCall: false }));
    await flush();
    expect(mockNative.begin).not.toHaveBeenCalled();
    expect(tracked('leaseBegin')[0]).toMatchObject({ skippedReason: 'not-foreground' });
    _emitJobSettled({ kind: 'trip-scan', generation: 1, outcome: 'completed' });
    _emitJobIdle();

    // The runtime captured foreground-ness at call time, before the Photos
    // prompt moved AppState to `inactive`; the driver trusts that flag.
    setAppState('inactive');
    _emitJobStarted(started({ generation: 2 }));
    await flush();
    expect(mockNative.begin).toHaveBeenCalledTimes(1);
  });

  it('grace-only begin → tier grace, phase running, and the copy store does not say "keeps running"', async () => {
    mockNative.beginResult = { leaseId: 'G1', state: 'grace-only', reason: 'os-too-old' };
    registerContinuationLease();
    _emitJobStarted(started());
    await flush();
    expect(__getLeaseForTesting()).toMatchObject({ tier: 'grace', phase: 'running' });
    expect(tracked('leaseBegin')[0]).toMatchObject({ tier: 'grace', skippedReason: 'os-too-old' });
    expect(useContinuationLeaseStore.getState().tier).toBe('grace');
  });
});

describe('queue drain (lease per runtime)', () => {
  it('second onStarted while held → updateTitle, not begin; onSettled does not end; onIdle does', async () => {
    await beginAndRun();
    patchJobSlice('trip-scan', {
      progress: { current: 9, total: 10, percentage: 90, phase: 'geocoding' },
    });
    _emitJobHeartbeat({ kind: 'trip-scan', generation: 1 });
    jest.advanceTimersByTime(300);
    const scanFinal = mockNative.updateProgress.mock.calls.at(-1)![0] as number;

    _emitJobSettled({ kind: 'trip-scan', generation: 1, outcome: 'completed' });
    expect(mockNative.end).not.toHaveBeenCalled();

    _emitJobStarted(started({ kind: 'quiz-build', generation: 2 }));
    await flush();
    expect(mockNative.begin).toHaveBeenCalledTimes(1);
    expect(mockNative.updateTitle).toHaveBeenCalledWith(
      'Building your challenge',
      expect.any(String)
    );
    expect(__getLeaseForTesting()).toMatchObject({ kind: 'quiz-build', generation: 2 });

    // The mapper restarted: the next push is LOWER than the scan's final value,
    // and monotonic from there.
    jest.advanceTimersByTime(300);
    patchJobSlice('quiz-build', {
      progress: { current: 1, total: 10, percentage: 10, phase: 'checking' },
    });
    _emitJobHeartbeat({ kind: 'quiz-build', generation: 2 });
    jest.advanceTimersByTime(300);
    const allPushes = mockNative.updateProgress.mock.calls.map((c) => c[0] as number);
    // The scan's completion pinned the bar at the total; everything after that
    // belongs to the quiz.
    const pushesAfter = allPushes.slice(allPushes.lastIndexOf(1000) + 1);
    expect(pushesAfter.length).toBeGreaterThan(0);
    expect(pushesAfter[0]).toBeLessThan(scanFinal);
    for (let i = 1; i < pushesAfter.length; i += 1) {
      expect(pushesAfter[i]).toBeGreaterThanOrEqual(pushesAfter[i - 1]);
    }

    _emitJobSettled({ kind: 'quiz-build', generation: 2, outcome: 'completed' });
    _emitJobIdle();
    await flush();
    expect(mockNative.end).toHaveBeenCalledWith(true);
    expect(tracked('leaseEnded')[0]).toMatchObject({ outcome: 'completed' });
    expect(useContinuationLeaseStore.getState().phase).toBe('idle');
  });
});

describe('expiry → run-scoped yield', () => {
  it('expired while background → shouldYield true only for the leased generation', async () => {
    await beginAndRun();
    setAppState('background');
    for (const l of mockNative.expiredListeners) l({ leaseId: 'L1', tier: 'continued' });
    expect(shouldYieldNow('trip-scan', 1)).toBe(true);
    expect(shouldYieldNow('trip-scan', 2)).toBe(false);
    expect(shouldYieldNow('quiz-build', 1)).toBe(false);
    expect(tracked('leaseExpired')).toEqual([
      expect.objectContaining({ tier: 'continued', appState: 'background' }),
    ]);
    expect(useContinuationLeaseStore.getState().phase).toBe('expired');
  });

  it('expired while active → no yield, lease cleared', async () => {
    await beginAndRun();
    for (const l of mockNative.expiredListeners) l({ leaseId: 'L1', tier: 'continued' });
    expect(shouldYieldNow('trip-scan', 1)).toBe(false);
    expect(__getLeaseForTesting()).toBeNull();
    await flush();
    expect(mockNative.end).toHaveBeenCalledTimes(1);
  });

  it('expired in background, then active before the pull → no yield, lease dropped, job continues', async () => {
    await beginAndRun();
    setAppState('background');
    for (const l of mockNative.expiredListeners) l({ leaseId: 'L1', tier: 'continued' });
    setAppState('active');
    expect(shouldYieldNow('trip-scan', 1)).toBe(false);
    expect(__getLeaseForTesting()).toBeNull();
    await flush();
    expect(mockNative.end).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale leaseId, and a second expired for the same lease is a no-op', async () => {
    await beginAndRun();
    setAppState('background');
    for (const l of mockNative.expiredListeners) l({ leaseId: 'OLD', tier: 'continued' });
    expect(shouldYieldNow('trip-scan', 1)).toBe(false);
    for (const l of mockNative.expiredListeners) l({ leaseId: 'L1', tier: 'continued' });
    for (const l of mockNative.expiredListeners) l({ leaseId: 'L1', tier: 'grace' });
    expect(shouldYieldNow('trip-scan', 1)).toBe(true);
    expect(tracked('leaseExpired')).toHaveLength(1);
  });

  it('a grace-tier expiry never requests a yield (KTD3) and drops a grace-only lease', async () => {
    mockNative.beginResult = { leaseId: 'G1', state: 'grace-only' };
    registerContinuationLease();
    _emitJobStarted(started());
    await flush();
    setAppState('background');
    for (const l of mockNative.expiredListeners) l({ leaseId: 'G1', tier: 'grace' });
    expect(shouldYieldNow('trip-scan', 1)).toBe(false);
    expect(__getLeaseForTesting()).toBeNull();
    expect(tracked('leaseExpired')[0]).toMatchObject({ tier: 'grace' });
  });

  it('re-acquires once per kind after an expiration; a fresh start resets the cap', async () => {
    await beginAndRun();
    setAppState('background');
    for (const l of mockNative.expiredListeners) l({ leaseId: 'L1', tier: 'continued' });
    expect(shouldYieldNow('trip-scan', 1)).toBe(true);
    _emitJobSettled({ kind: 'trip-scan', generation: 1, outcome: 'suspended' });
    _emitJobIdle();
    await flush();
    expect(mockNative.end).toHaveBeenCalledTimes(1);

    // Foreground resume: new generation, durable startedAt rewritten — the
    // counter is keyed on kind alone, and this is the one allowed re-acquire.
    setAppState('active');
    mockNative.beginResult = { leaseId: 'L2', state: 'pending' };
    _emitJobStarted(started({ generation: 7, resumed: true }));
    await flush();
    expect(mockNative.begin).toHaveBeenCalledTimes(2);
    for (const l of mockNative.stateListeners) l({ leaseId: 'L2', state: 'running' });

    // Second expiration + resume of the SAME kind: no third begin.
    setAppState('background');
    for (const l of mockNative.expiredListeners) l({ leaseId: 'L2', tier: 'continued' });
    expect(shouldYieldNow('trip-scan', 7)).toBe(true);
    _emitJobSettled({ kind: 'trip-scan', generation: 7, outcome: 'suspended' });
    _emitJobIdle();
    await flush();
    setAppState('active');
    _emitJobStarted(started({ generation: 9, resumed: true }));
    await flush();
    expect(mockNative.begin).toHaveBeenCalledTimes(2);
    expect(tracked('leaseBegin').at(-1)).toMatchObject({ skippedReason: 'reacquire-cap' });
    _emitJobSettled({ kind: 'trip-scan', generation: 9, outcome: 'completed' });
    _emitJobIdle();

    // A fresh (non-resumed) start of the same kind resets the counter.
    _emitJobStarted(started({ generation: 11, resumed: false }));
    await flush();
    expect(mockNative.begin).toHaveBeenCalledTimes(3);
  });
});

describe('ending', () => {
  it('sign-out: onSettled then onIdle → end() awaited before a later begin()', async () => {
    await beginAndRun();
    let resolveEnd: () => void = () => {};
    mockNative.end.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolveEnd = r;
        })
    );
    _emitJobSettled({ kind: 'trip-scan', generation: 1, outcome: 'cancelled' });
    _emitJobIdle();
    await flush();
    expect(mockNative.end).toHaveBeenCalledTimes(1);

    // User B starts a job while the end is still in flight.
    _emitJobStarted(started({ generation: 2 }));
    await flush();
    expect(mockNative.begin).toHaveBeenCalledTimes(1); // not yet
    resolveEnd();
    await flush();
    expect(mockNative.begin).toHaveBeenCalledTimes(2);
  });

  it('synchronous cancel settle followed by idle → end(false) before the in-flight step resolves', async () => {
    await beginAndRun();
    _emitJobSettled({ kind: 'trip-scan', generation: 1, outcome: 'cancelled' });
    _emitJobIdle();
    await flush();
    expect(mockNative.end).toHaveBeenCalledWith(false);
    expect(tracked('leaseEnded')[0]).toMatchObject({ outcome: 'cancelled' });
  });
});

describe('progress pushes', () => {
  it('coalesces a burst of emits into a handful of native updates', async () => {
    await beginAndRun();
    mockNative.updateProgress.mockClear();
    for (let i = 0; i < 50; i += 1) {
      patchJobSlice('trip-scan', {
        progress: { current: i, total: 100, percentage: i, phase: 'scanning' },
      });
      _emitJobHeartbeat({ kind: 'trip-scan', generation: 1 });
      jest.advanceTimersByTime(2);
    }
    jest.advanceTimersByTime(300);
    expect(mockNative.updateProgress.mock.calls.length).toBeLessThanOrEqual(4);
    const values = mockNative.updateProgress.mock.calls.map((c) => c[0] as number);
    for (let i = 1; i < values.length; i += 1)
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
  });

  it('ignores heartbeats for a stale generation', async () => {
    await beginAndRun();
    mockNative.updateProgress.mockClear();
    _emitJobHeartbeat({ kind: 'trip-scan', generation: 99 });
    jest.advanceTimersByTime(300);
    expect(mockNative.updateProgress).not.toHaveBeenCalled();
  });
});
