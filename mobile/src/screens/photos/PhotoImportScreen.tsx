/**
 * PhotoImportScreen - Single screen for photo-to-trip import workflow.
 *
 * Flow: idle → scanning → candidates → trip-selection → suggestions
 * Users can scan their photo library, see trip candidates by country,
 * select a trip, and confirm/reject place suggestions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
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
  PhotoTripCard,
  PlaceSuggestionCard,
  PhotoClusterCard,
  PhotoTripSwitcherSheet,
  PhotoGalleryModal,
} from './components';
import { useOnboardingStore, selectHomeCountry } from '@stores/onboardingStore';
import { usePhotoImportWorkflow } from './usePhotoImportWorkflow';
import { useScanLifecycle } from './useScanLifecycle';
import { styles } from './photoImportStyles';
import type { ClusterDisplayItem } from './photoImportHelpers';
import {
  formatDateRange,
  formatLastScanTime,
  createMergedSuggestion,
  buildSuggestionFromMerged,
} from './photoImportHelpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const polaroidsIllustration = require('../../../assets/illustations/polaroids-illustration.png');

type Props = PassportStackScreenProps<'PhotoImport'>;

export function PhotoImportScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {
    countryCode: filterCountryCode,
    tripId,
    autoStart,
    skipToSuggestions,
  } = route.params ?? {};

  // Home country for privacy notice
  const homeCountryCode = useOnboardingStore(selectHomeCountry);
  const { data: homeCountryData } = useCountryByCode(homeCountryCode);

  // Gallery state with cluster context and photo IDs for selection
  const [previewGallery, setPreviewGallery] = useState<{
    clusterId: string;
    photos: { id: string; uri: string }[];
    initialIndex: number;
  } | null>(null);

  // Current index in the gallery (for counter)
  const [currentGalleryIndex, setCurrentGalleryIndex] = useState(0);

  // Track excluded (deselected) photos per cluster
  const [excludedPhotoIds, setExcludedPhotoIds] = useState<Map<string, Set<string>>>(new Map());

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

  // Reset gallery index when gallery opens
  useEffect(() => {
    if (previewGallery) {
      setCurrentGalleryIndex(previewGallery.initialIndex);
    }
  }, [previewGallery]);

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
    fetchingSuggestions,
    lastImportTime,
    isIncremental,
    isSaving,
    dismissedClusterIdsInternal,
    scanFailure,
    clearScanFailure,
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
    handleSplitCluster,
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

  const { handleCancelScan } = useScanLifecycle({
    phase,
    cancelScan,
    scanFailure,
    clearScanFailure,
    autoStart,
    navigation,
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
    ({ item, index }) => (
      <PhotoTripCard
        candidate={item}
        onSelectTrip={handleSelectTripForCandidate}
        onCreateTrip={handleCreateTrip}
        index={index}
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

    // Add photos-only clusters at the end — but only after loading is complete.
    // While suggestions are being fetched (cache check, vision prep, or API call),
    // clusters without suggestions haven't been resolved yet and showing
    // "No place found nearby" is misleading.
    if (!fetchingSuggestions) {
      for (const cluster of photosOnlyClusters) {
        items.push({ type: 'photos-only', cluster });
      }
    }

    return items;
  }, [
    selectedCandidate,
    suggestionsMap,
    clusterDisplays,
    dismissedClusterIdsInternal,
    fetchingSuggestions,
  ]);

  // Toggle a photo's inclusion/exclusion for upload
  const togglePhotoSelection = useCallback((clusterId: string, photoId: string) => {
    setExcludedPhotoIds((prev) => {
      const next = new Map(prev);
      const clusterSet = new Set(next.get(clusterId) ?? []);
      if (clusterSet.has(photoId)) {
        clusterSet.delete(photoId);
      } else {
        clusterSet.add(photoId);
      }
      next.set(clusterId, clusterSet);
      return next;
    });
  }, []);

  // Build photo list from cluster display data and open gallery
  const openGalleryForCluster = useCallback(
    (uri: string, clusterId: string, cluster: LocationClusterDisplay) => {
      const photos = cluster.previewUris.map((u, i) => ({
        id: cluster.photoIds[i],
        uri: u,
      }));
      const index = photos.findIndex((p) => p.uri === uri);
      setPreviewGallery({
        clusterId,
        photos,
        initialIndex: Math.max(0, index),
      });
      setCurrentGalleryIndex(Math.max(0, index));
    },
    []
  );

  // Open gallery for merged suggestion (multiple clusters)
  const openGalleryForMerged = useCallback((uri: string, merged: MergedSuggestion) => {
    const photos = merged.previewUris.map((u, i) => ({
      id: merged.photoIds[i],
      uri: u,
    }));
    const index = photos.findIndex((p) => p.uri === uri);
    setPreviewGallery({
      clusterId: merged.primaryClusterId,
      photos,
      initialIndex: Math.max(0, index),
    });
    setCurrentGalleryIndex(Math.max(0, index));
  }, []);

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

        const totalPhotos = merged.previewUris.length;
        const excludedCount = excludedPhotoIds.get(merged.primaryClusterId)?.size ?? 0;
        const selectedPhotos = totalPhotos - excludedCount;

        return (
          <PlaceSuggestionCard
            suggestion={buildSuggestionFromMerged(merged)}
            previewUris={merged.previewUris}
            onConfirm={(suggestion, place) => {
              const excluded = excludedPhotoIds.get(merged.primaryClusterId);
              handleConfirmPlaceWithTracking(
                suggestion,
                place,
                false,
                additionalClusterIds,
                excluded
              );
            }}
            onReject={handleRejectPlace}
            onPhotoPress={(uri) => openGalleryForMerged(uri, merged)}
            onDismiss={() => handleHideMultipleClusters(merged.clusterIds)}
            selectedPhotoCount={selectedPhotos}
            totalPhotoCount={totalPhotos}
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

        const totalPhotos = item.cluster.previewUris.length;
        const excludedCount = excludedPhotoIds.get(clusterId)?.size ?? 0;
        const selectedPhotos = totalPhotos - excludedCount;

        return (
          <PlaceSuggestionCard
            suggestion={item.data}
            previewUris={item.cluster.previewUris}
            onConfirm={(suggestion, place) => {
              const excluded = excludedPhotoIds.get(clusterId);
              handleConfirmPlaceWithTracking(suggestion, place, false, [], excluded);
            }}
            onReject={handleRejectPlace}
            onPhotoPress={(uri) => openGalleryForCluster(uri, clusterId, item.cluster)}
            onDismiss={handleHideCluster}
            selectedPhotoCount={selectedPhotos}
            totalPhotoCount={totalPhotos}
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
          onPhotoPress={(uri) => openGalleryForCluster(uri, item.cluster.id, item.cluster)}
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
      openGalleryForCluster,
      openGalleryForMerged,
      excludedPhotoIds,
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
          {phase === 'suggestions'
            ? 'Trip Suggestions'
            : phase === 'scanning'
              ? 'Scanning Photos'
              : phase === 'candidates'
                ? 'We Found Trips'
                : 'Import Photos'}
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
              <Image
                source={polaroidsIllustration}
                style={{ width: 120, height: 120 }}
                contentFit="contain"
              />
              {!lastImportTime && (
                <View style={styles.privacyNotice}>
                  <Text style={styles.privacyTitle}>Your photos stay private</Text>
                  <Text style={styles.privacyBullet}>
                    {'\u2022'} Only GPS data from photos outside{' '}
                    {homeCountryData?.name ?? 'your home country'} is scanned
                  </Text>
                  <Text style={styles.privacyBullet}>
                    {'\u2022'} Nothing is uploaded until you choose to save a place
                  </Text>
                  <Text style={styles.privacyBullet}>
                    {'\u2022'} The scan runs entirely on your device
                  </Text>
                </View>
              )}
              <Text style={styles.idleTitle}>
                {lastImportTime ? 'Import Travel Photos' : 'Ready to scan'}
              </Text>
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
          <Text style={styles.scanningHint}>
            Please keep the app open while we scan your photos. This usually takes 1-3 minutes.
          </Text>
          {scanProgress?.discoveredCountries && scanProgress.discoveredCountries.length > 0 && (
            <View style={styles.discoveryFeed}>
              {scanProgress.discoveredCountries.slice(-5).map((country) => (
                <Text key={country.code} style={styles.discoveryItem}>
                  Found photos from {getFlagEmoji(country.code)}
                </Text>
              ))}
            </View>
          )}
          <TouchableOpacity onPress={handleCancelScan} style={styles.cancelButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
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

          {/* Progress indicator during loading (covers cache check + vision prep + API call) */}
          {fetchingSuggestions && (
            <View style={styles.progressHeader}>
              <View style={styles.progressLabelRow}>
                <ActivityIndicator size="small" color={colors.sunsetGold} />
                <Text style={styles.progressLabel}>
                  {suggestPlacesMutation.progress
                    ? `Processing ${suggestPlacesMutation.progress.clustersCompleted} of ${suggestPlacesMutation.progress.clustersTotal} locations`
                    : 'Searching for places...'}
                </Text>
              </View>
              {suggestPlacesMutation.progress && (
                <View style={styles.progressBar}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${suggestPlacesMutation.progress.percentage}%` },
                    ]}
                  />
                </View>
              )}
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
              fetchingSuggestions ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={colors.sunsetGold} />
                  <Text style={styles.loadingText}>Finding nearby places...</Text>
                </View>
              ) : null
            }
          />
        </View>
      )}

      {/* Photo Gallery Overlay with Selection */}
      {previewGallery && (
        <PhotoGalleryModal
          previewGallery={previewGallery}
          onClose={() => setPreviewGallery(null)}
          currentGalleryIndex={currentGalleryIndex}
          onGalleryIndexChange={setCurrentGalleryIndex}
          excludedPhotoIds={excludedPhotoIds}
          onTogglePhotoSelection={togglePhotoSelection}
          onSplitCluster={handleSplitCluster}
        />
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
