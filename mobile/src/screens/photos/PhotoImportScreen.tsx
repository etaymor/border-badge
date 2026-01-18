/**
 * PhotoImportScreen - Single screen for photo-to-trip import workflow.
 *
 * Flow: idle → scanning → candidates → suggestions
 * Users can scan their photo library, see trip candidates by country,
 * and confirm/reject place suggestions.
 */

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, GlassBackButton } from '@components/ui';
import { PlacesAutocomplete, type SelectedPlace } from '@components/places';
import { CategorySelector } from '@components/entries';
import { useOnboardingStore, selectHomeCountry } from '@stores/onboardingStore';
import { useSuggestPlaces } from '@hooks/usePhotoImport';
import {
  extractPhotosWithLocation,
  clusterByLocation,
  geocodeClusterCentroids,
  segmentTripsByTimeGap,
  HomeCountryNotSetError,
  type ScanProgress,
  type TripCandidate,
  type LocationCluster,
  type ClusterSuggestion,
  type PlaceSuggestion,
} from '@services/photoImport';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { getFlagEmoji } from '@utils/flags';
import type { PassportStackScreenProps, EntryType } from '@navigation/types';

type Props = PassportStackScreenProps<'PhotoImport'>;

type ImportPhase = 'idle' | 'scanning' | 'candidates' | 'suggestions';

