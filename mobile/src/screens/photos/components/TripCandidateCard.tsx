/**
 * TripCandidateCard - Displays a trip candidate with photo previews and metadata.
 */

import { Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import type { TripCandidateDisplay } from '@services/photoImport';
import { colors } from '@constants/colors';
import { getFlagEmoji } from '@utils/flags';
import { styles } from '../photoImportStyles';

export interface TripCandidateCardProps {
  candidate: TripCandidateDisplay;
  onSelect: (candidate: TripCandidateDisplay) => void;
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

export function TripCandidateCard({ candidate, onSelect }: TripCandidateCardProps) {
  const flag = getFlagEmoji(candidate.countryCode);
  const photoCount = candidate.photoCount;
  // Use pre-computed preview URIs (max 5) instead of slicing full photo array
  const previewUris = candidate.previewUris.slice(0, 4);

  return (
    <TouchableOpacity
      style={styles.candidateCard}
      onPress={() => onSelect(candidate)}
      activeOpacity={0.7}
    >
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
          <Text style={styles.candidateCountry}>{candidate.countryCode}</Text>
          <Text style={styles.candidateDates}>
            {formatDateRange(candidate.dateRange.start, candidate.dateRange.end)}
          </Text>
          <Text style={styles.candidatePhotoCount}>{photoCount} photos</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </View>
    </TouchableOpacity>
  );
}
