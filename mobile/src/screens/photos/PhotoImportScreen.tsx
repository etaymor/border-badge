/**
 * PhotoImportScreen - Single screen for photo-to-trip import workflow.
 *
 * Flow: idle → scanning → candidates → trip-selection → suggestions
 * Users can scan their photo library, see trip candidates by country,
 * select a trip, and confirm/reject place suggestions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { FlashList, ListRenderItem } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SatisfactionModal } from '@components/review';
import { Button, GlassBackButton, GlassIconButton } from '@components/ui';
import type {
  TripCandidateDisplay,
  ClusterSuggestion,
  LocationClusterDisplay,
} from '@services/photoImport';
import type { MergedSuggestion } from './photoImportTypes';
import { useCountryByCode } from '@hooks/useCountries';
import { useReviewRequest } from '@hooks/useReviewRequest';
import { useTrip } from '@hooks/useTrips';
import { colors } from '@constants/colors';
import { getFlagEmoji } from '@utils/flags';
import type { PassportStackScreenProps, RootStackParamList } from '@navigation/types';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ManualPlaceSearch,
  TripCandidateCard,
  PlaceSuggestionCard,
  PhotoClusterCard,
  PhotoTripSwitcherSheet,
} from './components';
import { usePhotoImportWorkflow } from './usePhotoImportWorkflow';
import { styles } from './photoImportStyles';

/** Display item that can be a merged suggestion, single suggestion, or photo-only cluster */
type ClusterDisplayItem =
  | { type: 'merged-suggestion'; data: MergedSuggestion }
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

/**
 * Create a MergedSuggestion from multiple clusters that share the same top place.
 */
function createMergedSuggestion(
  clusterIds: string[],
  clusterSuggestionMap: Map<
    string,
    { suggestion: ClusterSuggestion; cluster: LocationClusterDisplay }
  >,
  clusterDisplays: Map<string, LocationClusterDisplay>
): MergedSuggestion | null {
  const allPhotoIds: string[] = [];
  const allPreviewUris: string[] = [];
  let minStart: Date | null = null;
  let maxEnd: Date | null = null;

  for (const clusterId of clusterIds) {
    const cluster = clusterDisplays.get(clusterId);
    if (!cluster) continue;

    allPhotoIds.push(...cluster.photoIds);
    allPreviewUris.push(...cluster.previewUris);

    if (!minStart || cluster.timeRange.start < minStart) {
      minStart = cluster.timeRange.start;
    }
    if (!maxEnd || cluster.timeRange.end > maxEnd) {
      maxEnd = cluster.timeRange.end;
    }
  }

  const primaryEntry = clusterSuggestionMap.get(clusterIds[0]);
  if (!primaryEntry) {
    console.error('[PhotoImport] Primary cluster not found in suggestion map:', clusterIds[0]);
    return null;
  }

  return {
    primaryClusterId: clusterIds[0],
    clusterIds,
    photoIds: allPhotoIds,
    previewUris: allPreviewUris.slice(0, 5),
    photoCount: allPhotoIds.length,
    place: primaryEntry.suggestion.places[0],
    allPlaces: primaryEntry.suggestion.places,
    timeRange: {
      start: minStart!,
      end: maxEnd!,
    },
  };
}

/**
 * Convert a MergedSuggestion back to ClusterSuggestion format for PlaceSuggestionCard.
 */
function buildSuggestionFromMerged(merged: MergedSuggestion): ClusterSuggestion {
  return {
    cluster_id: merged.primaryClusterId,
    photo_ids: merged.photoIds,
    places: merged.allPlaces,
  };
}

