/**
 * useContinuationLeaseState - Read the lease driver's UI state.
 *
 * `keepsRunning` is the one bit the copy cares about: true only while a
 * continued-processing task is actually held (phase `running`, tier
 * `continued`). `pending`, `expired`, and the grace tier all read as false, so
 * the "keeps going after you leave" hint never over-promises.
 */

import { selectLeaseKeepsRunning, useContinuationLeaseStore } from '@stores/continuationLeaseStore';
import type { ContinuationLeaseState } from '@stores/continuationLeaseStore';

export function useContinuationLeaseState(): ContinuationLeaseState {
  return useContinuationLeaseStore((s) => s);
}

export function useLeaseKeepsRunning(): boolean {
  return useContinuationLeaseStore(selectLeaseKeepsRunning);
}
