/**
 * PhotoImportScreen - Single screen for photo-to-trip import workflow.
 *
 * Flow: idle → scanning → candidates → trip-selection → suggestions
 * Users can scan their photo library, see trip candidates by country,
 * select a trip, and confirm/reject place suggestions.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { FlashList, ListRenderItem } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, GlassBackButton } from '@components/ui';
import type {
  TripCandidateDisplay,
  ClusterSuggestion,
  LocationClusterDisplay,
} from '@services/photoImport';
import { useCountryByCode } from '@hooks/useCountries';
import { useTrip } from '@hooks/useTrips';
import { colors } from '@constants/colors';
import { getFlagEmoji } from '@utils/flags';
import type { PassportStackScreenProps } from '@navigation/types';
import {
  ManualPlaceSearch,
  TripCandidateCard,
  PlaceSuggestionCard,
  PhotoClusterCard,
} from './components';
import { usePhotoImportWorkflow } from './usePhotoImportWorkflow';
import { styles } from './photoImportStyles';

/** Display item that can be either a cluster with suggestions or a photo-only cluster */
type ClusterDisplayItem =
  | { type: 'suggestion'; data: ClusterSuggestion; cluster: LocationClusterDisplay }
  | { type: 'photos-only'; cluster: LocationClusterDisplay };

type Props = PassportStackScreenProps<'PhotoImport'>;

/**
 * Format date range for display
 */
