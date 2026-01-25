/**
 * Type definitions for the photo import workflow.
 */

import type { SelectedPlace } from '@components/places';
import type { ClusterUploadState } from '@hooks/useMultiClusterUpload';
import type { useSuggestPlacesChunked } from '@hooks/usePhotoImport';
import type {
  ScanProgress,
  TripCandidateDisplay,
  LocationCluster,
  LocationClusterDisplay,
  ClusterSuggestion,
  PlaceSuggestion,
} from '@services/photoImport';
import type { EntryType } from '@navigation/types';

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
  suggestPlacesMutation: ReturnType<typeof useSuggestPlacesChunked>;
  /** Suggestions loaded from SQLite cache (merged with API results in UI) */
  cachedSuggestions: ClusterSuggestion[];
  /** Timestamp of last successful import, null if never imported */
  lastImportTime: number | null;
  /** Whether we're doing an incremental scan (has cache) or full scan */
  isIncremental: boolean;
  /** Cluster IDs that have been dismissed/processed (confirmed entries) */
  dismissedClusterIdsInternal: Set<string>;

  /** Photo upload states for all active uploads, keyed by cluster ID */
  uploadStates: Map<string, ClusterUploadState>;
  /** Get upload state for a specific cluster */
  getUploadState: (clusterId: string) => ClusterUploadState | null;
  /** Cluster IDs currently being uploaded (for UI state) */
  uploadingClusterIds: Set<string>;
  /** Cancel upload for a specific cluster */
  cancelUpload: (clusterId: string) => void;

  // Actions
  startScan: (forceRefresh?: boolean) => Promise<void>;
  cancelScan: () => void;
  selectCandidate: (candidate: TripCandidateDisplay) => void;
  selectTrip: (tripId: string, candidate?: TripCandidateDisplay) => Promise<void>;
  handleConfirmPlace: (suggestion: ClusterSuggestion, place: PlaceSuggestion) => Promise<void>;
  handleRejectPlace: (suggestion: ClusterSuggestion) => void;
  handleHideCluster: (clusterId: string) => Promise<void>;
  handleAddEntryForCluster: (clusterId: string) => void;
  handleManualSelect: (
    place: SelectedPlace,
    category: EntryType,
    tripId: string,
    notes?: string
  ) => Promise<string | undefined>;
  handleCreateTrip: (name: string, countryCode: string) => Promise<string>;
  backToCandidates: () => void;
  backToTripSelection: () => void;
  closeManualSearch: () => void;
  isSaving: boolean;
}

export interface UsePhotoImportWorkflowOptions {
  filterCountryCode?: string;
  tripId?: string; // Pre-associated trip ID
  autoStart?: boolean; // Auto-start scan when cache exists
  skipToSuggestions?: boolean; // Skip scanning and go directly to candidates when cache exists
}
