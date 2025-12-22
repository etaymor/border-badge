/**
 * Custom hook for ShareCaptureScreen state management and handlers.
 * Extracts all business logic from the screen component.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import type { EntryType } from '@navigation/types';
import { useSocialIngest, useSaveToTrip, SocialIngestResponse } from '@hooks/useSocialIngest';
import { useCreateTrip, useTrips, Trip } from '@hooks/useTrips';
import { useCreateEntry, PlaceInput } from '@hooks/useEntries';
import type { SelectedPlace } from '@components/places';
import { Analytics } from '@services/analytics';
import { enqueueFailedShare, QueuedShare } from '@services/shareQueue';
import { api } from '@services/api';

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
  onComplete: () => void;
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
  handleQueueRetry: (share: QueuedShare) => Promise<boolean>;
  setNotes: (notes: string) => void;
  setSelectedTripId: (id: string | null) => void;
}

/**
 * Find matching trips for a country code, sorted by most recent.
 */
function findMatchingTrips(trips: Trip[], countryCode: string | null | undefined): Trip[] {
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

  // Auto-select matching trip
  useEffect(() => {
    if (selectedTripId || trips.length === 0) return;

    const matchingTrips = findMatchingTrips(trips, ingestResult?.detected_place?.country_code);
    if (matchingTrips.length > 0) {
      setSelectedTripId(matchingTrips[0].id);
    }
  }, [ingestResult?.detected_place?.country_code, trips, selectedTripId]);

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

      if (place?.country_code && trips.length > 0) {
        const matchingTrips = findMatchingTrips(trips, place.country_code);
        setSelectedTripId(matchingTrips.length > 0 ? matchingTrips[0].id : null);
      }
    },
    [trips]
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
          onSuccess: () => {
            Analytics.shareCompleted({
              provider: detectProviderFromUrl(url) ?? 'tiktok',
              entryType,
              tripId: selectedTripId,
            });
            onComplete();
          },
          onError: (err) => {
            const message = err instanceof Error ? err.message : 'Failed to save entry';
            console.error('createEntry error:', err);
            Alert.alert('Save Failed', message);
            Analytics.shareFailed({
              provider: detectProviderFromUrl(url) ?? 'tiktok',
              entryType,
              tripId: selectedTripId,
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
        onSuccess: () => {
          Analytics.shareCompleted({
            provider: ingestResult.provider,
            entryType,
            tripId: selectedTripId,
          });
          onComplete();
        },
        onError: (err) => {
          const message = err instanceof Error ? err.message : 'Failed to save entry';
          console.error('saveToTrip error:', err);
          Alert.alert('Save Failed', message);
          Analytics.shareFailed({
            provider: ingestResult.provider,
            entryType,
            tripId: selectedTripId,
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
    onComplete,
    ingestResult,
    saveToTrip,
  ]);

  const handleRetry = useCallback(() => {
    setError(null);
    socialIngest.mutate({ url, caption });
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
      error: error ?? 'Saved for later',
    });
    Analytics.shareQueued({ url, reason: 'offline' });
    Alert.alert('Saved for Later', "We'll process this link when you're back online.", [
      { text: 'OK', onPress: onComplete },
    ]);
  }, [url, source, error, onComplete]);

  const handleQueueRetry = useCallback(async (share: QueuedShare): Promise<boolean> => {
    try {
      const response = await api.post('/ingest/social', { url: share.url });
      return response.status === 200;
    } catch {
      return false;
    }
  }, []);

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

    // Handlers
    handleTypeSelect,
    handleChangeType,
    handlePlaceSelect,
    handleCreateTrip,
    handleSave,
    handleRetry,
    handleManualEntry,
    handleSaveForLater,
    handleQueueRetry,
    setNotes,
    setSelectedTripId,
  };
}