const formatDateRange = (start: Date, end: Date) => {
  const startStr = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const endStr = end.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${startStr} - ${endStr}`;
};

/**
 * Format relative time for last scan (e.g., "2 hours ago", "Yesterday")
 */
const formatLastScanTime = (timestamp: number): string => {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min${diffMins !== 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return new Date(timestamp).toLocaleDateString();
};

export function PhotoImportScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const {
    countryCode: filterCountryCode,
    tripId,
    autoStart,
    skipToSuggestions,
  } = route.params ?? {};
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);

  // Reset error state when preview photo changes
  useEffect(() => {
    if (previewPhoto) {
      setPreviewError(false);
    }
  }, [previewPhoto]);

  const {
    phase,
    scanProgress,
    tripCandidates,
    selectedCandidate,
    selectedTripId,
    clusterDisplays,
    manualSearchCluster,
    suggestPlacesMutation,
    cachedSuggestions,
    lastImportTime,
    isIncremental,
    isSaving,
    dismissedClusterIdsInternal,
    getUploadState,
    uploadingClusterIds,
    startScan,
    cancelScan,
    selectCandidate,
    selectTrip,
    handleConfirmPlace,
    handleRejectPlace,
    handleHideCluster,
    handleAddEntryForCluster,
    handleManualSelect,
    handleCreateTrip,
    backToCandidates,
    closeManualSearch,
    cancelUpload,
  } = usePhotoImportWorkflow({
    filterCountryCode,
    tripId,
    autoStart,
    skipToSuggestions,
  });

  // Get country name for display in suggestions header
  const { data: selectedCountry } = useCountryByCode(selectedCandidate?.countryCode);
  const selectedCountryName = selectedCountry?.name ?? selectedCandidate?.countryCode ?? '';

  // Get trip name for display in suggestions header
  const { data: selectedTripData } = useTrip(selectedTripId ?? '');
  const selectedTripName = selectedTripData?.name ?? '';

  // Track selected trip ID for auto-proceed on subsequent candidate selections
  const [rememberedTripId, setRememberedTripId] = useState<string | null>(tripId ?? null);

  // Handle trip selection from candidate card (either first time or auto-proceed)
  const handleSelectTripForCandidate = useCallback(
    async (candidate: TripCandidateDisplay, tripIdToUse: string) => {
      // Remember this trip for future selections
      setRememberedTripId(tripIdToUse);
      // Set the candidate and trip, then proceed to suggestions
      // Pass candidate directly to selectTrip to avoid stale closure issue
      selectCandidate(candidate);
      await selectTrip(tripIdToUse, candidate);
    },
    [selectCandidate, selectTrip]
  );

  const renderCandidateItem: ListRenderItem<TripCandidateDisplay> = useCallback(
    ({ item }) => (
      <TripCandidateCard
        candidate={item}
        onSelectTrip={handleSelectTripForCandidate}
        onCreateTrip={handleCreateTrip}
        selectedTripId={rememberedTripId}
        isLoadingSuggestions={suggestPlacesMutation.isPending}
      />
    ),
    [
      handleSelectTripForCandidate,
      handleCreateTrip,
      rememberedTripId,
      suggestPlacesMutation.isPending,
    ]
  );

  // Extract stable values from mutation to avoid re-renders when mutation object reference changes
  const suggestionsIsPending = suggestPlacesMutation.isPending;
  const suggestionsPartialResults = suggestPlacesMutation.partialResults;
  const suggestionsData = suggestPlacesMutation.data;

  // Memoize the merged suggestions Map separately to avoid rebuilding on every clusterItems recomputation
  // This Map only needs to rebuild when the suggestion sources change, not when dismissedClusterIds changes
  const suggestionsMap = useMemo(() => {
    const map = new Map<string, ClusterSuggestion>();

    // Get API results (partial during loading, full when done)
    const apiSuggestions = suggestionsIsPending
      ? suggestionsPartialResults
      : (suggestionsData?.suggestions ?? []);

    // Add cached suggestions first (takes precedence for deduplication)
    for (const suggestion of cachedSuggestions) {
      map.set(suggestion.cluster_id, suggestion);
    }

    // Add API suggestions (won't overwrite cached ones)
    for (const suggestion of apiSuggestions) {
      if (!map.has(suggestion.cluster_id)) {
        map.set(suggestion.cluster_id, suggestion);
      }
    }

    return map;
  }, [suggestionsIsPending, suggestionsPartialResults, suggestionsData, cachedSuggestions]);

  // Build combined list of all clusters for the selected candidate
  // Clusters with suggestions get PlaceSuggestionCard, others get PhotoClusterCard
  const clusterItems: ClusterDisplayItem[] = useMemo(() => {
    if (!selectedCandidate) return [];

    // Build items for all clusters in the candidate (excluding dismissed/processed ones)
    const items: ClusterDisplayItem[] = [];
    for (const clusterId of selectedCandidate.locationClusterIds) {
      // Skip clusters that have been confirmed or hidden (persisted in SQLite)
      if (dismissedClusterIdsInternal.has(clusterId)) continue;

      const cluster = clusterDisplays.get(clusterId);
      if (!cluster) continue;

      const suggestion = suggestionsMap.get(clusterId);
      // Only show as suggestion card if there are actual places to suggest
      // Empty places array (no quality matches) should show as photo-only card
      if (suggestion && suggestion.places.length > 0) {
        items.push({ type: 'suggestion', data: suggestion, cluster });
      } else {
        items.push({ type: 'photos-only', cluster });
      }
    }

    return items;
  }, [selectedCandidate, suggestionsMap, clusterDisplays, dismissedClusterIdsInternal]);

  const renderClusterItem: ListRenderItem<ClusterDisplayItem> = useCallback(
    ({ item }) => {
      const clusterId = item.type === 'suggestion' ? item.data.cluster_id : item.cluster.id;
      const isUploadingThisCluster = uploadingClusterIds.has(clusterId);
      const clusterUploadState = getUploadState(clusterId);

      if (item.type === 'suggestion') {
        return (
          <PlaceSuggestionCard
            suggestion={item.data}
            previewUris={item.cluster.previewUris}
            onConfirm={handleConfirmPlace}
            onReject={handleRejectPlace}
            onPhotoPress={setPreviewPhoto}
            onDismiss={handleHideCluster}
            isUploading={isUploadingThisCluster}
            uploadProgress={clusterUploadState?.overallProgress ?? 0}
            uploadingPhotoIndex={clusterUploadState?.currentPhotoIndex ?? 0}
            totalPhotosToUpload={clusterUploadState?.totalPhotos ?? 0}
            onCancelUpload={() => cancelUpload(clusterId)}
          />
        );
      }
      return (
        <PhotoClusterCard
          cluster={item.cluster}
          onAddEntry={(cluster) => handleAddEntryForCluster(cluster.id)}
          onPhotoPress={setPreviewPhoto}
          onDismiss={handleHideCluster}
        />
      );
    },
    [
      handleConfirmPlace,
      handleRejectPlace,
      handleAddEntryForCluster,
      handleHideCluster,
      uploadingClusterIds,
      getUploadState,
      cancelUpload,
    ]
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <GlassBackButton
          onPress={() => {
            if (phase === 'suggestions' && !skipToSuggestions) {
              // Only go back to candidates if we didn't skip directly to suggestions
              backToCandidates();
            } else {
              navigation.goBack();
            }
          }}
        />
        <Text style={styles.headerTitle}>
          {phase === 'suggestions' || skipToSuggestions ? 'Trip Suggestions' : 'We Found Trips'}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Loading State - shown when skipping directly to suggestions */}
      {phase === 'loading' && (
        <View style={styles.idleContainer}>
          <ActivityIndicator size="large" color={colors.sunsetGold} />
          <Text style={styles.idleTitle}>Loading suggestions...</Text>
        </View>
      )}

      {/* Idle State */}
      {phase === 'idle' && (
        <View style={styles.idleContainer}>
          {autoStart && lastImportTime ? (
            // Brief loading state while auto-start is initializing
            <>
              <ActivityIndicator size="large" color={colors.sunsetGold} />
              <Text style={styles.idleTitle}>Preparing...</Text>
              <Text style={styles.idleDescription}>Checking for new photos...</Text>
            </>
          ) : (
            // Normal idle state for manual start
            <>
              <Ionicons name="images-outline" size={64} color={colors.sunsetGold} />
              <Text style={styles.idleTitle}>Import Travel Photos</Text>
              <Text style={styles.idleDescription}>
                {lastImportTime
                  ? 'Check for new photos since your last scan, or refresh to re-scan your entire library.'
                  : 'Scan your photo library to find travel photos and create entries automatically based on where they were taken.'}
              </Text>
              {lastImportTime && (
                <Text style={styles.lastScanText}>
                  Last scanned: {formatLastScanTime(lastImportTime)}
                </Text>
              )}
              <Button
                title={lastImportTime ? 'Check for New Photos' : 'Start Scan'}
                onPress={() => startScan(false)}
                style={styles.scanButton}
              />
              {lastImportTime && (
                <TouchableOpacity onPress={() => startScan(true)} style={styles.refreshLink}>
                  <Ionicons name="refresh-outline" size={16} color={colors.sunsetGold} />
                  <Text style={styles.refreshLinkText}>Refresh All Photos</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      )}

      {/* Scanning State */}
      {phase === 'scanning' && (
        <>
          <View style={styles.scanningContainer}>
            <ActivityIndicator size="large" color={colors.sunsetGold} />
            <Text style={styles.scanningTitle}>
              {scanProgress?.phase === 'geocoding'
                ? 'Identifying Countries...'
                : isIncremental
                  ? 'Checking for New Photos...'
                  : 'Scanning Photos...'}
            </Text>
            <Text style={styles.scanningProgress}>
              {scanProgress?.current ?? 0} / {scanProgress?.total ?? 0}
              {scanProgress?.phase === 'scanning' &&
                scanProgress?.gpsPhotoCount !== undefined &&
                ` (${scanProgress.gpsPhotoCount} with GPS)`}
            </Text>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${scanProgress?.percentage ?? 0}%` }]} />
            </View>
            <TouchableOpacity onPress={cancelScan} style={styles.cancelButton}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
          {/* Large library warning */}
          {scanProgress?.gpsPhotoCount !== undefined && scanProgress.gpsPhotoCount > 5000 && (
            <View style={styles.warningBannerScanning}>
              <Ionicons name="information-circle-outline" size={20} color={colors.sunsetGold} />
              <Text style={styles.warningText}>
                Large photo library detected ({scanProgress.gpsPhotoCount.toLocaleString()} photos).
                For best performance, filter by country after scanning.
              </Text>
            </View>
          )}
        </>
      )}

      {/* Candidates List */}
      {phase === 'candidates' && (
        <View style={styles.listContainer}>
          <FlashList
            data={tripCandidates}
            renderItem={renderCandidateItem}
            contentContainerStyle={styles.listContent}
            keyExtractor={(item) => item.id}
            estimatedItemSize={120}
          />
        </View>
      )}

      {/* Suggestions List */}
      {phase === 'suggestions' && selectedCandidate && (
        <View style={styles.listContainer}>
          {/* Trip info header */}
          {selectedTripName && <Text style={styles.tripName}>{selectedTripName}</Text>}
          <Text style={styles.tripMeta}>
            {getFlagEmoji(selectedCandidate.countryCode)} {selectedCountryName}
          </Text>
          <Text style={styles.tripDates}>
            {formatDateRange(selectedCandidate.dateRange.start, selectedCandidate.dateRange.end)}
          </Text>

          {/* Progress indicator during loading */}
          {suggestPlacesMutation.isPending && suggestPlacesMutation.progress && (
            <View style={styles.progressHeader}>
              <View style={styles.progressLabelRow}>
                <ActivityIndicator size="small" color={colors.sunsetGold} />
                <Text style={styles.progressLabel}>
                  Processing {suggestPlacesMutation.progress.clustersCompleted} of{' '}
                  {suggestPlacesMutation.progress.clustersTotal} locations
                </Text>
              </View>
              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${suggestPlacesMutation.progress.percentage}%` },
                  ]}
                />
              </View>
            </View>
          )}

          {/* Show all clusters - those with suggestions use PlaceSuggestionCard, others use PhotoClusterCard */}
          <FlashList
            data={clusterItems}
            renderItem={renderClusterItem}
            contentContainerStyle={styles.listContent}
            keyExtractor={(item) =>
              item.type === 'suggestion' ? item.data.cluster_id : item.cluster.id
            }
            estimatedItemSize={200}
            getItemType={(item) => item.type}
            ListEmptyComponent={
              suggestPlacesMutation.isPending ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={colors.sunsetGold} />
                  <Text style={styles.loadingText}>Finding nearby places...</Text>
                </View>
              ) : null
            }
          />
        </View>
      )}

      {/* Photo Preview Overlay */}
      {previewPhoto && (
        <Modal
          transparent
          animationType="fade"
          visible
          onRequestClose={() => setPreviewPhoto(null)}
        >
          <Pressable style={styles.overlayBackground} onPress={() => setPreviewPhoto(null)}>
            <TouchableOpacity style={styles.closeButton} onPress={() => setPreviewPhoto(null)}>
              <Ionicons name="close" size={28} color={colors.white} />
            </TouchableOpacity>
            {previewError ? (
              <View style={styles.previewLoadingContainer}>
                <Ionicons name="image-outline" size={48} color={colors.stormGray} />
                <Text style={styles.previewLoadingText}>Unable to load photo</Text>
              </View>
            ) : (
              <Image
                source={{ uri: previewPhoto }}
                style={styles.fullPreview}
                contentFit="contain"
                onError={() => setPreviewError(true)}
              />
            )}
          </Pressable>
        </Modal>
      )}

      {/* Manual Place Search Modal */}
      {manualSearchCluster && (
        <ManualPlaceSearch
          cluster={manualSearchCluster}
          countryCode={selectedCandidate?.countryCode}
          preSelectedTripId={selectedTripId ?? tripId}
          onSelect={handleManualSelect}
          onCreateTrip={handleCreateTrip}
          onCancel={closeManualSearch}
          isSaving={isSaving}
          isUploading={uploadingClusterIds.has(manualSearchCluster.id)}
          uploadProgress={getUploadState(manualSearchCluster.id)?.overallProgress ?? 0}
          uploadingPhotoIndex={getUploadState(manualSearchCluster.id)?.currentPhotoIndex ?? 0}
          totalPhotosToUpload={getUploadState(manualSearchCluster.id)?.totalPhotos ?? 0}
          onCancelUpload={() => cancelUpload(manualSearchCluster.id)}
        />
      )}
    </View>
  );
}
