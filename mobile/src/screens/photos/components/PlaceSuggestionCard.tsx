/**
 * PlaceSuggestionCard - Displays a place suggestion with photo previews
 * and confirm/reject actions.
 */

import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import type { ClusterSuggestion, PlaceSuggestion } from '@services/photoImport';
import { colors } from '@constants/colors';
import { styles } from '../photoImportStyles';

export interface PlaceSuggestionCardProps {
  suggestion: ClusterSuggestion;
  previewUris: string[];
  onConfirm: (suggestion: ClusterSuggestion, place: PlaceSuggestion) => void;
  onReject: (suggestion: ClusterSuggestion) => void;
  onPhotoPress: (uri: string) => void;
}

export function PlaceSuggestionCard({
  suggestion,
  previewUris,
  onConfirm,
  onReject,
  onPhotoPress,
}: PlaceSuggestionCardProps) {
  const topPlace = suggestion.places[0];
  if (!topPlace) return null;

  return (
    <View style={styles.suggestionCard}>
      {/* Photo thumbnails - uses previewUris instead of full photos array */}
      <ScrollView horizontal style={styles.suggestionPhotos} showsHorizontalScrollIndicator={false}>
        {previewUris.slice(0, 5).map((uri, index) => (
          <TouchableOpacity key={`thumb-${index}`} onPress={() => onPhotoPress(uri)}>
            <Image source={{ uri }} style={styles.suggestionThumbnail} contentFit="cover" />
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
          onPress={() => onReject(suggestion)}
        >
          <Ionicons name="close" size={24} color={colors.adobeBrick} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.confirmButton]}
          onPress={() => onConfirm(suggestion, topPlace)}
        >
          <Ionicons name="checkmark" size={24} color={colors.success} />
        </TouchableOpacity>
      </View>
    </View>
  );
}
