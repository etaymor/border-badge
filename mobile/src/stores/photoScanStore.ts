/**
 * photoScanStore - Scalar snapshot of the in-progress photo library scan.
 *
 * The store holds ONLY scalar/JSON-friendly state that subscribers read to render UI:
 * phase, progress, discoveredCountries, isIncremental, scanFailure, hasResult.
 *
 * The heavyweight result Maps (photoLookup, clusterLookup, clusterDisplays — 5–10MB
 * for large libraries) live on a module-level ref inside `photoScanService`. The
 * screen consumes them via `photoScanService.consumeResult()`.
 *
 * IMPORTANT: This store MUST NOT use `persist` middleware. It holds ephemeral session
 * state only. Persisting would silently round-trip Maps to `{}` if anyone ever extends
 * the store schema, and `phase` / `progress` are meaningless across launches anyway —
 * the actual durable scan state is `scan_in_progress` + `scan_started_at` in the
 * SQLite metadata table.
 */

import { create } from 'zustand';

import type { DiscoveredCountry, ScanProgress } from '@services/photoImport';

export type PhotoScanPhase = 'idle' | 'scanning' | 'completed' | 'failed';

export type PhotoScanFailureReason =
  | 'no-photos'
  | 'no-trips'
  | 'home-country'
  | 'scan-error'
  | 'stuck'
  | 'stale'
  | 'no-permission'
  | 'subscription-expired';

export interface PhotoScanFailure {
  reason: PhotoScanFailureReason;
  title: string;
  message: string;
}

export interface PhotoScanState {
  phase: PhotoScanPhase;
  progress: ScanProgress | null;
  discoveredCountries: DiscoveredCountry[];
  isIncremental: boolean;
  scanFailure: PhotoScanFailure | null;
  hasResult: boolean;
}

const initialState: PhotoScanState = {
  phase: 'idle',
  progress: null,
  discoveredCountries: [],
  isIncremental: false,
  scanFailure: null,
  hasResult: false,
};

/**
 * Internal-use store. The service is the only caller of `setState` for write paths.
 * Subscribers should use the selector hooks below.
 */
export const usePhotoScanStore = create<PhotoScanState>(() => initialState);

/**
 * Reset to initial state. Called by the service on cancel/idle transitions.
 */
export function resetPhotoScanStore(): void {
  usePhotoScanStore.setState(initialState, true);
}

// Selectors — narrow subscriptions reduce re-renders during high-frequency progress updates.
export const selectPhotoScanPhase = (s: PhotoScanState) => s.phase;
export const selectPhotoScanProgress = (s: PhotoScanState) => s.progress;
export const selectPhotoScanDiscoveredCountries = (s: PhotoScanState) => s.discoveredCountries;
export const selectPhotoScanIsIncremental = (s: PhotoScanState) => s.isIncremental;
export const selectPhotoScanFailure = (s: PhotoScanState) => s.scanFailure;
export const selectPhotoScanHasResult = (s: PhotoScanState) => s.hasResult;
