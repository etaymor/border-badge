/**
 * PhotoClusterCard - Displays a photo cluster without place suggestions.
 *
 * Shows photos with hero image style matching PlaceSuggestionCard,
 * plus an "Add Entry Manually" button. Skipping is handled by the
 * SwipeToSkipCard wrapper in ClusterListItem, not here.
 */

import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { LocationClusterDisplay } from '@services/photoImport';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { styles } from '../photoImportStyles';
import { PhotoThumbnail } from './PhotoThumbnail';

export interface PhotoClusterCardProps {
  cluster: LocationClusterDisplay;
  onAddEntry: (cluster: LocationClusterDisplay) => void;
  onPhotoPress: (uri: string) => void;
}

export function PhotoClusterCard({ cluster, onAddEntry, onPhotoPress }: PhotoClusterCardProps) {
  return (
    <View style={styles.suggestionCard}>
      {/* Hero Image - matching PlaceSuggestionCard style */}
      <View style={styles.suggestionHeroContainer}>
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => onPhotoPress(cluster.previewUris[0])}
          style={{ flex: 1 }}
        >
          <PhotoThumbnail
            uri={cluster.previewUris[0]}
            assetId={cluster.previewAssetIds[0]}
            style={styles.suggestionHeroImage}
            contentFit="cover"
            transition={200}
          />
          {/* Photo count overlay */}
          {cluster.photoCount > 1 && (
            <View style={localStyles.photoCountOverlay}>
              <Text style={localStyles.photoCountText}>+{cluster.photoCount - 1}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Content section */}
      <View style={localStyles.content}>
        <Text style={localStyles.noSuggestionsTitle}>No place found nearby</Text>
        <Text style={localStyles.noSuggestionsSubtitle}>
          {cluster.photoCount} photo{cluster.photoCount !== 1 ? 's' : ''} at this location
        </Text>

        {/* Add entry button - solid pill style */}
        <TouchableOpacity style={localStyles.addManuallyButton} onPress={() => onAddEntry(cluster)}>
          <Ionicons name="add" size={18} color={colors.midnightNavy} />
          <Text style={localStyles.addManuallyText}>Add Manually</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const localStyles = StyleSheet.create({
  content: {
    padding: 16,
  },
  photoCountOverlay: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  photoCountText: {
    fontFamily: fonts.openSans.bold,
    fontSize: 14,
    color: colors.white,
  },
  noSuggestionsTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
    marginBottom: 2,
  },
  noSuggestionsSubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  addManuallyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.sunsetGold,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 24,
  },
  addManuallyText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.midnightNavy,
    marginLeft: 6,
  },
});
