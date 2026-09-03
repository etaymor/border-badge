/**
 * PhotoImportScreen - Single screen for photo-to-trip import workflow.
 *
 * Flow: idle → scanning → candidates → trip-selection → suggestions
 * Users can scan their photo library, see trip candidates by country,
 * select a trip, and confirm/reject place suggestions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Text, View } from 'react-native';
import { FlashList, ListRenderItem } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PhotoPermissionPreheat } from '@components/photos/PhotoPermissionPreheat';
import { PhotoPermissionRecoverySheet } from '@components/photos/PhotoPermissionRecoverySheet';
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
import { Analytics } from '@services/analytics';
import { features } from '@config/features';
import { getLibraryFreshness } from '@services/photoImport/photoLibrarySyncStatus';
import { getCachedPhotosByCountry } from '@services/photoImport/photoCacheDb';
import { getIntentTagsForIds, getTagsForIds } from '@services/photoImport/photoTagDb';
import { lowSignalPhotoIds } from '@services/photoSignals';
import { useOnboardingStore, selectHomeCountry } from '@stores/onboardingStore';
import { usePhotoImportWorkflow } from './usePhotoImportWorkflow';
import { useClusterItems } from './useClusterItems';
import { useGalleryDispatchPause } from './useGalleryDispatchPause';
import { useScanLifecycle } from './useScanLifecycle';
import { styles } from './photoImportStyles';
import type { ClusterDisplayItem } from './photoImportHelpers';

type Props = PassportStackScreenProps<'PhotoImport'>;

export interface LowSignalSeedingArgs {
  /** Country of the selected candidate; the photo cache read is scoped to it. */
  countryCode: string | undefined;
  clusterDisplays: Map<string, LocationClusterDisplay>;
  setExcludedPhotoIds: React.Dispatch<React.SetStateAction<Map<string, Set<string>>>>;
  /**
   * The live exclusion map, read ONLY at unmount to count how many seeded
   * photos the user brought back (U5). Optional so the hook can be hosted
   * without it; the restore count is then always zero.
   */
  excludedPhotoIds?: Map<string, Set<string>>;
}

/**
 * U2 - seed the EXISTING per-cluster exclusion set with the cluster's
 * low-signal photos (screenshots, near-duplicate frames), once.
 *
 * Once is the whole point. A re-render, a re-fetch, or coming back to the
 * screen must never resurrect an exclusion the user restored, so a cluster is
 * claimed in `seededClusterIdsRef` before any await and is never revisited.
 * The claim is released only when the effect is torn down before it applied
 * anything - at that moment there is no user decision to overwrite.
 *
 * Returns the seeded ids per cluster so the list can name the cause (U3).
 */
