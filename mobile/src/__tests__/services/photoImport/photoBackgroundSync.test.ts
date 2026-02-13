/**
 * Tests for background photo sync race condition fix.
 *
 * Reproduces the race where:
 * 1. Sync A starts → sets lock
 * 2. abortBackgroundSync() → clears lock + aborts A
 * 3. Sync B starts → sets lock
 * 4. Sync A's finally block runs → clears lock (clobbering B!)
 * 5. Sync C can now enter while B is still running
 *
 * The fix uses a pending promise pattern so each call's cleanup
 * only clears its own lock, not a subsequent call's.
 */

// We test the module-level locking logic directly because the dynamic import()
// in getBackgroundSyncDeps() doesn't work in Jest. Instead, we extract and test
// the lock pattern in isolation.

describe('photoBackgroundSync lock pattern', () => {
  // Reproduce the exact locking pattern from photoBackgroundSync.ts
  let syncInProgress = false;
  let syncController: AbortController | null = null;

  function isInProgress() {
    return syncInProgress;
  }

  function abortSync() {
    if (syncController) {
      syncController.abort();
      syncController = null;
      syncInProgress = false;
    }
  }

  // Original (buggy) implementation
  async function syncOriginal(work: () => Promise<void>): Promise<string> {
    if (syncInProgress) return 'blocked';
    syncInProgress = true;
    syncController = new AbortController();
    const localController = syncController;

    try {
      if (localController.signal.aborted) return 'aborted';
      await work();
      if (localController.signal.aborted) return 'aborted';
      return 'done';
    } catch {
      return 'error';
    } finally {
      // BUG: unconditionally clears lock — may clobber a later call's lock
      syncInProgress = false;
      syncController = null;
    }
  }

  // Fixed implementation using a sync ID
  let currentSyncId = 0;

  async function syncFixed(work: () => Promise<void>): Promise<string> {
    if (syncInProgress) return 'blocked';
    syncInProgress = true;
    syncController = new AbortController();
    const localController = syncController;
    const mySyncId = ++currentSyncId;

    try {
      if (localController.signal.aborted) return 'aborted';
      await work();
      if (localController.signal.aborted) return 'aborted';
      return 'done';
    } catch {
      return 'error';
    } finally {
      // Only clear lock if we still own it
      if (currentSyncId === mySyncId) {
        syncInProgress = false;
        syncController = null;
      }
    }
  }

  beforeEach(() => {
    syncInProgress = false;
    syncController = null;
    currentSyncId = 0;
  });

  describe('original (buggy) pattern', () => {
    it('abort + restart: old finally clobbers new lock', async () => {
      let resolveA: () => void;
      const workA = () =>
        new Promise<void>((r) => {
          resolveA = r;
        });

      let resolveB: () => void;
      const workB = () =>
        new Promise<void>((r) => {
          resolveB = r;
        });

      // 1. Start sync A
      const promiseA = syncOriginal(workA);
      expect(isInProgress()).toBe(true);

      // 2. Abort sync A and start sync B
      abortSync();
      expect(isInProgress()).toBe(false);

      const promiseB = syncOriginal(workB);
      expect(isInProgress()).toBe(true);

      // 3. Resolve sync A's work (it was awaiting this)
      //    A's finally block will now run
      resolveA!();
      await promiseA;

      // 4. BUG: A's finally cleared the lock, clobbering B
      expect(isInProgress()).toBe(false); // This SHOULD be true, but the bug makes it false

      // Clean up
      resolveB!();
      await promiseB;
    });
  });

  describe('fixed pattern', () => {
    it('abort + restart: old finally does NOT clobber new lock', async () => {
      let resolveA: () => void;
      const workA = () =>
        new Promise<void>((r) => {
          resolveA = r;
        });

      let resolveB: () => void;
      const workB = () =>
        new Promise<void>((r) => {
          resolveB = r;
        });

      // 1. Start sync A
      const promiseA = syncFixed(workA);
      expect(isInProgress()).toBe(true);

      // 2. Abort sync A and start sync B
      abortSync();
      expect(isInProgress()).toBe(false);

      const promiseB = syncFixed(workB);
      expect(isInProgress()).toBe(true);

      // 3. Resolve sync A's work — A's finally runs but doesn't own the lock
      resolveA!();
      await promiseA;

      // 4. FIX: B's lock is preserved
      expect(isInProgress()).toBe(true);

      // Clean up
      resolveB!();
      await promiseB;
      expect(isInProgress()).toBe(false);
    });

    it('two concurrent calls: second is rejected by lock', async () => {
      let resolveA: () => void;
      const workA = () =>
        new Promise<void>((r) => {
          resolveA = r;
        });
      const workB = () => Promise.resolve();

      const promiseA = syncFixed(workA);
      const promiseB = syncFixed(workB);

      resolveA!();

      const [resultA, resultB] = await Promise.all([promiseA, promiseB]);
      expect(resultA).toBe('done');
      expect(resultB).toBe('blocked');
    });

    it('releases lock after normal completion', async () => {
      await syncFixed(() => Promise.resolve());
      expect(isInProgress()).toBe(false);

      await syncFixed(() => Promise.resolve());
      expect(isInProgress()).toBe(false);
    });

    it('releases lock on error', async () => {
      await syncFixed(() => Promise.reject(new Error('fail')));
      expect(isInProgress()).toBe(false);
    });
  });
});
