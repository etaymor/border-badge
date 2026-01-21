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
import { useClusterPhotoUpload } from '@hooks/useClusterPhotoUpload';
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
  setUploadingClusterId: (id: string | null) => void;
}

export function useEntryCreation({
  clusterLookup,
  selectedTripId,
  manualSearchCluster,
  setManualSearchCluster,
  setDismissedClusterIds,
  setUploadingClusterId,
}: UseEntryCreationOptions) {
  const createEntry = useCreateEntry();
  const createTrip = useCreateTrip();
  const {
    state: uploadState,
    uploadPhotos,
    cancel: cancelUpload,
    reset: resetUpload,
  } = useClusterPhotoUpload();

  // Track if we're currently processing to prevent double-submissions
  const isProcessingRef = useRef(false);

  /**
   * Confirm a place suggestion and create an entry.
   */
  const handleConfirmPlace = useCallback(
    async (suggestion: ClusterSuggestion, place: PlaceSuggestion) => {
      if (__DEV__) {
        console.log('[EntryCreation] handleConfirmPlace called:', {
          clusterId: suggestion.cluster_id,
          placeId: place.place_id,
          isProcessing: isProcessingRef.current,
        });
      }

      // Prevent double-submissions
      if (isProcessingRef.current) {
        if (__DEV__) console.log('[EntryCreation] Already processing, ignoring confirm');
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

      // Mark as processing to prevent double-submissions
      isProcessingRef.current = true;

      // Set uploading state for UI
      setUploadingClusterId(suggestion.cluster_id);
      resetUpload();

      try {
        // Upload photos first
        const { mediaIds, failedCount } = await uploadPhotos(cluster.photos, selectedTripId);

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
          entry_date: cluster.timeRange.start.toISOString().split('T')[0],
          // Attach uploaded photos
          pending_media_ids: mediaIds.length > 0 ? mediaIds : undefined,
        };

        await createEntry.mutateAsync(entryData);
        Analytics.photoImportPlaceConfirmed({ category: place.category });

        // Mark cluster as processed in memory and persist to SQLite
        setDismissedClusterIds((prev) => new Set(prev).add(suggestion.cluster_id));
        await markClusterProcessed(suggestion.cluster_id, 'confirmed');

        // Show alert if some photos failed to upload
        if (failedCount > 0) {
          Alert.alert(
            'Entry Created',
            `${mediaIds.length} photo${mediaIds.length !== 1 ? 's' : ''} saved. ${failedCount} photo${failedCount !== 1 ? 's' : ''} failed to upload.`
          );
        }
      } catch (err) {
        // Check if this is a 409 Conflict (place already exists in trip)
        const axiosError = err as AxiosError;
        if (axiosError.response?.status === 409) {
          // Place already exists - mark cluster as processed and show friendly message
          setDismissedClusterIds((prev) => new Set(prev).add(suggestion.cluster_id));
          await markClusterProcessed(suggestion.cluster_id, 'confirmed');
          Alert.alert(
            'Already Saved',
            `"${place.name}" is already in this trip. You can add photos to it from the trip details.`
          );
        } else {
          const message = err instanceof Error ? err.message : 'Failed to save entry';
          Alert.alert('Save Failed', message);
        }
      } finally {
        isProcessingRef.current = false;
        setUploadingClusterId(null);
      }
    },
    [
      selectedTripId,
      clusterLookup,
      createEntry,
      uploadPhotos,
      resetUpload,
      setDismissedClusterIds,
      setUploadingClusterId,
    ]
  );

  /**
   * Reject a place suggestion and open manual search.
   */
  const handleRejectPlace = useCallback(
    (suggestion: ClusterSuggestion) => {
      Analytics.photoImportPlaceRejected();
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
      setDismissedClusterIds((prev) => new Set(prev).add(clusterId));
      await markClusterProcessed(clusterId, 'hidden');
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
      // Prevent double-submissions
      if (isProcessingRef.current) {
        if (__DEV__) console.log('[EntryCreation] Already processing, ignoring manual select');
        return undefined;
      }

      const cluster = manualSearchCluster;
      const clusterId = cluster?.id;
      // Don't close the modal yet - keep it open to show upload progress
      // It will be closed after successful save or kept open on failure

      // Mark as processing to prevent double-submissions
      isProcessingRef.current = true;

      // Set uploading state for UI
      if (clusterId) {
        setUploadingClusterId(clusterId);
        resetUpload();
      }

      try {
        // Upload photos first if we have a cluster
        let mediaIds: string[] = [];
        let failedCount = 0;
        if (cluster) {
          const uploadResult = await uploadPhotos(cluster.photos, tripIdToUse);
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
        Analytics.photoImportPlaceConfirmed({ category });

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
        isProcessingRef.current = false;
        setUploadingClusterId(null);
      }
    },
    [
      manualSearchCluster,
      createEntry,
      uploadPhotos,
      resetUpload,
      setManualSearchCluster,
      setDismissedClusterIds,
      setUploadingClusterId,
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
    uploadState,
    cancelUpload,
    handleConfirmPlace,
    handleRejectPlace,
    handleHideCluster,
    handleAddEntryForCluster,
    handleManualSelect,
    handleCreateTrip,
    closeManualSearch,
  };
}