export function useLowSignalSeeding({
  countryCode,
  clusterDisplays,
  setExcludedPhotoIds,
  excludedPhotoIds,
}: LowSignalSeedingArgs): Map<string, Set<string>> {
  const [seededPhotoIds, setSeededPhotoIds] = useState<Map<string, Set<string>>>(new Map());
  const seededClusterIdsRef = useRef<Set<string>>(new Set());

  // U5 counters, read once at unmount. Both are synced in an effect rather than
  // assigned during render - the React Compiler may memoize around a render-time
  // ref write and hand back a stale closure (CLAUDE.md 10).
  const seededRef = useRef(seededPhotoIds);
  const excludedRef = useRef(excludedPhotoIds);
  useEffect(() => {
    seededRef.current = seededPhotoIds;
  }, [seededPhotoIds]);
  useEffect(() => {
    excludedRef.current = excludedPhotoIds;
  }, [excludedPhotoIds]);

  /**
   * One event per import, at departure.
   *
   * `restored_count` is the false-positive rate on the seed rules: a photo we
   * hid and the user brought back. The rules are pure TS, so a meaningfully
   * non-zero restore count is the signal to loosen them over the air. Firing at
   * unmount rather than on each restore is what makes it a RATE - the numerator
   * and the denominator come from the same import.
   */
  useEffect(() => {
    return () => {
      const seeded = seededRef.current;
      if (seeded.size === 0) return;
      let seededCount = 0;
      let restoredCount = 0;
      for (const [clusterId, hidden] of seeded) {
        const stillExcluded = excludedRef.current?.get(clusterId);
        for (const id of hidden) {
          seededCount += 1;
          if (!stillExcluded?.has(id)) restoredCount += 1;
        }
      }
      Analytics.photoGalleryDeemphasis({
        seededCount,
        restoredCount,
        clustersSeeded: seeded.size,
      });
    };
  }, []);

  useEffect(() => {
    if (!features.enableQualityRanking || !features.enableIntentSignals) return;
    if (!countryCode) return;

    // The Set instance itself never changes; hold it so the cleanup below
    // releases claims on the same object the effect claimed them on.
    const seededClusterIds = seededClusterIdsRef.current;

    const pending = [...clusterDisplays.values()].filter(
      (cluster) => !seededClusterIds.has(cluster.id)
    );
    if (pending.length === 0) return;
    // Claim before the first await: two overlapping runs must not both seed.
    for (const cluster of pending) seededClusterIds.add(cluster.id);

    let cancelled = false;
    let applied = false;

    void (async () => {
      try {
        // One tag read for every pending cluster, not one per cluster.
        const ids = [...new Set(pending.flatMap((cluster) => cluster.previewAssetIds))];
        if (ids.length === 0) return;
        const [mlTags, intentTags] = await Promise.all([
          getTagsForIds(ids),
          getIntentTagsForIds(ids),
        ]);
        if (cancelled) return;
        // No rows in EITHER table (Android, a binary older than the tagger, an
        // install whose sweep has not run): hide nothing. Same guard, same
        // reason, as `rankTripSegmentPreviews`.
        if (mlTags.size === 0 && intentTags.size === 0) return;

        const cached = await getCachedPhotosByCountry(countryCode);
        if (cancelled) return;
        const lookup = new Map(cached.map((photo) => [photo.id, photo]));

        const seeds = new Map<string, Set<string>>();
        for (const cluster of pending) {
          // Only the preview slice: those are the ids the gallery and the
          // per-cluster counts are built from.
          const photos = cluster.previewAssetIds
            .map((id) => lookup.get(id))
            .filter((photo): photo is NonNullable<typeof photo> => photo !== undefined)
            .map((photo) => ({
              id: photo.id,
              creationTime: photo.creationTime,
              latitude: photo.latitude,
              longitude: photo.longitude,
              countryCode: photo.countryCode,
              width: photo.width,
              height: photo.height,
            }));
          const hidden = lowSignalPhotoIds(photos, {
            mlTags,
            intentTags,
            anchor: cluster.centroid,
          });
          if (hidden.size > 0) seeds.set(cluster.id, hidden);
        }
        if (cancelled || seeds.size === 0) return;

        applied = true;
        setSeededPhotoIds((prev) => {
          const next = new Map(prev);
          for (const [clusterId, hidden] of seeds) next.set(clusterId, hidden);
          return next;
        });
        setExcludedPhotoIds((prev) => {
          const next = new Map(prev);
          for (const [clusterId, hidden] of seeds) {
            const merged = new Set(next.get(clusterId) ?? []);
            for (const id of hidden) merged.add(id);
            next.set(clusterId, merged);
          }
          return next;
        });
      } catch (error) {
        // Seeding is best effort: a failed cache or tag read leaves the screen
        // exactly as it is today.
        console.warn('[photoImport] low-signal seeding skipped', error);
      }
    })();

    return () => {
      cancelled = true;
      if (!applied) {
        for (const cluster of pending) seededClusterIds.delete(cluster.id);
      }
    };
  }, [clusterDisplays, countryCode, setExcludedPhotoIds]);

  return seededPhotoIds;
}

