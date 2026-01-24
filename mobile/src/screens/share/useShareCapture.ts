/**
 * Custom hook for ShareCaptureScreen state management and handlers.
 * Extracts all business logic from the screen component.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import type { EntryType } from '@navigation/types';
import { useSocialIngest, useSaveToTrip, SocialIngestResponse } from '@hooks/useSocialIngest';
import { useCreateTrip, useTrips, useUncategorizedTrip, Trip } from '@hooks/useTrips';
import { useCreateEntry, PlaceInput } from '@hooks/useEntries';
import type { SelectedPlace } from '@components/places';
import { Analytics } from '@services/analytics';
import { enqueueFailedShare } from '@services/shareQueue';
import { completeAppGroupShare } from '@services/shareExtensionBridge';

import {
  detectProviderFromUrl,
  inferEntryTypeFromPlaceTypes,
  detectedPlaceToSelectedPlace,
  selectedPlaceToDetectedPlace,
} from './shareCaptureUtils';

interface UseShareCaptureParams {
  url: string;
  caption?: string;
  source?: string;
  onComplete: (tripId?: string) => void;
}

export interface ShareCaptureState {
  ingestResult: SocialIngestResponse | null;
  selectedPlace: SelectedPlace | null;
  selectedTripId: string | null;
  entryType: EntryType;
  hasSelectedType: boolean;
  notes: string;
  isCreatingTrip: boolean;
  isManualEntryMode: boolean;
  error: string | null;
  isLoading: boolean;
  isSaving: boolean;
  userClearedPlace: boolean; // True when user explicitly cleared the place selection
}

export interface ShareCaptureHandlers {
  handleTypeSelect: (type: EntryType) => void;
  handleChangeType: () => void;
  handlePlaceSelect: (place: SelectedPlace | null) => void;
  handleCreateTrip: (name: string, countryCode: string) => Promise<string>;
  handleSave: () => Promise<void>;
  handleRetry: () => void;
  handleManualEntry: () => void;
  handleSaveForLater: () => Promise<void>;
  setNotes: (notes: string) => void;
  setSelectedTripId: (id: string | null) => void;
}

/**
 * Find matching trips for a country code, sorted by most recent.
 * Exported for testing purposes.
 */