export function PhotoImportScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {
    countryCode: filterCountryCode,
    tripId,
    autoStart,
    skipToSuggestions,
  } = route.params ?? {};
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);

  // Track if at least one place was confirmed this session for review trigger
  const hasConfirmedPlaceRef = useRef(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [pendingBackAction, setPendingBackAction] = useState<'candidates' | 'goBack' | null>(null);
  const {
    checkEligibility,
    startReviewFlow,
    handlePositiveResponse,
    handleNegativeResponse,
    handleDismiss,
  } = useReviewRequest();

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
    isPremium,
    canImportPhotos,
    startScan,
    cancelScan,
    selectCandidate,
    selectTrip,
    handleConfirmPlace,
    handleRejectPlace,
    handleHideCluster,
    handleHideMultipleClusters,
    handleAddEntryForCluster,
    handleManualSelect,
    handleCreateTrip,
    backToCandidates,
    switchCandidate,
    closeManualSearch,
    cancelUpload,
  } = usePhotoImportWorkflow({
    filterCountryCode,
    tripId,
    autoStart,
    skipToSuggestions,
  });

  // Wrap handleConfirmPlace to track when a place is confirmed for review trigger
  const handleConfirmPlaceWithTracking = useCallback(
    async (...args: Parameters<typeof handleConfirmPlace>) => {
      await handleConfirmPlace(...args);
      hasConfirmedPlaceRef.current = true;
    },
    [handleConfirmPlace]
  );

  // Handle back navigation with potential review trigger
  const handleBackNavigation = useCallback(
    (action: 'candidates' | 'goBack') => {
      // Only trigger review on first photo import if user confirmed at least one place
      if (hasConfirmedPlaceRef.current && checkEligibility('first_photo_import')) {
        if (startReviewFlow('first_photo_import')) {
          setPendingBackAction(action);
          setShowReviewModal(true);
          return;
        }
      }

      // Proceed with navigation
      if (action === 'candidates') {
        backToCandidates();
      } else {
        navigation.goBack();
      }
    },
    [checkEligibility, startReviewFlow, backToCandidates, navigation]
  );

  // Complete pending back navigation after review modal closes
  const completePendingNavigation = useCallback(() => {
    if (pendingBackAction === 'candidates') {
      backToCandidates();
    } else if (pendingBackAction === 'goBack') {
      navigation.goBack();
    }
    setPendingBackAction(null);
  }, [pendingBackAction, backToCandidates, navigation]);

  const handleReviewPositive = useCallback(async () => {
    setShowReviewModal(false);
    await handlePositiveResponse('first_photo_import');
    completePendingNavigation();
  }, [handlePositiveResponse, completePendingNavigation]);

  const handleReviewNegative = useCallback(() => {
    setShowReviewModal(false);
    handleNegativeResponse('first_photo_import');
    completePendingNavigation();
  }, [handleNegativeResponse, completePendingNavigation]);

  const handleReviewDismiss = useCallback(() => {
    setShowReviewModal(false);
    handleDismiss('first_photo_import');
    completePendingNavigation();
  }, [handleDismiss, completePendingNavigation]);

  // Get country name for display in suggestions header
  const { data: selectedCountry } = useCountryByCode(selectedCandidate?.countryCode);
  const selectedCountryName = selectedCountry?.name ?? selectedCandidate?.countryCode ?? '';

  // Get trip name for display in suggestions header
  const { data: selectedTripData } = useTrip(selectedTripId ?? '');
  const selectedTripName = selectedTripData?.name ?? '';

  // Track selected trip ID for auto-proceed on subsequent candidate selections
  const [rememberedTripId, setRememberedTripId] = useState<string | null>(tripId ?? null);

  // Photo trip switcher state
  const [showTripSwitcher, setShowTripSwitcher] = useState(false);

  // Filter candidates to only those matching the selected country (for switching)
  const candidatesForCountry = useMemo(() => {
    if (!selectedCandidate) return [];
    return tripCandidates.filter((c) => c.countryCode === selectedCandidate.countryCode);
  }, [tripCandidates, selectedCandidate]);

  // Handle switching to a different photo trip
  const handleSwitchCandidate = useCallback(
    async (candidate: TripCandidateDisplay) => {
      setShowTripSwitcher(false);
      await switchCandidate(candidate);
    },
    [switchCandidate]
  );

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
      ? (suggestionsPartialResults ?? [])
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
  // Clusters with the same top place are merged into a single card
  const clusterItems: ClusterDisplayItem[] = useMemo(() => {
    if (!selectedCandidate) return [];

    // Phase 1: Group clusters by their top place's place_id
    const placeIdToClusterIds = new Map<string, string[]>();
    const clusterSuggestionMap = new Map<
      string,
      { suggestion: ClusterSuggestion; cluster: LocationClusterDisplay }
    >();
    const photosOnlyClusters: LocationClusterDisplay[] = [];

    for (const clusterId of selectedCandidate.locationClusterIds) {
      if (dismissedClusterIdsInternal.has(clusterId)) continue;

      const cluster = clusterDisplays.get(clusterId);
      if (!cluster) continue;

      const suggestion = suggestionsMap.get(clusterId);
      if (suggestion && suggestion.places.length > 0) {
        const topPlaceId = suggestion.places[0].place_id;

        // Track this cluster for the place_id
        if (!placeIdToClusterIds.has(topPlaceId)) {
          placeIdToClusterIds.set(topPlaceId, []);
        }
        placeIdToClusterIds.get(topPlaceId)!.push(clusterId);
        clusterSuggestionMap.set(clusterId, { suggestion, cluster });
      } else {
        photosOnlyClusters.push(cluster);
      }
    }

    // Phase 2: Build display items, merging clusters with same top place
    const items: ClusterDisplayItem[] = [];
    const processedPlaceIds = new Set<string>();

    // Process in order of original cluster sequence for consistent ordering
    for (const clusterId of selectedCandidate.locationClusterIds) {
      if (dismissedClusterIdsInternal.has(clusterId)) continue;

      const entry = clusterSuggestionMap.get(clusterId);
      if (!entry) continue; // Will be handled in photos-only pass

      const topPlaceId = entry.suggestion.places[0].place_id;
      if (processedPlaceIds.has(topPlaceId)) continue;
      processedPlaceIds.add(topPlaceId);

      const clusterIdsForPlace = placeIdToClusterIds.get(topPlaceId)!;

      if (clusterIdsForPlace.length === 1) {
        // Single cluster - use original format
        items.push({ type: 'suggestion', data: entry.suggestion, cluster: entry.cluster });
      } else {
        // Multiple clusters - create merged suggestion
        const mergedSuggestion = createMergedSuggestion(
          clusterIdsForPlace,
          clusterSuggestionMap,
          clusterDisplays
        );
        if (mergedSuggestion) {
          items.push({ type: 'merged-suggestion', data: mergedSuggestion });
        }
      }
    }

    // Add photos-only clusters at the end
    for (const cluster of photosOnlyClusters) {
      items.push({ type: 'photos-only', cluster });
    }

    return items;
  }, [selectedCandidate, suggestionsMap, clusterDisplays, dismissedClusterIdsInternal]);

  const renderClusterItem: ListRenderItem<ClusterDisplayItem> = useCallback(
    ({ item }) => {
      if (item.type === 'merged-suggestion') {
        // Merged suggestion - multiple clusters resolved to the same place
        const merged = item.data;
        const isUploadingAny = merged.clusterIds.some((id) => uploadingClusterIds.has(id));
        const primaryUploadState = getUploadState(merged.primaryClusterId);

        // Get additional cluster IDs (all except primary) for marking as processed
        const additionalClusterIds = merged.clusterIds.filter(
          (id) => id !== merged.primaryClusterId
        );

        return (
          <PlaceSuggestionCard
            suggestion={buildSuggestionFromMerged(merged)}
            previewUris={merged.previewUris}
            onConfirm={(suggestion, place) =>
              handleConfirmPlaceWithTracking(suggestion, place, false, additionalClusterIds)
            }
            onReject={handleRejectPlace}
            onPhotoPress={setPreviewPhoto}
            onDismiss={() => handleHideMultipleClusters(merged.clusterIds)}
            isUploading={isUploadingAny}
            uploadProgress={primaryUploadState?.overallProgress ?? 0}
            uploadingPhotoIndex={primaryUploadState?.currentPhotoIndex ?? 0}
            totalPhotosToUpload={primaryUploadState?.totalPhotos ?? 0}
            onCancelUpload={() => cancelUpload(merged.primaryClusterId)}
          />
        );
      }

      if (item.type === 'suggestion') {
        const clusterId = item.data.cluster_id;
        const isUploadingThisCluster = uploadingClusterIds.has(clusterId);
        const clusterUploadState = getUploadState(clusterId);

        return (
          <PlaceSuggestionCard
            suggestion={item.data}
            previewUris={item.cluster.previewUris}
            onConfirm={handleConfirmPlaceWithTracking}
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

      // photos-only type
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
      handleConfirmPlaceWithTracking,
      handleRejectPlace,
      handleAddEntryForCluster,
      handleHideCluster,
      handleHideMultipleClusters,
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
              handleBackNavigation('candidates');
            } else {
              handleBackNavigation('goBack');
            }
          }}
        />
        <Text style={styles.headerTitle}>
          {phase === 'suggestions' || skipToSuggestions ? 'Trip Suggestions' : 'We Found Trips'}
        </Text>
        {/* Show swap button only if multiple photo trips exist for this country */}
        {phase === 'suggestions' && candidatesForCountry.length > 1 ? (
          <GlassIconButton
            icon="swap-horizontal-outline"
            onPress={() => setShowTripSwitcher(true)}
            accessibilityLabel="Switch photo trip"
          />
        ) : (
          <View style={styles.headerSpacer} />
        )}
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

          {/* Premium gating banner - show when user has used their free import */}
          {!isPremium && !canImportPhotos && (
            <View style={styles.premiumGateBanner}>
              <Text style={styles.premiumGateTitle}>Free Limit Reached</Text>
              <Text style={styles.premiumGateText}>
                {"You've already imported one trip from photos. Upgrade to import unlimited trips."}
              </Text>
              <Button
                title="Upgrade to Premium"
                onPress={() => rootNavigation.navigate('PaywallModal', { feature: 'photoImport' })}
                style={styles.premiumGateButton}
              />
            </View>
          )}

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
              item.type === 'merged-suggestion'
                ? item.data.primaryClusterId
                : item.type === 'suggestion'
                  ? item.data.cluster_id
                  : item.cluster.id
            }
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

      {/* Photo Trip Switcher Sheet */}
      <PhotoTripSwitcherSheet
        visible={showTripSwitcher}
        candidates={candidatesForCountry}
        selectedCandidate={selectedCandidate}
        onSelectCandidate={handleSwitchCandidate}
        onClose={() => setShowTripSwitcher(false)}
      />

      {/* Review Satisfaction Modal */}
      <SatisfactionModal
        visible={showReviewModal}
        onPositive={handleReviewPositive}
        onNegative={handleReviewNegative}
        onDismiss={handleReviewDismiss}
      />
    </View>
  );
}
