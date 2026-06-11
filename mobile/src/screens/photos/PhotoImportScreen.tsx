/**
 * PhotoImportScreen - Single screen for photo-to-trip import workflow.
 *
 * Flow: idle → scanning → candidates → trip-selection → suggestions
 * Users can scan their photo library, see trip candidates by country,
 * select a trip, and confirm/reject place suggestions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { FlashList, ListRenderItem } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SatisfactionModal } from '@components/review';
import { GlassBackButton, GlassIconButton } from '@components/ui';
import type { TripCandidateDisplay, LocationClusterDisplay } from '@services/photoImport';
import type { MergedSuggestion } from './photoImportTypes';
import { useCountryByCode } from '@hooks/useCountries';
import { useReviewRequest } from '@hooks/useReviewRequest';
import { useTrip } from '@hooks/useTrips';
import { colors } from '@constants/colors';
import type { PassportStackScreenProps, RootStackParamList } from '@navigation/types';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ManualPlaceSearch,
  PhotoTripCard,
  PhotoTripSwitcherSheet,
  PhotoGalleryModal,
  ClusterListItem,
  IdlePhase,
  ScanningPhase,
  SuggestionsPhase,
} from './components';
import { useOnboardingStore, selectHomeCountry } from '@stores/onboardingStore';
import { usePhotoImportWorkflow } from './usePhotoImportWorkflow';
import { useClusterItems } from './useClusterItems';
import { useScanLifecycle } from './useScanLifecycle';
import { styles } from './photoImportStyles';
import type { ClusterDisplayItem } from './photoImportHelpers';

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
    retryingClusterIds,
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
    retryFailedClusters,
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

  // Retry the place lookup for a single lookup-failed cluster (U10). Invokes the
  // scoped re-fetch (per-cluster in-flight guard + retrying spinner, SQLite-cache
  // respecting). Does NOT toggle the global `fetchingSuggestions` flag, so healthy
  // photos-only / no-place-found cards stay visible during retry (KTD7 / C4).
  const handleRetryCluster = useCallback(
    (clusterId: string) => {
      void retryFailedClusters([clusterId]);
    },
    [retryFailedClusters]
  );

  // Wrap handleManualSelect so the override (pencil) path honors the photos
  // the user deselected in the gallery before opening manual search.
  const handleManualSelectWithExclusions = useCallback(
    async (
      place: Parameters<typeof handleManualSelect>[0],
      category: Parameters<typeof handleManualSelect>[1],
      tripIdToUse: Parameters<typeof handleManualSelect>[2],
      notes?: Parameters<typeof handleManualSelect>[3]
    ) => {
      const excluded = manualSearchCluster
        ? excludedPhotoIds.get(manualSearchCluster.id)
        : undefined;
      return handleManualSelect(place, category, tripIdToUse, notes, excluded);
    },
    [handleManualSelect, manualSearchCluster, excludedPhotoIds]
  );

  // Handle back navigation with potential review trigger
  const handleBackNavigation = useCallback(
    (action: 'candidates' | 'goBack') => {
      if (hasConfirmedPlaceRef.current && checkEligibility('first_photo_import')) {
        if (startReviewFlow('first_photo_import')) {
          setPendingBackAction(action);
          setShowReviewModal(true);
          return;
        }
      }

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
      setRememberedTripId(tripIdToUse);
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

  // Build cluster display items using extracted hook
  const clusterItems = useClusterItems({
    selectedCandidate,
    clusterDisplays,
    suggestPlacesMutation,
    cachedSuggestions,
    dismissedClusterIdsInternal,
    fetchingSuggestions,
    retryingClusterIds,
  });

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
    ({ item }) => (
      <ClusterListItem
        item={item}
        uploadingClusterIds={uploadingClusterIds}
        getUploadState={getUploadState}
        excludedPhotoIds={excludedPhotoIds}
        onConfirmPlace={handleConfirmPlaceWithTracking}
        onRejectPlace={handleRejectPlace}
        onHideCluster={handleHideCluster}
        onHideMultipleClusters={handleHideMultipleClusters}
        onAddEntryForCluster={handleAddEntryForCluster}
        onRetryCluster={handleRetryCluster}
        onCancelUpload={cancelUpload}
        onOpenGalleryForCluster={openGalleryForCluster}
        onOpenGalleryForMerged={openGalleryForMerged}
      />
    ),
    [
      handleConfirmPlaceWithTracking,
      handleRejectPlace,
      handleAddEntryForCluster,
      handleRetryCluster,
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

      {/* Loading State */}
      {phase === 'loading' && (
        <View style={styles.idleContainer}>
          <ActivityIndicator size="large" color={colors.sunsetGold} />
          <Text style={styles.idleTitle}>Loading suggestions...</Text>
        </View>
      )}

      {/* Idle State */}
      {phase === 'idle' && (
        <IdlePhase
          autoStart={autoStart}
          lastImportTime={lastImportTime}
          homeCountryName={homeCountryData?.name}
          onStartScan={startScan}
        />
      )}

      {/* Scanning State (also renders the failed-state branch with Retry) */}
      {phase === 'scanning' && (
        <ScanningPhase
          scanProgress={scanProgress}
          isIncremental={isIncremental}
          onCancelScan={handleCancelScan}
          scanFailure={scanFailure}
          onRetryScan={() => startScan(false)}
        />
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
        <SuggestionsPhase
          selectedCandidate={selectedCandidate}
          selectedTripName={selectedTripName}
          selectedCountryName={selectedCountryName}
          isPremium={isPremium}
          canImportPhotos={canImportPhotos}
          fetchingSuggestions={fetchingSuggestions}
          suggestionsProgress={suggestPlacesMutation.progress ?? null}
          clusterItems={clusterItems}
          renderClusterItem={renderClusterItem}
          onUpgrade={() => rootNavigation.navigate('PaywallModal', { feature: 'photoImport' })}
        />
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
          onSelect={handleManualSelectWithExclusions}
          onCreateTrip={handleCreateTrip}
          onCancel={closeManualSearch}
          isSaving={isSaving}
          isUploading={uploadingClusterIds.has(manualSearchCluster.id)}
          uploadProgress={getUploadState(manualSearchCluster.id)?.overallProgress ?? 0}
          uploadingPhotoIndex={getUploadState(manualSearchCluster.id)?.currentPhotoIndex ?? 0}
          totalPhotosToUpload={getUploadState(manualSearchCluster.id)?.totalPhotos ?? 0}
          onCancelUpload={() => cancelUpload(manualSearchCluster.id)}
          excludedPhotoIds={excludedPhotoIds.get(manualSearchCluster.id)}
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
