/**
 * PhotoImportScreen - Single screen for photo-to-trip import workflow.
 *
 * Flow: idle → scanning → candidates → suggestions
 * Users can scan their photo library, see trip candidates by country,
 * and confirm/reject place suggestions.
 */

import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, GlassBackButton } from '@components/ui';
import type {
  TripCandidateDisplay,
  ClusterSuggestion,
  LocationClusterDisplay,
} from '@services/photoImport';
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
  const { countryCode: filterCountryCode } = route.params ?? {};
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [dismissedClusterIds, setDismissedClusterIds] = useState<Set<string>>(new Set());

  const {
    phase,
    scanProgress,
    tripCandidates,
    selectedCandidate,
    clusterDisplays,
    manualSearchCluster,
    suggestPlacesMutation,
    lastImportTime,
    isIncremental,
    isSaving,
    startScan,
    cancelScan,
    selectCandidate,
    handleConfirmPlace,
    handleRejectPlace,
    handleAddEntryForCluster,
    handleManualSelect,
    handleCreateTrip,
    backToCandidates,
    closeManualSearch,
  } = usePhotoImportWorkflow({
    filterCountryCode,
    onNavigateToTripForm: (params) => {
      navigation.navigate('Trips', {
        screen: 'TripForm',
        params,
      });
    },
  });

  const renderCandidateItem = useCallback(
    ({ item }: { item: TripCandidateDisplay }) => (
      <TripCandidateCard candidate={item} onSelect={selectCandidate} />
    ),
    [selectCandidate]
  );

  const handleDismissCluster = useCallback((clusterId: string) => {
    setDismissedClusterIds((prev) => new Set(prev).add(clusterId));
  }, []);

  // Wrapper for manual select that dismisses the cluster on success
  const handleManualSelectWithDismiss = useCallback(
    async (
      place: Parameters<typeof handleManualSelect>[0],
      category: Parameters<typeof handleManualSelect>[1],
      tripId: Parameters<typeof handleManualSelect>[2],
      notes?: Parameters<typeof handleManualSelect>[3]
    ) => {
      const clusterId = await handleManualSelect(place, category, tripId, notes);
      if (clusterId) {
        handleDismissCluster(clusterId);
      }
      return clusterId;
    },
    [handleManualSelect, handleDismissCluster]
  );

  const handleBackToCandidates = useCallback(() => {
    setDismissedClusterIds(new Set()); // Reset dismissed clusters
    backToCandidates();
  }, [backToCandidates]);

  // Build combined list of all clusters for the selected candidate
  // Clusters with suggestions get PlaceSuggestionCard, others get PhotoClusterCard
  const clusterItems: ClusterDisplayItem[] = useMemo(() => {
    if (!selectedCandidate) return [];

    const suggestions = suggestPlacesMutation.isPending
      ? suggestPlacesMutation.partialResults
      : (suggestPlacesMutation.data?.suggestions ?? []);

    if (__DEV__) {
      console.log('[PhotoImport] Building cluster items:', {
        candidateClusterIds: selectedCandidate.locationClusterIds,
        suggestionCount: suggestions.length,
        suggestionClusterIds: suggestions.map((s) => s.cluster_id),
        clusterDisplayKeys: Array.from(clusterDisplays.keys()),
      });
    }

    // Build a map of cluster IDs that have suggestions
    const suggestionsMap = new Map<string, ClusterSuggestion>();
    for (const suggestion of suggestions) {
      suggestionsMap.set(suggestion.cluster_id, suggestion);
    }

    // Build items for all clusters in the candidate (excluding dismissed ones)
    const items: ClusterDisplayItem[] = [];
    for (const clusterId of selectedCandidate.locationClusterIds) {
      // Skip dismissed clusters
      if (dismissedClusterIds.has(clusterId)) continue;

      const cluster = clusterDisplays.get(clusterId);
      if (!cluster) continue;

      const suggestion = suggestionsMap.get(clusterId);
      if (suggestion) {
        if (__DEV__) {
          console.log(
            `[PhotoImport] Cluster ${clusterId}: matched suggestion with ${suggestion.places?.length ?? 0} places`
          );
        }
        items.push({ type: 'suggestion', data: suggestion, cluster });
      } else {
        if (__DEV__) {
          console.log(`[PhotoImport] Cluster ${clusterId}: no suggestion found`);
        }
        items.push({ type: 'photos-only', cluster });
      }
    }

    return items;
  }, [selectedCandidate, suggestPlacesMutation, clusterDisplays, dismissedClusterIds]);

  const renderClusterItem = useCallback(
    ({ item }: { item: ClusterDisplayItem }) => {
      if (item.type === 'suggestion') {
        return (
          <PlaceSuggestionCard
            suggestion={item.data}
            previewUris={item.cluster.previewUris}
            onConfirm={handleConfirmPlace}
            onReject={handleRejectPlace}
            onPhotoPress={setPreviewPhoto}
            onDismiss={handleDismissCluster}
          />
        );
      }
      return (
        <PhotoClusterCard
          cluster={item.cluster}
          onAddEntry={(cluster) => handleAddEntryForCluster(cluster.id)}
          onPhotoPress={setPreviewPhoto}
          onDismiss={handleDismissCluster}
        />
      );
    },
    [handleConfirmPlace, handleRejectPlace, handleAddEntryForCluster, handleDismissCluster]
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <GlassBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>Import from Photos</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Idle State */}
      {phase === 'idle' && (
        <View style={styles.idleContainer}>
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
          <TouchableOpacity onPress={cancelScan} style={styles.cancelButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Candidates List */}
      {phase === 'candidates' && (
        <View style={styles.listContainer}>
          <Text style={styles.sectionTitle}>Trip Candidates</Text>
          <Text style={styles.sectionSubtitle}>
            Found {tripCandidates.length} potential trip{tripCandidates.length !== 1 ? 's' : ''} in
            your photos
          </Text>
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
          <TouchableOpacity onPress={handleBackToCandidates} style={styles.backLink}>
            <Ionicons name="arrow-back" size={16} color={colors.sunsetGold} />
            <Text style={styles.backLinkText}>Back to trips</Text>
          </TouchableOpacity>
          <Text style={styles.sectionTitle}>
            {getFlagEmoji(selectedCandidate.countryCode)} {selectedCandidate.countryCode}
          </Text>
          <Text style={styles.sectionSubtitle}>
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
            <Image source={{ uri: previewPhoto }} style={styles.fullPreview} contentFit="contain" />
          </Pressable>
        </Modal>
      )}

      {/* Manual Place Search Modal */}
      {manualSearchCluster && (
        <ManualPlaceSearch
          cluster={manualSearchCluster}
          countryCode={selectedCandidate?.countryCode}
          onSelect={handleManualSelectWithDismiss}
          onCreateTrip={handleCreateTrip}
          onCancel={closeManualSearch}
          isSaving={isSaving}
        />
      )}
    </View>
  );
}
