/**
 * continuationLeaseStore - The lease driver's UI-facing state.
 *
 * A SEPARATE, non-persisted store — not a slice of `libraryJobStore` — because
 * `resetLibraryJobStore()` is called from the cancel and sign-out paths, which
 * can land while the driver is still mid-`end()`; the lease state must outlive
 * that reset so the banner never shows a "keeps going" hint over a lease that
 * is already gone (or hides one that is still held).
 *
 * Written only by `services/jobs/continuationLease`; read by
 * `hooks/useContinuationLeaseState`.
 */

import { create } from 'zustand';

import type { LibraryJobKind } from '@services/jobs/jobTypes';

export type ContinuationLeasePhase = 'idle' | 'pending' | 'running' | 'expired';
export type ContinuationLeaseTier = 'continued' | 'grace' | 'none';

export interface ContinuationLeaseState {
  phase: ContinuationLeasePhase;
  tier: ContinuationLeaseTier;
  kind: LibraryJobKind | null;
}

const initialState: ContinuationLeaseState = { phase: 'idle', tier: 'none', kind: null };

export const useContinuationLeaseStore = create<ContinuationLeaseState>(() => initialState);

/** Driver-only. */
export function publishContinuationLease(next: ContinuationLeaseState): void {
  const current = useContinuationLeaseStore.getState();
  if (current.phase === next.phase && current.tier === next.tier && current.kind === next.kind) {
    return;
  }
  useContinuationLeaseStore.setState(next);
}

export function resetContinuationLeaseStore(): void {
  useContinuationLeaseStore.setState(initialState);
}

/** True only while a continued-processing task is actually held for a job. */
export const selectLeaseKeepsRunning = (s: ContinuationLeaseState): boolean =>
  s.phase === 'running' && s.tier === 'continued';
