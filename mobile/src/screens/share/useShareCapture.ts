/**
 * Custom hook for ShareCaptureScreen state management and handlers.
 * Extracts all business logic from the screen component.
 *
 * Supports both single-place and multi-place extraction flows.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import type { EntryType } from '@navigation/types';
import {
  useSocialIngest,
  useSaveToTrip,
  useSavePlaces,
  SocialIngestResponse,
} from '@hooks/useSocialIngest';
import { useCreateTrip, useTrips, useUncategorizedTrip, Trip } from '@hooks/useTrips';
import { useCreateEntry, PlaceInput } from '@hooks/useEntries';
import type { SelectedPlace, PlaceSelection } from '@components/places';
import { Analytics } from '@services/analytics';
import { enqueueFailedShare } from '@services/shareQueue';
import { completeAppGroupShare } from '@services/shareExtensionBridge';

import {
  detectProviderFromUrl,
  inferEntryTypeFromPlaceTypes,
  detectedPlaceToSelectedPlace,
  selectedPlaceToDetectedPlace,
  createSelectionsFromPlaces,
  getSelectedPlacesToSave,
  placesSpanMultipleCountries,
} from './shareCaptureUtils';
import {
  useSubscriptionStore,
  useIsPremium,
  useCanUseShareExtension,
} from '@stores/subscriptionStore';

interface UseShareCaptureParams {
  url: string;
  caption?: string;
  source?: string;
  onComplete: (tripId?: string) => void;
}

export interface ShareCaptureState {
  ingestResult: SocialIngestResponse | null;
  // Single-place mode (backward compat)
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
  // Multi-place mode
  isMultiPlaceMode: boolean; // True when 2+ places detected
  isMultiCountry: boolean; // True when places span multiple countries
  placeSelections: Record<string, PlaceSelection>; // Selection state per place
  selectedPlaceCount: number; // Count of selected places
  // Premium gating
  isPremium: boolean;
  canSave: boolean; // True if user has remaining saves or is premium
}

export interface ShareCaptureHandlers {
  // Single-place handlers
  handleTypeSelect: (type: EntryType) => void;
  handleChangeType: () => void;
  handlePlaceSelect: (place: SelectedPlace | null) => void;
  // Multi-place handlers
  handleTogglePlace: (placeKey: string) => void;
  handleEditPlace: (placeKey: string) => void;
  handleUpdatePlace: (placeKey: string, place: SelectedPlace) => void;
  handlePlaceEntryTypeChange: (placeKey: string, entryType: EntryType) => void;
  // Common handlers
  handleCreateTrip: (name: string, countryCode: string) => Promise<string>;
  handleSave: () => Promise<void>;
  handleRetry: () => void;
  handleManualEntry: () => void;
  handleSaveForLater: () => Promise<void>;
  setNotes: (notes: string) => void;
  setSelectedTripId: (id: string | null) => void;
  // Premium gating - returns false if paywall should be shown
  checkCanSave: () => boolean;
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
  const savePlaces = useSavePlaces();
  const createTrip = useCreateTrip();
  const createEntry = useCreateEntry();

  // Trips data
  const { data: trips = [] } = useTrips();
  const { data: uncategorizedTrip } = useUncategorizedTrip();

  // State - single place mode (backward compat)
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

  // State - multi-place mode
  const [placeSelections, setPlaceSelections] = useState<Record<string, PlaceSelection>>({});

  // Computed - multi-place mode detection
  const isMultiPlaceMode = Object.keys(placeSelections).length > 1;
  const selectedPlaceCount = Object.values(placeSelections).filter((s) => s.isSelected).length;

  // Premium subscription state
  const isPremium = useIsPremium();
  const canSave = useCanUseShareExtension();
  const incrementShareUsage = useSubscriptionStore((s) => s.incrementShareExtensionUsage);

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

          // Check for multi-place extraction (2+ places)
          if (result.detected_places && result.detected_places.length > 1) {
            // Multi-place mode: create selections from all places
            const selections = createSelectionsFromPlaces(result.detected_places);
            setPlaceSelections(selections);
            // Also set first place for backward compat and country detection
            setSelectedPlace(detectedPlaceToSelectedPlace(result.detected_places[0]));
          } else if (result.detected_place) {
            // Single-place mode (backward compat)
            setSelectedPlace(detectedPlaceToSelectedPlace(result.detected_place));
            // Prefer LLM entry type, fall back to Google types inference
            const inferredType =
              (result.detected_place.llm_entry_type as EntryType) ??
              inferEntryTypeFromPlaceTypes(
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

  // Computed: check if multi-place selections span multiple countries
  const isMultiCountry = isMultiPlaceMode && placesSpanMultipleCountries(placeSelections);

  // Auto-select trip: prioritize country-specific trip, then fall back to "Saved Places"
  // For multi-country places, always use "Saved Places"
  // This effect runs whenever trips, uncategorizedTrip, or ingestResult changes
  useEffect(() => {
    // Don't override user's selection
    if (selectedTripId) {
      console.log('[useShareCapture] Skipping - already have selection');
      return;
    }

    // Multi-country places should default to "Saved Places" trip
    if (isMultiCountry) {
      if (uncategorizedTrip?.id) {
        console.log('[useShareCapture] Multi-country detected - selecting Saved Places');
        setSelectedTripId(uncategorizedTrip.id);
      }
      return;
    }

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
      isMultiCountry,
    });

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
    isMultiCountry,
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
    if (!selectedTripId) {
      Alert.alert('Trip Required', 'Please select or create a trip.');
      return;
    }

    // Multi-place mode: use batch save
    if (isMultiPlaceMode) {
      const placesToSave = getSelectedPlacesToSave(placeSelections);
      if (placesToSave.length === 0) {
        Alert.alert('No Places Selected', 'Please select at least one place to save.');
        return;
      }

      if (!ingestResult) return;

      savePlaces.mutate(
        {
          trip_id: selectedTripId,
          places: placesToSave,
          provider: ingestResult.provider,
          canonical_url: ingestResult.canonical_url,
          thumbnail_url: ingestResult.thumbnail_url,
          author_handle: ingestResult.author_handle,
          title: ingestResult.title,
          notes: notes.trim() || undefined,
        },
        {
          onSuccess: async (response) => {
            // Track analytics
            Analytics.shareCompleted({
              provider: ingestResult.provider,
              entryType: 'place', // Multi-place has mixed types
              tripId: selectedTripId,
            });

            // Increment share extension usage for free users
            if (!isPremium) {
              incrementShareUsage();
            }

            // Show result message for partial success or skipped items
            const totalAttempted = response.saved_count + response.skipped_count;
            if (response.skipped_count > 0) {
              const skippedNames =
                response.skipped_place_names?.slice(0, 3).join(', ') || 'some places';
              const moreCount =
                response.skipped_count > 3 ? ` and ${response.skipped_count - 3} more` : '';

              if (response.saved_count === 0) {
                // All places were skipped (likely all duplicates)
                Alert.alert(
                  'Already Saved',
                  `These places are already in your trip: ${skippedNames}${moreCount}`
                );
              } else {
                // Partial success - show "X of Y saved"
                Alert.alert(
                  'Saved',
                  `${response.saved_count} of ${totalAttempted} places saved. Skipped: ${skippedNames}${moreCount}`
                );
              }
            }

            // Clear App Group storage
            if (source === 'share_extension') {
              await completeAppGroupShare(url);
            }

            setSaveCompleted(true);
            onComplete(selectedTripId ?? undefined);
          },
          onError: (err) => {
            const message = err instanceof Error ? err.message : 'Failed to save places';
            console.error('savePlaces error:', err);
            Alert.alert('Save Failed', message);
            Analytics.shareFailed({
              provider: ingestResult.provider,
              error: message,
              stage: 'save',
            });
          },
        }
      );
      return;
    }

    // Single-place mode (original flow)
    if (!selectedPlace) {
      Alert.alert('Location Required', 'Please select or search for a location.');
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
            // Increment share extension usage for free users
            if (!isPremium) {
              incrementShareUsage();
            }
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
          // Increment share extension usage for free users
          if (!isPremium) {
            incrementShareUsage();
          }
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
    isMultiPlaceMode,
    placeSelections,
    createEntry,
    entryType,
    notes,
    url,
    source,
    onComplete,
    ingestResult,
    saveToTrip,
    savePlaces,
    isPremium,
    incrementShareUsage,
  ]);

  const handleRetry = useCallback(() => {
    setError(null);
    setPlaceSelections({}); // Reset multi-place state
    socialIngest.mutate(
      { url, caption },
      {
        onSuccess: (result) => {
          setIngestResult(result);

          // Check for multi-place extraction
          if (result.detected_places && result.detected_places.length > 1) {
            const selections = createSelectionsFromPlaces(result.detected_places);
            setPlaceSelections(selections);
            setSelectedPlace(detectedPlaceToSelectedPlace(result.detected_places[0]));
          } else if (result.detected_place) {
            setSelectedPlace(detectedPlaceToSelectedPlace(result.detected_place));
            const inferredType =
              (result.detected_place.llm_entry_type as EntryType) ??
              inferEntryTypeFromPlaceTypes(
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

  // Multi-place handlers
  const handleTogglePlace = useCallback((placeKey: string) => {
    setPlaceSelections((prev) => {
      if (!prev[placeKey]) return prev;
      return {
        ...prev,
        [placeKey]: { ...prev[placeKey], isSelected: !prev[placeKey].isSelected },
      };
    });
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleEditPlace = useCallback((_placeKey: string) => {
    // TODO: Implement place editing - show location search modal and call handleUpdatePlace
    // setEditingPlaceKey(placeKey);
    // For Phase 1, edit is not implemented
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleUpdatePlace = useCallback((_placeKey: string, _place: SelectedPlace) => {
    // TODO: Implement place updating - called after user selects new place in search modal
    // For Phase 1, edit is not implemented
  }, []);

  const handlePlaceEntryTypeChange = useCallback((placeKey: string, newEntryType: EntryType) => {
    setPlaceSelections((prev) => {
      if (!prev[placeKey]) return prev;
      return {
        ...prev,
        [placeKey]: { ...prev[placeKey], entryType: newEntryType },
      };
    });
  }, []);

  const handleManualEntry = useCallback(() => {
    const detectedProvider = detectProviderFromUrl(url);
    setIngestResult({
      provider: detectedProvider ?? 'tiktok',
      canonical_url: url,
      thumbnail_url: null,
      author_handle: null,
      title: null,
      detected_places: [],
      detected_place: null,
      detected_country: null,
    });
    setPlaceSelections({}); // Reset multi-place state
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

  // Check if user can save (for gating UI)
  const checkCanSave = useCallback(() => canSave, [canSave]);

  return {
    // State - single place
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
    isSaving: saveToTrip.isPending || createEntry.isPending || savePlaces.isPending,
    userClearedPlace,
    // State - multi-place
    isMultiPlaceMode,
    isMultiCountry,
    placeSelections,
    selectedPlaceCount,
    // Premium gating
    isPremium,
    canSave,

    // Single-place handlers
    handleTypeSelect,
    handleChangeType,
    handlePlaceSelect,
    // Multi-place handlers
    handleTogglePlace,
    handleEditPlace,
    handleUpdatePlace,
    handlePlaceEntryTypeChange,
    // Common handlers
    handleCreateTrip,
    handleSave,
    handleRetry,
    handleManualEntry,
    handleSaveForLater,
    setNotes,
    setSelectedTripId,
    checkCanSave,
  };
}