export function PhotoImportScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  /**
   * Library size, for the magnitude and duration lines on the idle screen.
   * Read once on mount: it only has to be roughly right, and a wrong-by-a-few
   * number is far better than the screen saying nothing about how long a
   * 53,000-photo scan will take.
   */
  const [cachedPhotoCount, setCachedPhotoCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    getLibraryFreshness()
      .then((freshness) => {
        if (!cancelled) setCachedPhotoCount(freshness.cachedPhotoCount);
      })
      .catch(() => {
        // No number is a fine outcome: both lines render nothing.
      });
    return () => {
      cancelled = true;
    };
  }, []);
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
    suggestionDispatch,
    cachedSuggestions,
    fetchingSuggestions,
    retryingClusterIds,
    bulkRetryPreparingCount,
    lastImportTime,
    isIncremental,
    isSaving,
    dismissedClusterIdsInternal,
    scanFailure,
    clearScanFailure,
    permissionUi,
    handlePermissionPreheatChoice,
    getUploadState,
    uploadingClusterIds,
    isPremium,
    canImportPhotos,
    isExemptTrip,
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
    retryAllFailedClusters,
    handleManualSelect,
    handleCreateTrip,
    backToCandidates,
    switchCandidate,
    closeManualSearch,
    cancelUpload,
    markClustersViewed,
    trackDeparture,
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

  // Retry EVERY retry-eligible failed cluster in one action (U9/R15). Unlike the
  // per-card retry this DOES take a dispatch owner slot and runs through the
  // controller's bounded pool, so the status row shows it as in progress and the
  // burst cap is respected (KTD7/KTD12/KTD15).
  const handleRetryAllClusters = useCallback(
    (clusterIds: string[]) => {
      void retryAllFailedClusters(clusterIds);
    },
    [retryAllFailedClusters]
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
      // U11: the ad conversion rides the SAME first-confirmation-plus-departure
      // signal as the review prompt below, instead of waiting for every cluster
      // to be confirmed, rejected or hidden. Fired before the review modal can
      // hold up the navigation, and idempotent per lifetime.
      trackDeparture();

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
    [checkEligibility, startReviewFlow, backToCandidates, navigation, trackDeparture]
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
        isLoadingSuggestions={suggestionDispatch.isDispatching}
      />
    ),
    [
      handleSelectTripForCandidate,
      handleCreateTrip,
      rememberedTripId,
      suggestionDispatch.isDispatching,
    ]
  );

  // Build cluster display items using extracted hook
  const clusterItems = useClusterItems({
    selectedCandidate,
    clusterDisplays,
    suggestionDispatch,
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

  // Restore every photo the cluster hid - the one-tap escape hatch when the
  // seed (U2) got it wrong, and the reason auto-hiding is safe to ship.
  const restoreAllPhotos = useCallback((clusterId: string) => {
    setExcludedPhotoIds((prev) => {
      if (!prev.get(clusterId)?.size) return prev;
      const next = new Map(prev);
      next.set(clusterId, new Set());
      return next;
    });
  }, []);

  // U2: de-emphasize a cluster's screenshots and burst repeats by seeding the
  // same exclusion set the user's own taps fill. Once per cluster, never over
  // a restore.
  // The gallery the user just tapped open must not wait behind vision
  // preparation on the serial native image queue.
  useGalleryDispatchPause(previewGallery !== null);

  const seededPhotoIds = useLowSignalSeeding({
    countryCode: selectedCandidate?.countryCode,
    clusterDisplays,
    setExcludedPhotoIds,
    excludedPhotoIds,
  });

  // Build photo list from cluster display data and open gallery
  const openGalleryForCluster = useCallback(
    (uri: string, clusterId: string, cluster: LocationClusterDisplay) => {
      const photos = cluster.previewUris.map((u, i) => ({
        // previewAssetIds is aligned with previewUris (same slice); photoIds is
        // the full, unbounded list and can diverge past the preview cap.
        id: cluster.previewAssetIds[i],
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
      // previewAssetIds is aligned with previewUris (same slice); photoIds is
      // the full, unbounded list and can diverge past the preview cap.
      id: merged.previewAssetIds[i],
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
        seededPhotoIds={seededPhotoIds}
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
      seededPhotoIds,
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

      {/* Idle State — preheat / recovery gate OS ask before autoStart or scan */}
      {phase === 'idle' && permissionUi === 'preheat' && (
        <View style={styles.idleContainer} testID="photo-import-permission-preheat">
          <PhotoPermissionPreheat onChoose={handlePermissionPreheatChoice} />
        </View>
      )}
      {phase === 'idle' && permissionUi === 'recovery' && (
        <View style={styles.idleContainer} testID="photo-import-permission-recovery-idle">
          <PhotoPermissionRecoverySheet
            variant="denied"
            onOpenSettings={() => {
              Linking.openURL('app-settings:').catch(() => undefined);
            }}
            onRetry={() => {
              void handlePermissionPreheatChoice('full-access');
            }}
          />
        </View>
      )}
      {phase === 'idle' && permissionUi === 'none' && (
        <IdlePhase
          autoStart={autoStart}
          lastImportTime={lastImportTime}
          homeCountryName={homeCountryData?.name}
          onStartScan={startScan}
          cachedPhotoCount={cachedPhotoCount}
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
          isExemptTrip={isExemptTrip}
          fetchingSuggestions={fetchingSuggestions}
          isPaused={suggestionDispatch.isPaused}
          preparingRetryCount={bulkRetryPreparingCount}
          clusterItems={clusterItems}
          renderClusterItem={renderClusterItem}
          onUpgrade={() => rootNavigation.navigate('PaywallModal', { feature: 'photoImport' })}
          onRetryAllFailed={handleRetryAllClusters}
          onClustersViewed={markClustersViewed}
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
          onRestoreAllPhotos={restoreAllPhotos}
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
