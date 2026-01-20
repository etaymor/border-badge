/**
 * PhotoClusterCard - Displays a photo cluster without place suggestions.
 *
 * Shows photos with an "Add Entry" button for manual entry creation.
 * Supports swipe-left-to-dismiss.
 */

import { useRef } from 'react';
import { Animated, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import type { LocationClusterDisplay } from '@services/photoImport';
import { colors } from '@constants/colors';
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
        {/* Photo thumbnails */}
        <ScrollView
          horizontal
          style={styles.suggestionPhotos}
          showsHorizontalScrollIndicator={false}
        >
          {cluster.previewUris.slice(0, 5).map((uri, index) => (
            <TouchableOpacity key={`thumb-${index}`} onPress={() => onPhotoPress(uri)}>
              <Image source={{ uri }} style={styles.suggestionThumbnail} contentFit="cover" />
            </TouchableOpacity>
          ))}
          {cluster.photoCount > 5 && (
            <View style={styles.clusterMorePhotos}>
              <Text style={styles.clusterMorePhotosText}>+{cluster.photoCount - 5}</Text>
            </View>
          )}
        </ScrollView>

        {/* No suggestions message */}
        <View style={styles.clusterInfo}>
          <Text style={styles.clusterNoSuggestions}>No place suggestions found</Text>
          <Text style={styles.clusterPhotoCount}>
            {cluster.photoCount} photo{cluster.photoCount !== 1 ? 's' : ''} at this location
          </Text>
        </View>

        {/* Add entry button */}
        <TouchableOpacity style={styles.clusterAddButton} onPress={() => onAddEntry(cluster)}>
          <Ionicons name="add-circle-outline" size={20} color={colors.sunsetGold} />
          <Text style={styles.clusterAddButtonText}>Add Entry Manually</Text>
        </TouchableOpacity>
      </View>
    </Swipeable>
  );
}

const localStyles = StyleSheet.create({
  swipeActionContainer: {
    flex: 1,
    backgroundColor: colors.adobeBrick,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
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
});
