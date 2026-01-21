/**
 * Type definitions for the photo import workflow.
 */

import type { SelectedPlace } from '@components/places';
import type { ClusterUploadState } from '@hooks/useClusterPhotoUpload';
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

export type ImportPhase = 'idle' | 'scanning' | 'candidates' | 'trip-selection' | 'suggestions';

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
  /** Timestamp of last successful import, null if never imported */
  lastImportTime: number | null;
  /** Whether we're doing an incremental scan (has cache) or full scan */
  isIncremental: boolean;
  /** Cluster IDs that have been dismissed/processed (confirmed entries) */
  dismissedClusterIdsInternal: Set<string>;

  /** Photo upload state for progress UI */
  uploadState: ClusterUploadState;
  /** Cluster ID currently being uploaded (for UI state) */
  uploadingClusterId: string | null;
  /** Cancel current photo upload */
  cancelUpload: () => void;

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
}