export function PhotoImportScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { countryCode: filterCountryCode } = route.params ?? {};

  // Get home country from onboarding store
  const homeCountry = useOnboardingStore(selectHomeCountry);

  // Local state for ephemeral workflow
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [tripCandidates, setTripCandidates] = useState<TripCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<TripCandidate | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // Photo preview state
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);

  // Manual search state (when user rejects a suggestion)
  const [manualSearchCluster, setManualSearchCluster] = useState<LocationCluster | null>(null);

  // Place suggestion mutation
  const suggestPlacesMutation = useSuggestPlaces();

  // Start scanning photo library
  const startScan = useCallback(async () => {
    // Check home country is set
    if (!homeCountry) {
      Alert.alert(
        'Set Home Country',
        'Please set your home country in settings first. This helps us filter out local photos.',
        [{ text: 'OK' }]
      );
      return;
    }

    const controller = new AbortController();
    setAbortController(controller);
    setPhase('scanning');

    try {
      // Extract photos with GPS
      const photos = await extractPhotosWithLocation(
        (progress) => setScanProgress(progress),
        controller.signal
      );

      if (photos.length === 0) {
        Alert.alert(
          'No Photos Found',
          'No photos with location data were found in your library. Make sure location services were enabled when you took the photos.',
          [{ text: 'OK' }]
        );
        setPhase('idle');
        return;
      }

      // Cluster by location
      const clusters = clusterByLocation(photos);

      // Geocode cluster centroids (not individual photos!)
      await geocodeClusterCentroids(clusters, (done, total) => {
        setScanProgress({
          phase: 'geocoding',
          current: done,
          total,
          percentage: Math.round((done / total) * 100),
        });
      });

      // Segment into trip candidates
      let candidates = segmentTripsByTimeGap(clusters, homeCountry);

      // Filter to specific country if provided
      if (filterCountryCode) {
        candidates = candidates.filter((c) => c.countryCode === filterCountryCode);
      }

      if (candidates.length === 0) {
        Alert.alert(
          'No Trips Found',
          filterCountryCode
            ? `No travel photos found for this country. Photos taken in your home country (${homeCountry}) are filtered out.`
            : `No travel photos found. Photos taken in your home country (${homeCountry}) are filtered out.`,
          [{ text: 'OK' }]
        );
        setPhase('idle');
        return;
      }

      setTripCandidates(candidates);
      setPhase('candidates');
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        setPhase('idle');
      } else if (error instanceof HomeCountryNotSetError) {
        Alert.alert('Set Home Country', 'Please set your home country in settings first.');
        setPhase('idle');
      } else {
        console.error('[PhotoImport] Scan error:', error);
        Alert.alert('Scan Failed', 'Failed to scan photos. Please try again.');
        setPhase('idle');
      }
    }
  }, [homeCountry, filterCountryCode]);

  // Cancel the current scan
  const cancelScan = useCallback(() => {
    abortController?.abort();
    setAbortController(null);
    setPhase('idle');
  }, [abortController]);

  // Select a trip candidate to get place suggestions
  const selectCandidate = useCallback(
    async (candidate: TripCandidate) => {
      setSelectedCandidate(candidate);
      setPhase('suggestions');

      // Fetch place suggestions for this candidate's clusters
      try {
        await suggestPlacesMutation.mutateAsync({
          clusters: candidate.locationClusters.map((c) => ({
            id: c.id,
            centroid: {
              latitude: c.centroid.latitude,
              longitude: c.centroid.longitude,
            },
            photos: c.photos.map((p) => ({
              asset_id: p.id,
              latitude: p.location.latitude,
              longitude: p.location.longitude,
              timestamp: p.creationTime.toISOString(),
            })),
            start_time: c.timeRange.start.toISOString(),
            end_time: c.timeRange.end.toISOString(),
          })),
        });
      } catch (error) {
        console.error('[PhotoImport] Suggestion error:', error);
        Alert.alert(
          'Failed to Get Suggestions',
          'Unable to find place suggestions. Please try again.'
        );
      }
    },
    [suggestPlacesMutation]
  );

  // Confirm a place suggestion
  const handleConfirmPlace = useCallback(
    (_suggestion: ClusterSuggestion, _place: PlaceSuggestion) => {
      // Navigate to entry creation with pre-filled place
      if (selectedCandidate) {
        navigation.navigate('Trips', {
          screen: 'TripForm',
          params: {
            countryId: selectedCandidate.countryCode,
            // Pass place data via params or state
          },
        });
      }
    },
    [navigation, selectedCandidate]
  );

  // Reject a suggestion and show manual search
  const handleRejectPlace = useCallback(
    (suggestion: ClusterSuggestion) => {
      // Find the cluster for this suggestion
      const cluster = selectedCandidate?.locationClusters.find(
        (c) => c.id === suggestion.cluster_id
      );
      if (cluster) {
        setManualSearchCluster(cluster);
      }
    },
    [selectedCandidate]
  );

  // Handle manual place selection
  const handleManualSelect = useCallback(
    (_place: SelectedPlace, _category: EntryType) => {
      setManualSearchCluster(null);
      // Navigate to entry creation with selected place and category
      if (selectedCandidate) {
        navigation.navigate('Trips', {
          screen: 'TripForm',
          params: {
            countryId: selectedCandidate.countryCode,
          },
        });
      }
    },
    [navigation, selectedCandidate]
  );

  // Go back to candidates list
  const backToCandidates = useCallback(() => {
    setSelectedCandidate(null);
    setPhase('candidates');
    suggestPlacesMutation.reset();
  }, [suggestPlacesMutation]);

  // Format date range for display
  const formatDateRange = (start: Date, end: Date) => {
    const startStr = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const endStr = end.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return `${startStr} - ${endStr}`;
  };

  // Render trip candidate item
  const renderCandidateItem = useCallback(
    ({ item }: { item: TripCandidate }) => {
      const flag = getFlagEmoji(item.countryCode);
      const photoCount = item.photos.length;
      const previewPhotos = item.photos.slice(0, 4);

      return (
        <TouchableOpacity
          style={styles.candidateCard}
          onPress={() => selectCandidate(item)}
          activeOpacity={0.7}
        >
          {/* Photo preview grid */}
          <View style={styles.candidatePhotos}>
            {previewPhotos.map((photo, index) => (
              <Image
                key={photo.id}
                source={{ uri: photo.uri }}
                style={[
                  styles.candidateThumbnail,
                  index === 3 && photoCount > 4 && styles.candidateThumbnailLast,
                ]}
                contentFit="cover"
              />
            ))}
            {photoCount > 4 && (
              <View style={styles.morePhotosOverlay}>
                <Text style={styles.morePhotosText}>+{photoCount - 4}</Text>
              </View>
            )}
          </View>

          {/* Candidate info */}
          <View style={styles.candidateInfo}>
            <Text style={styles.candidateFlag}>{flag}</Text>
            <View style={styles.candidateDetails}>
              <Text style={styles.candidateCountry}>{item.countryCode}</Text>
              <Text style={styles.candidateDates}>
                {formatDateRange(item.dateRange.start, item.dateRange.end)}
              </Text>
              <Text style={styles.candidatePhotoCount}>{photoCount} photos</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
          </View>
        </TouchableOpacity>
      );
    },
    [selectCandidate]
  );

  // Render place suggestion item
  const renderSuggestionItem = useCallback(
    ({ item }: { item: ClusterSuggestion }) => {
      const topPlace = item.places[0];
      if (!topPlace) return null;

      // Get photos for this cluster
      const clusterPhotos =
        selectedCandidate?.locationClusters.find((c) => c.id === item.cluster_id)?.photos ?? [];

      return (
        <View style={styles.suggestionCard}>
          {/* Photo thumbnails */}
          <ScrollView
            horizontal
            style={styles.suggestionPhotos}
            showsHorizontalScrollIndicator={false}
          >
            {clusterPhotos.slice(0, 5).map((photo) => (
              <TouchableOpacity key={photo.id} onPress={() => setPreviewPhoto(photo.uri)}>
                <Image
                  source={{ uri: photo.uri }}
                  style={styles.suggestionThumbnail}
                  contentFit="cover"
                />
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Place info */}
          <View style={styles.suggestionInfo}>
            <Text style={styles.suggestionName}>{topPlace.name}</Text>
            <Text style={styles.suggestionAddress} numberOfLines={1}>
              {topPlace.address}
            </Text>
            <View style={styles.suggestionMeta}>
              <View style={styles.categoryBadge}>
                <Text style={styles.categoryText}>{topPlace.category}</Text>
              </View>
              <Text style={styles.distanceText}>{Math.round(topPlace.distance_m)}m away</Text>
            </View>
          </View>

          {/* Yes/No buttons */}
          <View style={styles.suggestionActions}>
            <TouchableOpacity
              style={[styles.actionButton, styles.rejectButton]}
              onPress={() => handleRejectPlace(item)}
            >
              <Ionicons name="close" size={24} color={colors.adobeBrick} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.confirmButton]}
              onPress={() => handleConfirmPlace(item, topPlace)}
            >
              <Ionicons name="checkmark" size={24} color={colors.success} />
            </TouchableOpacity>
          </View>
        </View>
      );
    },
    [selectedCandidate, handleConfirmPlace, handleRejectPlace]
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

          {suggestPlacesMutation.isPending ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.sunsetGold} />
              <Text style={styles.loadingText}>Finding nearby places...</Text>
            </View>
          ) : (
            <FlashList
              data={suggestPlacesMutation.data?.suggestions ?? []}
              renderItem={renderSuggestionItem}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>No place suggestions found for these photos.</Text>
                </View>
              }
            />
          )}
        </View>
      )}

      {/* Photo Preview Overlay */}
      {previewPhoto && (
        <Modal
          transparent
          animationType="fade"
          visible={true}
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
          onCancel={() => setManualSearchCluster(null)}
        />
      )}
    </View>
  );
}

