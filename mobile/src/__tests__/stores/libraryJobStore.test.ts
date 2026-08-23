/**
 * Tests for libraryJobStore.
 *
 * The load-bearing one is the FIRST: this store must never be persisted. That
 * rule lived only in a header comment until now, which is exactly the kind of
 * rule a future contributor adds `persist(...)` straight through. Persisting it
 * would round-trip a `phase` that is meaningless across launches and a set of
 * quiz `pickUris` that are local `file://` paths gone stale by then; the real
 * durable state is `job:<kind>:state` in SQLite.
 */

import {
  patchJobSlice,
  resetJobSlice,
  resetLibraryJobStore,
  selectActiveJob,
  useLibraryJobStore,
} from '@stores/libraryJobStore';

beforeEach(() => {
  resetLibraryJobStore();
});

describe('libraryJobStore persistence', () => {
  it('is NOT persisted', () => {
    // `persist` middleware attaches a `persist` API to the store. Its absence
    // is the assertion.
    expect((useLibraryJobStore as unknown as { persist?: unknown }).persist).toBeUndefined();
  });
});

describe('libraryJobStore slice isolation', () => {
  it('resets one kind without disturbing the other', () => {
    patchJobSlice('trip-scan', { phase: 'running' });
    patchJobSlice('quiz-build', { phase: 'completed', hasResult: true });

    resetJobSlice('trip-scan');

    expect(useLibraryJobStore.getState().jobs['trip-scan'].phase).toBe('idle');
    expect(useLibraryJobStore.getState().jobs['quiz-build'].phase).toBe('completed');
    expect(useLibraryJobStore.getState().jobs['quiz-build'].hasResult).toBe(true);
  });

  it('hands out a fresh detail object on reset, so one reset cannot leak into the next', () => {
    const first = useLibraryJobStore.getState().jobs['trip-scan'].detail;
    first.discoveredCountries.push({ code: 'JP', name: 'Japan' });

    resetLibraryJobStore();

    expect(useLibraryJobStore.getState().jobs['trip-scan'].detail.discoveredCountries).toEqual([]);
  });
});

describe('selectActiveJob', () => {
  it('returns null when nothing is running', () => {
    expect(selectActiveJob(useLibraryJobStore.getState())).toBeNull();
  });

  it('lets a running job outrank a finished one', () => {
    patchJobSlice('quiz-build', { phase: 'completed', hasResult: true, startedAt: 100 });
    patchJobSlice('trip-scan', { phase: 'running', startedAt: 200 });

    expect(selectActiveJob(useLibraryJobStore.getState())?.kind).toBe('trip-scan');
  });

  it('picks the most recently started job when both are terminal', () => {
    patchJobSlice('trip-scan', { phase: 'completed', hasResult: true, startedAt: 100 });
    patchJobSlice('quiz-build', { phase: 'failed', startedAt: 200 });

    expect(selectActiveJob(useLibraryJobStore.getState())?.kind).toBe('quiz-build');
  });

  it('surfaces a waiting job, so a queued build can explain itself', () => {
    patchJobSlice('quiz-build', { phase: 'waiting' });

    const active = selectActiveJob(useLibraryJobStore.getState());
    expect(active).toEqual(expect.objectContaining({ kind: 'quiz-build', phase: 'waiting' }));
  });
});
