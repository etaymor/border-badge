/**
 * PhotoClusterCard - Displays a photo cluster without place suggestions.
 *
 * Shows photos with hero image style matching PlaceSuggestionCard,
 * plus an "Add Entry Manually" button. Supports swipe-left-to-dismiss.
 */

import { useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import type { LocationClusterDisplay } from '@services/photoImport';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { styles } from '../photoImportStyles';

export interface PhotoClusterCardProps {
  cluster: LocationClusterDisplay;
  onAddEntry: (cluster: LocationClusterDisplay) => void;
  onPhotoPress: (uri: string) => void;
  onDismiss?: (clusterId: string) => void;
}

export function PhotoClusterCard({
  cluster,
  onAddEntry,
  onPhotoPress,
  onDismiss,
}: PhotoClusterCardProps) {
  const swipeableRef = useRef<Swipeable>(null);

  const renderRightActions = (
    progress: Animated.AnimatedInterpolation<number>,
    _dragX: Animated.AnimatedInterpolation<number>
  ) => {
    const scale = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [0.8, 1],
      extrapolate: 'clamp',
    });

    return (
      <View style={localStyles.swipeActionContainer}>
        <Animated.View style={[localStyles.swipeAction, { transform: [{ scale }] }]}>
          <Ionicons name="close-circle" size={28} color={colors.white} />
          <Text style={localStyles.swipeActionText}>Skip</Text>
        </Animated.View>
      </View>
    );
  };

  const handleSwipeOpen = () => {
    if (onDismiss) {
      onDismiss(cluster.id);
    }
  };

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      onSwipeableOpen={handleSwipeOpen}
      friction={2}
      rightThreshold={80}
      overshootRight={false}
    >
      <View style={styles.suggestionCard}>
        {/* Hero Image - matching PlaceSuggestionCard style */}
        <View style={styles.suggestionHeroContainer}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => onPhotoPress(cluster.previewUris[0])}
            style={{ flex: 1 }}
          >
            <Image
              source={{ uri: cluster.previewUris[0] }}
              style={styles.suggestionHeroImage}
              contentFit="cover"
              transition={200}
              recyclingKey={cluster.previewUris[0]}
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
          <TouchableOpacity
            style={localStyles.addManuallyButton}
            onPress={() => onAddEntry(cluster)}
          >
            <Ionicons name="add" size={18} color={colors.midnightNavy} />
            <Text style={localStyles.addManuallyText}>Add Manually</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Swipeable>
  );
}

const localStyles = StyleSheet.create({
  swipeActionContainer: {
    width: 100,
    backgroundColor: colors.adobeBrick,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24, // Matches suggestionCard marginBottom
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
  },
  swipeAction: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  swipeActionText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
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
