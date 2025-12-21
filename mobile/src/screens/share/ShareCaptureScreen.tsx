/**
 * ShareCaptureScreen - Main UI for saving places from TikTok/Instagram.
 *
 * Flow:
 * 1. Receive URL from clipboard/share extension
 * 2. Call /ingest/social to process URL and detect place
 * 3. Show thumbnail, let user confirm/edit place
 * 4. Select trip and entry type
 * 5. Save to trip via /ingest/save-to-trip
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import type { PassportStackScreenProps, EntryType } from '@navigation/types';
import {
  useSocialIngest,
  useSaveToTrip,
  DetectedPlace,
  SocialIngestResponse,
  SocialProvider,
} from '@hooks/useSocialIngest';
import { useCreateTrip, useTrips } from '@hooks/useTrips';
import { PlacesAutocomplete, SelectedPlace } from '@components/places';
import { CategorySelector } from '@components/entries';
import { GlassBackButton, GlassInput, Button } from '@components/ui';
import { TripSelector } from '@components/share/TripSelector';
import { PendingSharesBanner } from '@components/share/PendingSharesBanner';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { Analytics } from '@services/analytics';
import { enqueueFailedShare, QueuedShare } from '@services/shareQueue';
import { api } from '@services/api';

type Props = PassportStackScreenProps<'ShareCapture'>;

// Provider badge colors
const PROVIDER_COLORS = {
  tiktok: '#000000',
  instagram: '#E1306C',
};

// Detect provider from URL for loading state
function detectProviderFromUrl(url: string): SocialProvider | null {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('tiktok.com') || lowerUrl.includes('vm.tiktok')) {
    return 'tiktok';
  }
  if (lowerUrl.includes('instagram.com')) {
    return 'instagram';
  }
  return null;
}

// Get display name for provider
function getProviderDisplayName(provider: SocialProvider | null): string {
  if (provider === 'tiktok') return 'TikTok';
  if (provider === 'instagram') return 'Instagram';
  return 'the link';
}

// Infer entry type from Google Places type
// See: https://developers.google.com/maps/documentation/places/web-service/place-types
function inferEntryTypeFromPlaceTypes(
  primaryType: string | null,
  types: string[]
): EntryType {
  const allTypes = primaryType ? [primaryType, ...types] : types;
  const typesLower = allTypes.map((t) => t.toLowerCase());

  // Food-related types
  const foodTypes = [
    'restaurant',
    'cafe',
    'bakery',
    'bar',
    'coffee_shop',
    'fast_food_restaurant',
    'ice_cream_shop',
    'meal_takeaway',
    'meal_delivery',
    'food',
    'pizza_restaurant',
    'steak_house',
    'sushi_restaurant',
    'seafood_restaurant',
    'brunch_restaurant',
    'breakfast_restaurant',
    'sandwich_shop',
    'hamburger_restaurant',
    'ramen_restaurant',
  ];
  if (typesLower.some((t) => foodTypes.some((ft) => t.includes(ft)))) {
    return 'food';
  }

  // Stay-related types
  const stayTypes = [
    'hotel',
    'lodging',
    'motel',
    'hostel',
    'resort_hotel',
    'bed_and_breakfast',
    'guest_house',
    'campground',
    'rv_park',
    'extended_stay_hotel',
  ];
  if (typesLower.some((t) => stayTypes.some((st) => t.includes(st)))) {
    return 'stay';
  }

  // Experience-related types (activities, attractions, entertainment)
  const experienceTypes = [
    'tourist_attraction',
    'amusement_park',
    'aquarium',
    'art_gallery',
    'museum',
    'zoo',
    'night_club',
    'bowling_alley',
    'casino',
    'movie_theater',
    'spa',
    'gym',
    'stadium',
    'concert_hall',
    'performing_arts_theater',
    'hiking_area',
    'ski_resort',
    'golf_course',
    'marina',
    'adventure_sports_center',
  ];
  if (typesLower.some((t) => experienceTypes.some((et) => t.includes(et)))) {
    return 'experience';
  }

  // Default to 'place' for general locations (landmarks, parks, etc.)
  return 'place';
}

// Error details helper for user-friendly messages
interface ErrorDetails {
  title: string;
  message: string;
  canRetry: boolean;
  isOffline: boolean;
  showManualEntry: boolean;
}

function getErrorDetails(error: string): ErrorDetails {
  const lowerError = error.toLowerCase();

  // Network/connection errors
  if (
    lowerError.includes('network') ||
    lowerError.includes('timeout') ||
    lowerError.includes('fetch') ||
    lowerError.includes('econnrefused') ||
    lowerError.includes('no internet')
  ) {
    return {
      title: 'Connection Error',
      message: 'Check your internet connection and try again, or save for later.',
      canRetry: true,
      isOffline: true,
      showManualEntry: false,
    };
  }

  // Rate limiting
  if (
    lowerError.includes('rate limit') ||
    lowerError.includes('429') ||
    lowerError.includes('too many')
  ) {
    return {
      title: 'Too Many Requests',
      message: 'Please wait a moment before trying again.',
      canRetry: true,
      isOffline: false,
      showManualEntry: false,
    };
  }

  // Provider-specific errors - allow manual entry
  if (lowerError.includes('tiktok') && lowerError.includes('unavailable')) {
    return {
      title: 'TikTok Unavailable',
      message: "We couldn't fetch details from TikTok. You can still add the place manually.",
      canRetry: false,
      isOffline: false,
      showManualEntry: true,
    };
  }

  if (lowerError.includes('instagram') && lowerError.includes('unavailable')) {
    return {
      title: 'Instagram Unavailable',
      message: "We couldn't fetch details from Instagram. You can still add the place manually.",
      canRetry: false,
      isOffline: false,
      showManualEntry: true,
    };
  }

  // Invalid URL
  if (lowerError.includes('invalid') && lowerError.includes('url')) {
    return {
      title: 'Invalid Link',
      message: 'This link format is not supported. Please share a TikTok or Instagram video URL.',
      canRetry: false,
      isOffline: false,
      showManualEntry: false,
    };
  }

  // Unsupported provider
  if (lowerError.includes('unsupported') || lowerError.includes('provider')) {
    return {
      title: 'Unsupported Link',
      message: 'Currently we only support TikTok and Instagram links.',
      canRetry: false,
      isOffline: false,
      showManualEntry: false,
    };
  }

  // Generic fallback - allow manual entry as a fallback option
  return {
    title: "Couldn't Process Link",
    message: error,
    canRetry: true,
    isOffline: false,
    showManualEntry: true,
  };
}

export function ShareCaptureScreen({ route, navigation }: Props) {
  const { url, caption, source } = route.params;
  const insets = useSafeAreaInsets();

  // Mutations
  const socialIngest = useSocialIngest();
  const saveToTrip = useSaveToTrip();
  const createTrip = useCreateTrip();

  // Trips data for auto-selection
  const { data: trips = [] } = useTrips();

  // Screen state
  const [ingestResult, setIngestResult] = useState<SocialIngestResponse | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<SelectedPlace | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [entryType, setEntryType] = useState<EntryType>('place');
  const [hasSelectedType, setHasSelectedType] = useState(true);
  const [notes, setNotes] = useState('');
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [isCreatingTrip, setIsCreatingTrip] = useState(false);
  const [isManualEntryMode, setIsManualEntryMode] = useState(false);

  // Error state
  const [error, setError] = useState<string | null>(null);

  // Process URL on mount
  useEffect(() => {
    Analytics.shareStarted({ source: source ?? 'unknown', url });

    socialIngest.mutate(
      { url, caption },
      {
        onSuccess: (result) => {
          setIngestResult(result);

          // Pre-fill place if detected
          if (result.detected_place) {
            setSelectedPlace(detectedPlaceToSelectedPlace(result.detected_place));

            // Auto-select entry type based on place type
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
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-select matching trip when ingest result or trips change
  useEffect(() => {
    // Skip if user already selected a trip or no trips available
    if (selectedTripId || trips.length === 0) return;

    const detectedCountryCode = ingestResult?.detected_place?.country_code;

    // Only auto-select if we have a detected country
    if (detectedCountryCode) {
      // Find trips matching the detected country, sorted by most recent
      const matchingTrips = trips
        .filter((t) => t.country_code === detectedCountryCode)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      if (matchingTrips.length > 0) {
        setSelectedTripId(matchingTrips[0].id);
      }
      // If no matching trips, don't select anything - user will need to create one
    }
    // If no detected country, don't auto-select - let user choose
  }, [ingestResult?.detected_place?.country_code, trips, selectedTripId]);

  // Convert backend DetectedPlace to mobile SelectedPlace format
  const detectedPlaceToSelectedPlace = (place: DetectedPlace): SelectedPlace => ({
    google_place_id: place.google_place_id ?? `detected_${Date.now()}`,
    name: place.name,
    address: place.address,
    latitude: place.latitude,
    longitude: place.longitude,
    google_photo_url: null,
    website_url: null,
  });

  // Convert mobile SelectedPlace back to DetectedPlace for API
  const selectedPlaceToDetectedPlace = (place: SelectedPlace): DetectedPlace => ({
    google_place_id: place.google_place_id,
    name: place.name,
    address: place.address,
    latitude: place.latitude,
    longitude: place.longitude,
    city: null,
    country: null,
    country_code: null,
    confidence: 1.0, // User confirmed
  });

  const handleTypeSelect = useCallback(
    (type: EntryType) => {
      setEntryType(type);
      if (!hasSelectedType) {
        setHasSelectedType(true);
      }
    },
    [hasSelectedType]
  );

  const handleChangeType = useCallback(() => {
    setHasSelectedType(false);
  }, []);

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
        throw err; // Re-throw so caller knows it failed
      } finally {
        setIsCreatingTrip(false);
      }
    },
    [createTrip, ingestResult?.provider]
  );

  const handleSave = useCallback(async () => {
    if (!ingestResult) return;

    // Validation
    if (!selectedPlace) {
      Alert.alert('Location Required', 'Please select or search for a location.');
      return;
    }

    if (!selectedTripId) {
      Alert.alert('Trip Required', 'Please select or create a trip.');
      return;
    }

    saveToTrip.mutate(
      {
        saved_source_id: ingestResult.saved_source_id,
        trip_id: selectedTripId,
        place: selectedPlaceToDetectedPlace(selectedPlace),
        entry_type: entryType,
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: () => {
          Analytics.shareCompleted({
            provider: ingestResult.provider,
            entryType: entryType,
            tripId: selectedTripId,
          });
          navigation.goBack();
        },
      }
    );
  }, [ingestResult, selectedPlace, selectedTripId, entryType, notes, saveToTrip, navigation]);

  const handleRetry = useCallback(() => {
    setError(null);
    socialIngest.mutate({ url, caption });
  }, [socialIngest, url, caption]);

  const handleManualEntry = useCallback(() => {
    // Create a minimal ingest result to allow manual entry
    const detectedProvider = detectProviderFromUrl(url);
    setIngestResult({
      saved_source_id: `manual_${Date.now()}`, // Temporary ID for manual entries
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
    // Map ShareCaptureSource to ShareSource (deep_link falls back to clipboard)
    const queueSource = source === 'share_extension' ? 'share_extension' : 'clipboard';
    await enqueueFailedShare({
      url,
      source: queueSource,
      createdAt: Date.now(),
      error: error ?? 'Saved for later',
    });
    Analytics.shareQueued({ url, reason: 'offline' });
    Alert.alert('Saved for Later', "We'll process this link when you're back online.", [
      { text: 'OK', onPress: () => navigation.goBack() },
    ]);
  }, [url, source, error, navigation]);

  // Retry function for pending shares banner
  const handleQueueRetry = useCallback(async (share: QueuedShare): Promise<boolean> => {
    try {
      const response = await api.post('/ingest/social', { url: share.url });
      // If successful, the share will be removed from queue by the banner
      return response.status === 200;
    } catch {
      return false;
    }
  }, []);

  // Loading state
  if (socialIngest.isPending && !ingestResult) {
    const detectedProvider = detectProviderFromUrl(url);
    const providerName = getProviderDisplayName(detectedProvider);
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.sunsetGold} />
        <Text style={styles.loadingText}>Fetching details from {providerName}...</Text>
      </View>
    );
  }

  // Error state
  if (error && !ingestResult) {
    const errorDetails = getErrorDetails(error);
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <View style={styles.errorContainer}>
          <Ionicons
            name={errorDetails.isOffline ? 'cloud-offline-outline' : 'alert-circle-outline'}
            size={48}
            color={errorDetails.isOffline ? colors.midnightNavy : colors.adobeBrick}
          />
          <Text style={styles.errorTitle}>{errorDetails.title}</Text>
          <Text style={styles.errorMessage}>{errorDetails.message}</Text>
          <View style={styles.errorActions}>
            {errorDetails.canRetry && <Button title="Try Again" onPress={handleRetry} />}
            {errorDetails.showManualEntry && (
              <Button title="Enter Manually" onPress={handleManualEntry} variant="secondary" />
            )}
            {errorDetails.isOffline && (
              <Button title="Save for Later" onPress={handleSaveForLater} variant="secondary" />
            )}
            <TouchableOpacity style={styles.cancelLink} onPress={() => navigation.goBack()}>
              <Text style={styles.cancelLinkText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // Main content
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <GlassBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>Save Place</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          scrollEnabled={scrollEnabled}
        >
          {/* Pending Shares Banner */}
          <PendingSharesBanner retryFn={handleQueueRetry} />

          {/* Thumbnail Card */}
          {ingestResult && (
            <View style={styles.thumbnailCard}>
              {ingestResult.thumbnail_url ? (
                <Image
                  source={{ uri: ingestResult.thumbnail_url }}
                  style={styles.thumbnail}
                  resizeMode="cover"
                />
              ) : (
                <LinearGradient
                  colors={[colors.lakeBlue, colors.mossGreen]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.thumbnailPlaceholder}
                >
                  <Ionicons name="videocam" size={32} color={colors.white} />
                </LinearGradient>
              )}
              <View style={styles.thumbnailOverlay}>
                {/* Provider Badge */}
                <View
                  style={[
                    styles.providerBadge,
                    { backgroundColor: PROVIDER_COLORS[ingestResult.provider] },
                  ]}
                >
                  <Ionicons
                    name={ingestResult.provider === 'tiktok' ? 'musical-notes' : 'camera'}
                    size={12}
                    color={colors.white}
                  />
                  <Text style={styles.providerText}>
                    {ingestResult.provider === 'tiktok' ? 'TikTok' : 'Instagram'}
                  </Text>
                </View>
              </View>
              {/* Title and Author */}
              <View style={styles.thumbnailInfo}>
                {ingestResult.title && (
                  <Text style={styles.videoTitle} numberOfLines={2}>
                    {ingestResult.title}
                  </Text>
                )}
                {ingestResult.author_handle && (
                  <Text style={styles.authorHandle}>@{ingestResult.author_handle}</Text>
                )}
              </View>
            </View>
          )}

          {/* Manual Entry Mode Banner */}
          {isManualEntryMode && !ingestResult?.detected_place && (
            <View style={styles.manualEntryBanner}>
              <Ionicons name="search-outline" size={16} color={colors.sunsetGold} />
              <Text style={styles.manualEntryText}>
                Search for the place below to save it to your trip.
              </Text>
            </View>
          )}

          {/* Location Section */}
          <View style={[styles.section, { zIndex: 2000 }]}>
            <Text style={styles.sectionLabel}>CONFIRM LOCATION</Text>
            <PlacesAutocomplete
              value={selectedPlace}
              onSelect={setSelectedPlace}
              placeholder="Search for a place..."
              countryCode={ingestResult?.detected_place?.country_code ?? undefined}
              onDropdownOpen={(isOpen) => setScrollEnabled(!isOpen)}
            />
          </View>

          {/* Trip Section */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>SAVE TO TRIP</Text>
            <TripSelector
              selectedTripId={selectedTripId}
              onSelectTrip={setSelectedTripId}
              countryCode={ingestResult?.detected_place?.country_code ?? undefined}
              onCreateTrip={handleCreateTrip}
              isCreatingTrip={isCreatingTrip}
            />
          </View>

          {/* Entry Type Section */}
          <CategorySelector
            entryType={entryType}
            hasSelectedType={hasSelectedType}
            onTypeSelect={handleTypeSelect}
            onChangeType={handleChangeType}
          />

          {/* Notes Section */}
          <View style={styles.section}>
            <GlassInput
              label="NOTES (OPTIONAL)"
              placeholder="Why did this catch your eye?"
              value={notes}
              onChangeText={setNotes}
              multiline
            />
          </View>

          {/* Save Button */}
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
            <Button
              title="Save to Trip"
              onPress={handleSave}
              loading={saveToTrip.isPending}
              disabled={saveToTrip.isPending || !selectedPlace || !selectedTripId}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.warmCream,
    paddingHorizontal: 24,
  },

  // Loading
  loadingText: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
    marginTop: 20,
    textAlign: 'center',
  },

  // Error
  errorContainer: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  errorTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
    marginTop: 16,
    marginBottom: 8,
  },
  errorMessage: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  errorActions: {
    width: '100%',
    gap: 12,
  },
  cancelLink: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelLinkText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.stormGray,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    zIndex: 3000,
  },
  headerTitle: {
    flex: 1,
    fontFamily: fonts.playfair.bold,
    fontSize: 24,
    color: colors.midnightNavy,
    textAlign: 'center',
    lineHeight: 44,
  },
  headerSpacer: {
    width: 44,
  },

  // Scroll
  keyboardAvoid: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },

  // Thumbnail Card
  thumbnailCard: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.paperBeige,
    marginBottom: 16,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  thumbnail: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  thumbnailPlaceholder: {
    width: '100%',
    aspectRatio: 16 / 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnailOverlay: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
  },
  providerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 4,
  },
  providerText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 11,
    color: colors.white,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  thumbnailInfo: {
    padding: 16,
  },
  videoTitle: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 15,
    color: colors.midnightNavy,
    lineHeight: 22,
    marginBottom: 4,
  },
  authorHandle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.stormGray,
  },

  // Manual Entry Banner
  manualEntryBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(218, 165, 32, 0.1)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 20,
    gap: 8,
  },
  manualEntryText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.midnightNavy,
    flex: 1,
  },

  // Sections
  section: {
    marginBottom: 24,
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

  // Footer
  footer: {
    paddingTop: 16,
  },
});

export default ShareCaptureScreen;
