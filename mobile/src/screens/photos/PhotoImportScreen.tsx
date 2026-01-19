/**
 * PhotoImportScreen - Single screen for photo-to-trip import workflow.
 *
 * Flow: idle → scanning → candidates → suggestions
 * Users can scan their photo library, see trip candidates by country,
 * and confirm/reject place suggestions.
 */

import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, GlassBackButton } from '@components/ui';
import type { TripCandidateDisplay, ClusterSuggestion } from '@services/photoImport';
import { colors } from '@constants/colors';
import { getFlagEmoji } from '@utils/flags';
import type { PassportStackScreenProps } from '@navigation/types';
import { ManualPlaceSearch, TripCandidateCard, PlaceSuggestionCard } from './components';
import { usePhotoImportWorkflow } from './usePhotoImportWorkflow';
import { styles } from './photoImportStyles';

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

export function PhotoImportScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { countryCode: filterCountryCode } = route.params ?? {};
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);

  const {
    phase,
    scanProgress,
    tripCandidates,
    selectedCandidate,
    clusterDisplays,
    manualSearchCluster,
    suggestPlacesMutation,
    startScan,
    cancelScan,
    selectCandidate,
    handleConfirmPlace,
    handleRejectPlace,
    handleManualSelect,
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

  const renderSuggestionItem = useCallback(
    ({ item }: { item: ClusterSuggestion }) => {
      const clusterDisplay = clusterDisplays.get(item.cluster_id);
      return (
        <PlaceSuggestionCard
          suggestion={item}
          previewUris={clusterDisplay?.previewUris ?? []}
          onConfirm={handleConfirmPlace}
          onReject={handleRejectPlace}
          onPhotoPress={setPreviewPhoto}
        />
      );
    },
    [handleConfirmPlace, handleRejectPlace, clusterDisplays]
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
            Scan your photo library to find travel photos and create entries automatically based on
            where they were taken.
          </Text>
          <Button title="Start Scan" onPress={startScan} style={styles.scanButton} />
        </View>
      )}

      {/* Scanning State */}
      {phase === 'scanning' && (
        <View style={styles.scanningContainer}>
          <ActivityIndicator size="large" color={colors.sunsetGold} />
          <Text style={styles.scanningTitle}>
            {scanProgress?.phase === 'geocoding'
              ? 'Identifying Countries...'
              : 'Scanning Photos...'}
          </Text>
          <Text style={styles.scanningProgress}>
            {scanProgress?.current ?? 0} / {scanProgress?.total ?? 0}
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
            estimatedItemSize={200}
          />
        </View>
      )}

      {/* Suggestions List */}
      {phase === 'suggestions' && selectedCandidate && (
        <View style={styles.listContainer}>
          <TouchableOpacity onPress={backToCandidates} style={styles.backLink}>
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

          {/* Show partial results while loading, or final results when complete */}
          <FlashList
            data={
              suggestPlacesMutation.isPending
                ? suggestPlacesMutation.partialResults
                : (suggestPlacesMutation.data?.suggestions ?? [])
            }
            renderItem={renderSuggestionItem}
            contentContainerStyle={styles.listContent}
            keyExtractor={(item) => item.cluster_id}
            estimatedItemSize={180}
            ListEmptyComponent={
              suggestPlacesMutation.isPending ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={colors.sunsetGold} />
                  <Text style={styles.loadingText}>Finding nearby places...</Text>
                </View>
              ) : (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>No place suggestions found for these photos.</Text>
                </View>
              )
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
          onSelect={handleManualSelect}
          onCancel={closeManualSearch}
        />
      )}
    </View>
  );
}