export function findMatchingTrips(trips: Trip[], countryCode: string | null | undefined): Trip[] {
  if (!countryCode) return [];
  return trips
    .filter((t) => t.country_code === countryCode)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function useShareCapture({
  url,
  caption,
  source,
  onComplete,
}: UseShareCaptureParams): ShareCaptureState & ShareCaptureHandlers {
  // Mutations
  const socialIngest = useSocialIngest();
  const saveToTrip = useSaveToTrip();
  const createTrip = useCreateTrip();
  const createEntry = useCreateEntry();

  // Trips data
  const { data: trips = [] } = useTrips();
  const { data: uncategorizedTrip } = useUncategorizedTrip();

  // State
  const [ingestResult, setIngestResult] = useState<SocialIngestResponse | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<SelectedPlace | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [entryType, setEntryType] = useState<EntryType>('place');
  const [hasSelectedType, setHasSelectedType] = useState(true);
  const [notes, setNotes] = useState('');
  const [isCreatingTrip, setIsCreatingTrip] = useState(false);
  const [isManualEntryMode, setIsManualEntryMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveCompleted, setSaveCompleted] = useState(false);
  const [userClearedPlace, setUserClearedPlace] = useState(false);

  // Clean up on unmount if save was not completed
  // This handles cases where user navigates away or cancels
  useEffect(() => {
    return () => {
      if (source === 'share_extension' && !saveCompleted) {
        // Mark as processed even if not saved, so it won't appear again
        // User has seen it and chosen to dismiss - that's their decision
        void completeAppGroupShare(url);
      }
    };
  }, [source, url, saveCompleted]);

  // Process URL on mount
  useEffect(() => {
    Analytics.shareStarted({ source: source ?? 'unknown', url });

    socialIngest.mutate(
      { url, caption },
      {
        onSuccess: (result) => {
          setIngestResult(result);

          if (result.detected_place) {
            setSelectedPlace(detectedPlaceToSelectedPlace(result.detected_place));
            const inferredType = inferEntryTypeFromPlaceTypes(
              result.detected_place.primary_type,
              result.detected_place.types ?? []
            );
            setEntryType(inferredType);
          }
        },
        onError: (err) => {
          const message = err instanceof Error ? err.message : 'Failed to process URL';
          setError(message);
          Analytics.shareFailed({ provider: 'unknown', error: message, stage: 'ingest' });
        },
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-select trip: prioritize country-specific trip, then fall back to "Saved Places"
  // This effect runs whenever trips, uncategorizedTrip, or ingestResult changes
  useEffect(() => {
    const countryCode =
      ingestResult?.detected_place?.country_code ?? ingestResult?.detected_country?.country_code;
    const matchingTrips = findMatchingTrips(trips, countryCode);

    // Debug logging
    console.log('[useShareCapture] Auto-select effect:', {
      selectedTripId,
      uncategorizedTripId: uncategorizedTrip?.id,
      countryCode,
      tripsCount: trips.length,
      matchingTripsCount: matchingTrips.length,
    });

    // Don't override user's selection
    if (selectedTripId) {
      console.log('[useShareCapture] Skipping - already have selection');
      return;
    }

    if (matchingTrips.length > 0) {
      // Use the most recent trip for the detected country
      console.log('[useShareCapture] Selecting country trip:', matchingTrips[0].id);
      setSelectedTripId(matchingTrips[0].id);
      return;
    }

    // Default to "Saved Places" if available
    if (uncategorizedTrip?.id) {
      console.log('[useShareCapture] Selecting Saved Places:', uncategorizedTrip.id);
      setSelectedTripId(uncategorizedTrip.id);
    } else {
      console.log('[useShareCapture] No uncategorized trip available yet');
    }
  }, [
    ingestResult?.detected_place?.country_code,
    ingestResult?.detected_country?.country_code,
    trips,
    selectedTripId,
    uncategorizedTrip?.id,
  ]);

  const handleTypeSelect = useCallback(
    (type: EntryType) => {
      setEntryType(type);
      if (!hasSelectedType) setHasSelectedType(true);
    },
    [hasSelectedType]
  );

  const handleChangeType = useCallback(() => {
    setHasSelectedType(false);
  }, []);

  const handlePlaceSelect = useCallback(
    (place: SelectedPlace | null) => {
      setSelectedPlace(place);

      if (place === null) {
        // User explicitly cleared the place - reset country focus
        setUserClearedPlace(true);
        // Reset trip selection to uncategorized (if available) so user can pick any trip
        if (uncategorizedTrip?.id) {
          setSelectedTripId(uncategorizedTrip.id);
        } else {
          setSelectedTripId(null);
        }
      } else if (place.country_code) {
        // User selected a new place - restore country focus
        setUserClearedPlace(false);
        const matchingTrips = findMatchingTrips(trips, place.country_code);
        if (matchingTrips.length > 0) {
          setSelectedTripId(matchingTrips[0].id);
        } else if (uncategorizedTrip?.id) {
          // Default to "Saved Places" when no matching trips exist
          setSelectedTripId(uncategorizedTrip.id);
        }
      } else {
        // Place selected without country code - just clear the flag
        setUserClearedPlace(false);
      }
    },
    [trips, uncategorizedTrip?.id]
  );

  const handleCreateTrip = useCallback(
    async (name: string, countryCode: string): Promise<string> => {
      setIsCreatingTrip(true);
      try {
        const trip = await createTrip.mutateAsync({ name, country_code: countryCode });
        return trip.id;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create trip';
        setError(message);
        Analytics.shareFailed({
          provider: ingestResult?.provider ?? 'unknown',
          error: message,
          stage: 'save',
        });
        throw err;
      } finally {
        setIsCreatingTrip(false);
      }
    },
    [createTrip, ingestResult?.provider]
  );

  const handleSave = useCallback(async () => {
    if (!selectedPlace) {
      Alert.alert('Location Required', 'Please select or search for a location.');
      return;
    }
    if (!selectedTripId) {
      Alert.alert('Trip Required', 'Please select or create a trip.');
      return;
    }

    if (isManualEntryMode) {
      const placeInput: PlaceInput = {
        google_place_id: selectedPlace.google_place_id,
        name: selectedPlace.name,
        address: selectedPlace.address,
        latitude: selectedPlace.latitude,
        longitude: selectedPlace.longitude,
        google_photo_url: selectedPlace.google_photo_url,
      };

      createEntry.mutate(
        {
          trip_id: selectedTripId,
          entry_type: entryType,
          title: selectedPlace.name,
          notes: notes.trim() || undefined,
          link: url,
          place: placeInput,
        },
        {
          onSuccess: async () => {
            Analytics.shareCompleted({
              provider: detectProviderFromUrl(url) ?? 'tiktok',
              entryType,
              tripId: selectedTripId,
            });
            // Clear App Group storage after successful save to prevent data loss
            // if app had crashed before this point
            if (source === 'share_extension') {
              await completeAppGroupShare(url);
            }
            // Mark save as completed AFTER all async work finishes
            // so unmount cleanup doesn't run prematurely
            setSaveCompleted(true);
            onComplete(selectedTripId ?? undefined);
          },
          onError: (err) => {
            const message = err instanceof Error ? err.message : 'Failed to save entry';
            console.error('createEntry error:', err);
            Alert.alert('Save Failed', message);
            Analytics.shareFailed({
              provider: detectProviderFromUrl(url) ?? 'tiktok',
              error: message,
              stage: 'save',
            });
          },
        }
      );
      return;
    }

    if (!ingestResult) return;

    saveToTrip.mutate(
      {
        trip_id: selectedTripId,
        provider: ingestResult.provider,
        canonical_url: ingestResult.canonical_url,
        thumbnail_url: ingestResult.thumbnail_url,
        author_handle: ingestResult.author_handle,
        title: ingestResult.title,
        place: selectedPlaceToDetectedPlace(selectedPlace),
        entry_type: entryType,
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: async () => {
          Analytics.shareCompleted({
            provider: ingestResult.provider,
            entryType,
            tripId: selectedTripId,
          });
          // Clear App Group storage after successful save to prevent data loss
          // if app had crashed before this point
          if (source === 'share_extension') {
            await completeAppGroupShare(url);
          }
          // Mark save as completed AFTER all async work finishes
          // so unmount cleanup doesn't run prematurely
          setSaveCompleted(true);
          onComplete(selectedTripId ?? undefined);
        },
        onError: (err) => {
          const message = err instanceof Error ? err.message : 'Failed to save entry';
          console.error('saveToTrip error:', err);
          Alert.alert('Save Failed', message);
          Analytics.shareFailed({
            provider: ingestResult.provider,
            error: message,
            stage: 'save',
          });
        },
      }
    );
  }, [
    selectedPlace,
    selectedTripId,
    isManualEntryMode,
    createEntry,
    entryType,
    notes,
    url,
    source,
    onComplete,
    ingestResult,
    saveToTrip,
  ]);

  const handleRetry = useCallback(() => {
    setError(null);
    socialIngest.mutate(
      { url, caption },
      {
        onSuccess: (result) => {
          setIngestResult(result);

          if (result.detected_place) {
            setSelectedPlace(detectedPlaceToSelectedPlace(result.detected_place));
            const inferredType = inferEntryTypeFromPlaceTypes(
              result.detected_place.primary_type,
              result.detected_place.types ?? []
            );
            setEntryType(inferredType);
          }
        },
        onError: (err) => {
          const message = err instanceof Error ? err.message : 'Failed to process URL';
          setError(message);
          Analytics.shareFailed({ provider: 'unknown', error: message, stage: 'ingest' });
        },
      }
    );
  }, [socialIngest, url, caption]);

  const handleManualEntry = useCallback(() => {
    const detectedProvider = detectProviderFromUrl(url);
    setIngestResult({
      provider: detectedProvider ?? 'tiktok',
      canonical_url: url,
      thumbnail_url: null,
      author_handle: null,
      title: null,
      detected_place: null,
      detected_country: null,
    });
    setIsManualEntryMode(true);
    setError(null);
  }, [url]);

  const handleSaveForLater = useCallback(async () => {
    const queueSource = source === 'share_extension' ? 'share_extension' : 'clipboard';
    await enqueueFailedShare({
      url,
      source: queueSource,
      createdAt: Date.now(),
      error: error ?? 'User chose to save for later',
    });
    Analytics.shareQueued({ url, reason: 'offline' });
    Alert.alert('Saved for Later', "We'll process this link when you're back online.", [
      { text: 'OK', onPress: onComplete },
    ]);
  }, [url, source, error, onComplete]);

  return {
    // State
    ingestResult,
    selectedPlace,
    selectedTripId,
    entryType,
    hasSelectedType,
    notes,
    isCreatingTrip,
    isManualEntryMode,
    error,
    isLoading: socialIngest.isPending && !ingestResult,
    isSaving: saveToTrip.isPending || createEntry.isPending,
    userClearedPlace,

    // Handlers
    handleTypeSelect,
    handleChangeType,
    handlePlaceSelect,
    handleCreateTrip,
    handleSave,
    handleRetry,
    handleManualEntry,
    handleSaveForLater,
    setNotes,
    setSelectedTripId,
  };
}
