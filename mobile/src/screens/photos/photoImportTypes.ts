/**
 * Type definitions for the photo import workflow.
 */

import type { SelectedPlace } from '@components/places';
import type { ClusterUploadState } from '@hooks/useMultiClusterUpload';
import type { SuggestionDispatchState } from '@hooks/usePhotoImport';
import type {
  ScanProgress,
  TripCandidateDisplay,
  LocationCluster,
  LocationClusterDisplay,
  ClusterSuggestion,
  PlaceSuggestion,
} from '@services/photoImport';
import type { EntryType } from '@navigation/types';
import type { ScanFailureReason } from './usePhotoScan';
import type { SuggestionDecisionMeta } from './components/PlaceSuggestionCard';

/**
 * Represents multiple clusters that resolved to the same place (by place_id).
 * Used to consolidate duplicate suggestions in the UI.
 */
export interface MergedSuggestion {
  /** First cluster found with this place (used as primary for entry creation) */
  primaryClusterId: string;
  /** All cluster IDs that resolved to this place */
  clusterIds: string[];
  /** Combined photo IDs from all clusters */
  photoIds: string[];
  /** Combined preview URIs from all clusters (first 5) */
  previewUris: string[];
  /** Asset IDs positionally aligned with previewUris (for on-error re-resolve) */
  previewAssetIds: string[];
  /** Total photo count across all clusters */
  photoCount: number;
  /** The shared top place suggestion */
  place: PlaceSuggestion;
  /** All places from primary cluster (for alternatives if needed) */
  allPlaces: PlaceSuggestion[];
  /** Time range spanning all clusters */
  timeRange: { start: Date; end: Date };
}

export type ImportPhase =
  | 'idle'
  | 'loading'
  | 'scanning'
  | 'candidates'
  | 'trip-selection'
  | 'suggestions';

export interface PhotoImportWorkflowResult {
  // State
  phase: ImportPhase;
  scanProgress: ScanProgress | null;
  tripCandidates: TripCandidateDisplay[];
  selectedCandidate: TripCandidateDisplay | null;
  selectedTripId: string | null;
  clusterDisplays: Map<string, LocationClusterDisplay>;
  manualSearchCluster: LocationCluster | null;
  /**
   * Live snapshot of the `suggestionDispatch` controller (U14): dispatch
   * progress, partial and final results, failure attribution, and the enqueued
   * / in-flight / dispatched-and-resolved cluster sets.
   */
  suggestionDispatch: SuggestionDispatchState;
  /** Suggestions loaded from SQLite cache (merged with API results in UI) */
  cachedSuggestions: ClusterSuggestion[];
  /** Timestamp of last successful import, null if never imported */
  lastImportTime: number | null;
  /** Whether we're doing an incremental scan (has cache) or full scan */
  isIncremental: boolean;
  /** Cluster IDs that have been dismissed/processed (confirmed entries) */
  dismissedClusterIdsInternal: Set<string>;
  /** Set when scan completes with no usable results (no photos or no trips) */
  scanFailure: { reason: ScanFailureReason; title: string; message: string } | null;
  /** Clear the scan failure after showing alert */
  clearScanFailure: () => void;

  /**
   * True while ANY dispatch owner has an unsettled suggestion fetch (R1/KTD13):
   * auto-start, selectTrip, switchCandidate, the fetch itself, or a manual
   * split. Covers each owner's whole duration — SQLite cache check and vision
   * prep included — and reports settled only once EVERY owner has settled.
   */
  fetchingSuggestions: boolean;

  /**
   * Cluster IDs currently being retried (U10). Drives the per-cluster spinner on
   * the lookup-failed card. NOT the global `fetchingSuggestions` flag — retry
   * must not re-hide healthy photos-only / no-place-found cards (KTD7 / C4).
   */
  retryingClusterIds: Set<string>;

  /**
   * Number of clusters a U9 bulk retry is currently rebuilding vision payloads
   * for, or 0. Released payloads have to be re-encoded and preparation is
   * serial at the native layer, so a large bulk retry spends real time before
   * its first request leaves — the status row names that wait.
   */
  bulkRetryPreparingCount: number;

  /** Photo upload states for all active uploads, keyed by cluster ID */
  uploadStates: Map<string, ClusterUploadState>;
  /** Get upload state for a specific cluster */
  getUploadState: (clusterId: string) => ClusterUploadState | null;
  /** Cluster IDs currently being uploaded (for UI state) */
  uploadingClusterIds: Set<string>;
  /** Cancel upload for a specific cluster */
  cancelUpload: (clusterId: string) => void;

  // Premium gating
  /** Whether user has premium access (subscribed or trialing) */
  isPremium: boolean;
  /** Whether user can import photos (premium or has remaining free imports) */
  canImportPhotos: boolean;

  // Actions
  startScan: (forceRefresh?: boolean) => Promise<void>;
  cancelScan: () => void;
  selectCandidate: (candidate: TripCandidateDisplay) => void;
  selectTrip: (tripId: string, candidate?: TripCandidateDisplay) => Promise<void>;
  handleConfirmPlace: (
    suggestion: ClusterSuggestion,
    place: PlaceSuggestion,
    meta: SuggestionDecisionMeta,
    wasFromCache?: boolean,
    additionalClusterIds?: string[],
    excludedPhotos?: Set<string>
  ) => Promise<void>;
  handleRejectPlace: (suggestion: ClusterSuggestion, meta: SuggestionDecisionMeta) => void;
  handleHideCluster: (clusterId: string) => Promise<void>;
  handleHideMultipleClusters: (clusterIds: string[]) => Promise<void>;
  handleSplitCluster: (
    clusterId: string,
    groupAPhotoIds: string[],
    groupBPhotoIds: string[]
  ) => Promise<void>;
  handleAddEntryForCluster: (clusterId: string) => void;
  /** Retry the place lookup for an explicit list of failed cluster ids (U10). */
  retryFailedClusters: (clusterIds: string[]) => Promise<void>;
  /**
   * Retry every retry-eligible failed cluster in one action (U9/R15). Runs
   * through the controller's bounded pool and takes a dispatch owner slot,
   * unlike the per-cluster `retryFailedClusters`.
   */
  retryAllFailedClusters: (clusterIds: string[]) => Promise<void>;
  handleManualSelect: (
    place: SelectedPlace,
    category: EntryType,
    tripId: string,
    notes?: string,
    excludedPhotos?: Set<string>
  ) => Promise<string | undefined>;
  handleCreateTrip: (name: string, countryCode: string) => Promise<string>;
  backToCandidates: () => void;
  backToTripSelection: () => void;
  /** Switch to a different photo trip candidate (for same country) */
  switchCandidate: (candidate: TripCandidateDisplay) => Promise<void>;
  closeManualSearch: () => void;
  isSaving: boolean;
}

export interface UsePhotoImportWorkflowOptions {
  filterCountryCode?: string;
  tripId?: string; // Pre-associated trip ID
  autoStart?: boolean; // Auto-start scan when cache exists
  skipToSuggestions?: boolean; // Skip scanning and go directly to candidates when cache exists
}