// Manual Place Search Component
interface ManualPlaceSearchProps {
  cluster: LocationCluster;
  countryCode?: string;
  onSelect: (place: SelectedPlace, category: EntryType) => void;
  onCancel: () => void;
}

function ManualPlaceSearch({ cluster, countryCode, onSelect, onCancel }: ManualPlaceSearchProps) {
  const insets = useSafeAreaInsets();
  const [selectedPlace, setSelectedPlace] = useState<SelectedPlace | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<EntryType | null>(null);
  const [hasSelectedType, setHasSelectedType] = useState(false);

  const handleConfirm = () => {
    if (selectedPlace && selectedCategory) {
      onSelect(selectedPlace, selectedCategory);
    }
  };

  const handleTypeSelect = (type: EntryType) => {
    setSelectedCategory(type);
    setHasSelectedType(true);
  };

  return (
    <Modal animationType="slide" visible={true} onRequestClose={onCancel}>
      <View style={[styles.manualSearchContainer, { paddingTop: insets.top }]}>
        <View style={styles.manualSearchHeader}>
          <Text style={styles.manualSearchTitle}>Find the right place</Text>
          <TouchableOpacity onPress={onCancel}>
            <Text style={styles.manualSearchCancel}>Cancel</Text>
          </TouchableOpacity>
        </View>

        {/* Show photo thumbnails for context */}
        <ScrollView horizontal style={styles.photoRow} showsHorizontalScrollIndicator={false}>
          {cluster.photos.slice(0, 5).map((photo) => (
            <Image
              key={photo.id}
              source={{ uri: photo.uri }}
              style={styles.contextThumb}
              contentFit="cover"
            />
          ))}
        </ScrollView>

        {/* PlacesAutocomplete - focused on cluster location */}
        <View style={styles.autocompleteSection}>
          <Text style={styles.sectionLabel}>SEARCH FOR A PLACE</Text>
          <PlacesAutocomplete
            value={selectedPlace}
            onSelect={setSelectedPlace}
            placeholder="Search for a place..."
            countryCode={countryCode}
          />
        </View>

        {/* Category selection - shown after place is selected */}
        {selectedPlace && (
          <View style={styles.categorySection}>
            <CategorySelector
              entryType={selectedCategory}
              hasSelectedType={hasSelectedType}
              onTypeSelect={handleTypeSelect}
              onChangeType={() => setHasSelectedType(false)}
            />
          </View>
        )}

        {/* Confirm button - enabled when both place and category selected */}
        {selectedPlace && selectedCategory && (
          <View style={styles.confirmSection}>
            <Button title="Add Entry" onPress={handleConfirm} />
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  headerTitle: {
    flex: 1,
    fontFamily: fonts.playfair.bold,
    fontSize: 24,
    color: colors.midnightNavy,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 44,
  },

  // Idle state
  idleContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  idleTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 24,
    color: colors.midnightNavy,
    marginTop: 24,
    marginBottom: 12,
  },
  idleDescription: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  scanButton: {
    minWidth: 200,
  },

  // Scanning state
  scanningContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  scanningTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
    marginTop: 24,
    marginBottom: 8,
  },
  scanningProgress: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  progressBar: {
    width: '100%',
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.sunsetGold,
  },
  cancelButton: {
    marginTop: 24,
    padding: 12,
  },
  cancelText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.adobeBrick,
  },

  // Lists
  listContainer: {
    flex: 1,
    paddingHorizontal: 20,
  },
  listContent: {
    paddingBottom: 40,
  },
  sectionTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 24,
    color: colors.midnightNavy,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 20,
  },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  backLinkText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.sunsetGold,
    marginLeft: 4,
  },

  // Candidate card
  candidateCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  candidatePhotos: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    height: 80,
  },
  candidateThumbnail: {
    width: '25%',
    height: 80,
  },
  candidateThumbnailLast: {
    opacity: 0.7,
  },
  morePhotosOverlay: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: '25%',
    height: 80,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  morePhotosText: {
    fontFamily: fonts.openSans.bold,
    fontSize: 16,
    color: colors.white,
  },
  candidateInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  candidateFlag: {
    fontSize: 32,
    marginRight: 12,
  },
  candidateDetails: {
    flex: 1,
  },
  candidateCountry: {
    fontFamily: fonts.playfair.bold,
    fontSize: 18,
    color: colors.midnightNavy,
  },
  candidateDates: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.textSecondary,
  },
  candidatePhotoCount: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 12,
    color: colors.sunsetGold,
    marginTop: 2,
  },

  // Suggestion card
  suggestionCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  suggestionPhotos: {
    flexDirection: 'row',
    padding: 12,
    paddingBottom: 8,
  },
  suggestionThumbnail: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 8,
  },
  suggestionInfo: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  suggestionName: {
    fontFamily: fonts.playfair.bold,
    fontSize: 18,
    color: colors.midnightNavy,
    marginBottom: 4,
  },
  suggestionAddress: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  suggestionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  categoryBadge: {
    backgroundColor: colors.sunsetGold + '20',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 12,
  },
  categoryText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 12,
    color: colors.sunsetGold,
    textTransform: 'capitalize',
  },
  distanceText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.textSecondary,
  },
  suggestionActions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectButton: {
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  confirmButton: {},

  // Loading & Empty states
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: 16,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  // Photo preview overlay
  overlayBackground: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    zIndex: 10,
    padding: 8,
  },
  fullPreview: {
    width: '100%',
    height: '80%',
  },

  // Manual search modal
  manualSearchContainer: {
    flex: 1,
    backgroundColor: colors.warmCream,
    paddingHorizontal: 20,
  },
  manualSearchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
  },
  manualSearchTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 24,
    color: colors.midnightNavy,
  },
  manualSearchCancel: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.sunsetGold,
  },
  photoRow: {
    flexDirection: 'row',
    marginBottom: 24,
  },
  contextThumb: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 8,
  },
  autocompleteSection: {
    marginBottom: 24,
    zIndex: 1000,
  },
  sectionLabel: {
    fontFamily: fonts.oswald.medium,
    fontSize: 12,
    color: colors.midnightNavy,
    marginBottom: 12,
    letterSpacing: 1.5,
    opacity: 0.7,
    textTransform: 'uppercase',
  },
  categorySection: {
    marginBottom: 24,
  },
  confirmSection: {
    marginTop: 'auto',
    paddingBottom: 40,
  },
});
