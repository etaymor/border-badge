/**
 * useEntryCreation - Hook for creating entries from photo clusters.
 *
 * Handles confirmation, rejection, manual entry, and trip creation.
 */

import { useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import type { AxiosError } from 'axios';

import type { SelectedPlace } from '@components/places';
import { useCreateEntry, PlaceInput, CreateEntryInput } from '@hooks/useEntries';
import { useCreateTrip } from '@hooks/useTrips';
import { useMultiClusterUpload } from '@hooks/useMultiClusterUpload';
import {
  getFullCluster,
  markClusterProcessed,
  type LocationCluster,
  type ClusterSuggestion,
  type PlaceSuggestion,
} from '@services/photoImport';
import { Analytics } from '@services/analytics';
import type { EntryType } from '@navigation/types';

export interface UseEntryCreationOptions {
  clusterLookup: Map<string, LocationCluster>;
  selectedTripId: string | null;
  manualSearchCluster: LocationCluster | null;
  setManualSearchCluster: (cluster: LocationCluster | null) => void;
  setDismissedClusterIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  addUploadingClusterId: (id: string) => void;
  removeUploadingClusterId: (id: string) => void;
}

export function useEntryCreation({
  clusterLookup,
  selectedTripId,
  manualSearchCluster,
  setManualSearchCluster,
  setDismissedClusterIds,
  addUploadingClusterId,
  removeUploadingClusterId,
}: UseEntryCreationOptions) {
  const createEntry = useCreateEntry();
  const createTrip = useCreateTrip();
  const {
    uploads: uploadStates,
    getUploadState,
    uploadPhotos,
    cancel: cancelUpload,
    reset: resetUpload,
  } = useMultiClusterUpload();

  // Track which clusters are currently processing to prevent double-submissions per cluster
  const processingClustersRef = useRef<Set<string>>(new Set());

  /**
   * Confirm a place suggestion and create an entry.
   * @param wasFromCache - Whether this suggestion was served from SQLite cache
   * @param additionalClusterIds - Additional cluster IDs to mark as processed (for merged suggestions)
   */
  const handleConfirmPlace = useCallback(
    async (
      suggestion: ClusterSuggestion,
      place: PlaceSuggestion,
      wasFromCache = false,
      additionalClusterIds: string[] = []
    ) => {
      if (__DEV__) {
        console.log('[EntryCreation] handleConfirmPlace called:', {
          clusterId: suggestion.cluster_id,
          placeId: place.place_id,
          isProcessing: processingClustersRef.current.has(suggestion.cluster_id),
        });
      }

      // Prevent double-submissions for the same cluster
      if (processingClustersRef.current.has(suggestion.cluster_id)) {
        if (__DEV__)
          console.log('[EntryCreation] Cluster already processing:', suggestion.cluster_id);
        return;
      }

      if (!selectedTripId) {
        Alert.alert('Error', 'Please select a trip first.');
        return;
      }

      const cluster = getFullCluster(suggestion.cluster_id, clusterLookup);
      if (!cluster) {
        Alert.alert('Error', 'Could not find cluster data.');
        return;
      }

      // Mark as processing to prevent double-submissions for this cluster
      processingClustersRef.current.add(suggestion.cluster_id);

      // Set uploading state for UI
      addUploadingClusterId(suggestion.cluster_id);
      resetUpload(suggestion.cluster_id);

      try {
        // For merged suggestions, upload photos from all related clusters
        // (primary + additional) so accepted cards include every previewed photo.
        const additionalClusters: LocationCluster[] = additionalClusterIds
          .map((id) => getFullCluster(id, clusterLookup))
          .filter((c): c is LocationCluster => c !== undefined);
        const photosToUpload = [cluster, ...additionalClusters]
          .flatMap((c) => c.photos)
          .filter((photo, index, self) => self.findIndex((p) => p.id === photo.id) === index);
        const earliestEntryDate = [cluster, ...additionalClusters].reduce(
          (earliest, c) => (c.timeRange.start < earliest ? c.timeRange.start : earliest),
          cluster.timeRange.start
        );

        // Upload photos first
        const { mediaIds, failedCount } = await uploadPhotos(
          suggestion.cluster_id,
          photosToUpload,
          selectedTripId
        );

        // Build place input for entry creation
        const placeInput: PlaceInput = {
          google_place_id: place.place_id,
          name: place.name,
          address: place.address,
          latitude: place.location.latitude,
          longitude: place.location.longitude,
          google_photo_url: null, // Not available from PlaceSuggestion
        };

        // Create entry data with uploaded media IDs
        const entryData: CreateEntryInput = {
          trip_id: selectedTripId,
          entry_type: place.category,
          title: place.name,
          place: placeInput,
          // Get entry date from cluster's earliest photo timestamp
          entry_date: earliestEntryDate.toISOString().split('T')[0],
          // Attach uploaded photos
          pending_media_ids: mediaIds.length > 0 ? mediaIds : undefined,
        };

        await createEntry.mutateAsync(entryData);
        // Calculate suggestion rank (1-based index)
        const suggestionRank =
          suggestion.places.findIndex((p) => p.place_id === place.place_id) + 1;
        Analytics.photoImportPlaceConfirmed({
          category: place.category,
          suggestionRank: suggestionRank > 0 ? suggestionRank : 1,
          wasFromCache,
        });

        // Mark cluster as processed in memory and persist to SQLite
        // Batch all cluster IDs (primary + additional) into a single state update
        const allClusterIds = [suggestion.cluster_id, ...additionalClusterIds];
        setDismissedClusterIds((prev) => {
          const next = new Set(prev);
          for (const id of allClusterIds) {
            next.add(id);
          }
          return next;
        });

        // Persist all cluster IDs to SQLite
        await markClusterProcessed(suggestion.cluster_id, 'confirmed');
        for (const additionalId of additionalClusterIds) {
          await markClusterProcessed(additionalId, 'confirmed');
        }

        // Show alert if some photos failed to upload
        if (failedCount > 0) {
          Alert.alert(
            'Entry Created',
            `${mediaIds.length} photo${mediaIds.length !== 1 ? 's' : ''} saved. ${failedCount} photo${failedCount !== 1 ? 's' : ''} failed to upload.`
          );
        }
      } catch (err) {
        const allClusterIds = [suggestion.cluster_id, ...additionalClusterIds];

        // Check if this is a 409 Conflict (place already exists in trip)
        const axiosError = err as AxiosError;
        if (axiosError.response?.status === 409) {
          // Place already exists - mark cluster as processed and show friendly message
          setDismissedClusterIds((prev) => {
            const next = new Set(prev);
            for (const id of allClusterIds) {
              next.add(id);
            }
            return next;
          });
          for (const id of allClusterIds) {
            await markClusterProcessed(id, 'confirmed');
          }
          Alert.alert(
            'Already Saved',
            `"${place.name}" is already in this trip. You can add photos to it from the trip details.`
          );
        } else {
          const message = err instanceof Error ? err.message : 'Failed to save entry';
          Alert.alert('Save Failed', message);
        }
      } finally {
        processingClustersRef.current.delete(suggestion.cluster_id);
        removeUploadingClusterId(suggestion.cluster_id);
      }
    },
    [
      selectedTripId,
      clusterLookup,
      createEntry,
      uploadPhotos,
      resetUpload,
      setDismissedClusterIds,
      addUploadingClusterId,
      removeUploadingClusterId,
    ]
  );

  /**
   * Reject a place suggestion and open manual search.
   * @param wasFromCache - Whether this suggestion was served from SQLite cache
   */
  const handleRejectPlace = useCallback(
    (suggestion: ClusterSuggestion, wasFromCache = false) => {
      Analytics.photoImportPlaceRejected({
        suggestionCount: suggestion.places.length,
        wasFromCache,
      });
      const cluster = getFullCluster(suggestion.cluster_id, clusterLookup);
      if (cluster) {
        setManualSearchCluster(cluster);
        Analytics.photoImportManualSearchOpened();
      }
    },
    [clusterLookup, setManualSearchCluster]
  );

  /**
   * Hide a cluster without creating an entry.
   * User explicitly chose to skip this cluster - persist so it won't appear again.
   */
  const handleHideCluster = useCallback(
    async (clusterId: string) => {
      Analytics.photoImportClusterHidden();
      setDismissedClusterIds((prev) => new Set(prev).add(clusterId));
      await markClusterProcessed(clusterId, 'hidden');
    },
    [setDismissedClusterIds]
  );

  /**
   * Hide multiple clusters without creating entries (for merged suggestions).
   */
  const handleHideMultipleClusters = useCallback(
    async (clusterIds: string[]) => {
      // Track analytics for each cluster
      for (let i = 0; i < clusterIds.length; i++) {
        Analytics.photoImportClusterHidden();
      }

      // Batch all cluster IDs into a single state update to avoid N recalculations
      setDismissedClusterIds((prev) => {
        const next = new Set(prev);
        for (const id of clusterIds) {
          next.add(id);
        }
        return next;
      });

      // Persist each cluster to SQLite
      for (const clusterId of clusterIds) {
        await markClusterProcessed(clusterId, 'hidden');
      }
    },
    [setDismissedClusterIds]
  );

  /**
   * Open manual search for a specific cluster.
   */
  const handleAddEntryForCluster = useCallback(
    (clusterId: string) => {
      const cluster = getFullCluster(clusterId, clusterLookup);
      if (cluster) {
        setManualSearchCluster(cluster);
        Analytics.photoImportManualSearchOpened();
      }
    },
    [clusterLookup, setManualSearchCluster]
  );

  /**
   * Create entry from manual place selection.
   */
  const handleManualSelect = useCallback(
    async (place: SelectedPlace, category: EntryType, tripIdToUse: string, notes?: string) => {
      const cluster = manualSearchCluster;
      const clusterId = cluster?.id;

      // Prevent double-submissions for the same cluster
      if (clusterId && processingClustersRef.current.has(clusterId)) {
        if (__DEV__) console.log('[EntryCreation] Cluster already processing:', clusterId);
        return undefined;
      }

      // Don't close the modal yet - keep it open to show upload progress
      // It will be closed after successful save or kept open on failure

      // Mark as processing to prevent double-submissions for this cluster
      if (clusterId) {
        processingClustersRef.current.add(clusterId);
      }

      // Set uploading state for UI
      if (clusterId) {
        addUploadingClusterId(clusterId);
        resetUpload(clusterId);
      }

      try {
        // Upload photos first if we have a cluster
        let mediaIds: string[] = [];
        let failedCount = 0;
        if (cluster && clusterId) {
          const uploadResult = await uploadPhotos(clusterId, cluster.photos, tripIdToUse);
          mediaIds = uploadResult.mediaIds;
          failedCount = uploadResult.failedCount;
        }

        // Build place input for entry creation
        const placeInput: PlaceInput = {
          google_place_id: place.google_place_id,
          name: place.name,
          address: place.address,
          latitude: place.latitude,
          longitude: place.longitude,
          google_photo_url: place.google_photo_url,
        };

        // Create entry data with uploaded media IDs
        const entryData: CreateEntryInput = {
          trip_id: tripIdToUse,
          entry_type: category,
          title: place.name,
          notes: notes || undefined,
          place: placeInput,
          // Get entry date from cluster's earliest photo timestamp
          entry_date: cluster?.timeRange.start.toISOString().split('T')[0],
          // Attach uploaded photos
          pending_media_ids: mediaIds.length > 0 ? mediaIds : undefined,
        };

        await createEntry.mutateAsync(entryData);
        // Manual selection = user rejected suggestions, so rank is 0 (not from suggestions)
        Analytics.photoImportPlaceConfirmed({
          category,
          suggestionRank: 0, // Manual entry, not from suggestions
          wasFromCache: false,
        });

        // Entry saved successfully - mark cluster as processed in memory and persist to SQLite
        if (clusterId) {
          setDismissedClusterIds((prev) => new Set(prev).add(clusterId));
          await markClusterProcessed(clusterId, 'confirmed');
        }

        // Show alert if some photos failed to upload
        if (failedCount > 0) {
          Alert.alert(
            'Entry Created',
            `${mediaIds.length} photo${mediaIds.length !== 1 ? 's' : ''} saved. ${failedCount} photo${failedCount !== 1 ? 's' : ''} failed to upload.`
          );
        }

        // Success! Now close the modal
        setManualSearchCluster(null);

        // Return the cluster ID for compatibility (screen may also track dismissed state)
        return clusterId;
      } catch (err) {
        // Check if this is a 409 Conflict (place already exists in trip)
        const axiosError = err as AxiosError;
        if (axiosError.response?.status === 409) {
          // Place already exists - mark cluster as processed and show friendly message
          if (clusterId) {
            setDismissedClusterIds((prev) => new Set(prev).add(clusterId));
            await markClusterProcessed(clusterId, 'confirmed');
          }
          setManualSearchCluster(null); // Close the modal
          Alert.alert(
            'Already Saved',
            `"${place.name}" is already in this trip. You can add photos to it from the trip details.`
          );
          return clusterId; // Return as if successful since we're dismissing the cluster
        } else {
          const message = err instanceof Error ? err.message : 'Failed to save entry';
          Alert.alert('Save Failed', message);
          // Modal stays open on error so user can try again (cluster is still in state)
          throw err; // Re-throw so caller knows it failed
        }
      } finally {
        if (clusterId) {
          processingClustersRef.current.delete(clusterId);
          removeUploadingClusterId(clusterId);
        }
      }
    },
    [
      manualSearchCluster,
      createEntry,
      uploadPhotos,
      resetUpload,
      setManualSearchCluster,
      setDismissedClusterIds,
      addUploadingClusterId,
      removeUploadingClusterId,
    ]
  );

  /**
   * Create a new trip.
   */
  const handleCreateTrip = useCallback(
    async (name: string, countryCode: string): Promise<string> => {
      try {
        const trip = await createTrip.mutateAsync({ name, country_code: countryCode });
        return trip.id;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create trip';
        Alert.alert('Error', message);
        throw err;
      }
    },
    [createTrip]
  );

  /**
   * Close manual search modal.
   */
  const closeManualSearch = useCallback(() => {
    setManualSearchCluster(null);
  }, [setManualSearchCluster]);

  return {
    createEntry,
    uploadStates,
    getUploadState,
    cancelUpload,
    handleConfirmPlace,
    handleRejectPlace,
    handleHideCluster,
    handleHideMultipleClusters,
    handleAddEntryForCluster,
    handleManualSelect,
    handleCreateTrip,
    closeManualSearch,
  };
}
