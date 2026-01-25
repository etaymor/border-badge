/**
 * TripCandidateCard - Displays a trip candidate with photo previews and metadata.
 * Expands inline to show trip selector when tapped.
 */

import { useCallback, useState } from 'react';
import { ActivityIndicator, LayoutAnimation, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { InlineTripSelector } from '@components/share/InlineTripSelector';
import type { TripCandidateDisplay } from '@services/photoImport';
import { useCountryByCode } from '@hooks/useCountries';
import { colors } from '@constants/colors';
import { getFlagEmoji } from '@utils/flags';
import { styles } from '../photoImportStyles';

export interface TripCandidateCardProps {
  candidate: TripCandidateDisplay;
  /** Called when trip is selected or if trip is already selected (auto-proceed) */
  onSelectTrip: (candidate: TripCandidateDisplay, tripId: string) => Promise<void>;
  /** Called when a new trip is created */
  onCreateTrip: (name: string, countryCode: string) => Promise<string>;
  /** Pre-selected trip ID for auto-proceed */
  selectedTripId: string | null;
  /** Whether suggestions are being loaded */
  isLoadingSuggestions: boolean;
}

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

export function TripCandidateCard({
  candidate,
  onSelectTrip,
  onCreateTrip,
  selectedTripId,
  isLoadingSuggestions,
}: TripCandidateCardProps) {
  const { data: country } = useCountryByCode(candidate.countryCode);
  const flag = getFlagEmoji(candidate.countryCode);
  const countryName = country?.name ?? candidate.countryCode;
  const photoCount = candidate.photoCount;
  // Use pre-computed preview URIs (max 5) instead of slicing full photo array
  const previewUris = candidate.previewUris.slice(0, 4);

  const [isExpanded, setIsExpanded] = useState(false);
  const [isCreatingTrip, setIsCreatingTrip] = useState(false);
  const [pendingTripId, setPendingTripId] = useState<string | null>(null);
  const [isSelectingTrip, setIsSelectingTrip] = useState(false);

  const handleCardPress = useCallback(() => {
    // If a trip is already selected, auto-proceed
    if (selectedTripId) {
      setIsSelectingTrip(true);
      onSelectTrip(candidate, selectedTripId).finally(() => {
        setIsSelectingTrip(false);
      });
      return;
    }

    // Otherwise toggle expansion with animation
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsExpanded(!isExpanded);
  }, [selectedTripId, candidate, onSelectTrip, isExpanded]);

  const handleTripSelect = useCallback(
    async (tripId: string) => {
      setPendingTripId(tripId);
      setIsSelectingTrip(true);
      try {
        await onSelectTrip(candidate, tripId);
      } finally {
        setIsSelectingTrip(false);
      }
    },
    [candidate, onSelectTrip]
  );

  const handleCreateTrip = useCallback(
    async (name: string, countryCode: string): Promise<string> => {
      setIsCreatingTrip(true);
      try {
        const tripId = await onCreateTrip(name, countryCode);
        setPendingTripId(tripId);
        setIsSelectingTrip(true);
        await onSelectTrip(candidate, tripId);
        return tripId;
      } finally {
        setIsCreatingTrip(false);
        setIsSelectingTrip(false);
      }
    },
    [candidate, onCreateTrip, onSelectTrip]
  );

  const isLoading = isSelectingTrip || isLoadingSuggestions;

  return (
    <View style={styles.candidateCard}>
      <TouchableOpacity onPress={handleCardPress} activeOpacity={0.7} disabled={isLoading}>
        {/* Photo preview grid - uses previewUris instead of full photos array */}
        <View style={styles.candidatePhotos}>
          {previewUris.map((uri, index) => (
            <Image
              key={`preview-${index}`}
              source={{ uri }}
              style={[
                styles.candidateThumbnail,
                index === 3 && photoCount > 4 && styles.candidateThumbnailLast,
              ]}
              contentFit="cover"
              transition={200}
              recyclingKey={uri}
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
            <Text style={styles.candidateCountry}>{countryName}</Text>
            <Text style={styles.candidateDates}>
              {formatDateRange(candidate.dateRange.start, candidate.dateRange.end)}
            </Text>
            <Text style={styles.candidatePhotoCount}>{photoCount} photos</Text>
          </View>
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.sunsetGold} />
          ) : (
            <Ionicons
              name={isExpanded ? 'chevron-down' : 'chevron-forward'}
              size={20}
              color={colors.textSecondary}
            />
          )}
        </View>
      </TouchableOpacity>

      {/* Expanded trip selector */}
      {isExpanded && !selectedTripId && (
        <View style={styles.candidateExpanded}>
          <Text style={styles.tripSelectorLabel}>SELECT OR CREATE A TRIP</Text>
          <InlineTripSelector
            selectedTripId={pendingTripId}
            onSelectTrip={handleTripSelect}
            countryCode={candidate.countryCode}
            onCreateTrip={handleCreateTrip}
            isCreatingTrip={isCreatingTrip}
            isSelectingTrip={isSelectingTrip}
          />
        </View>
      )}
    </View>
  );
}
