import React, { useCallback, useMemo } from 'react';
import {
  GestureResponderEvent,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { getFlagEmoji } from '@utils/flags';

export interface CountryCardProps {
  /** ISO 3166-1 alpha-2 country code (e.g., "US", "FR") */
  code: string;
  /** Country display name */
  name: string;
  /** Country region for display context */
  region?: string;
  /** Optional image URL for future implementation */
  imageUrl?: string;
  /** Whether the country is already visited */
  isVisited?: boolean;
  /** Whether the country is in the wishlist */
  isWishlisted?: boolean;
  /** Handler when card body is pressed - navigates to CountryDetail */
  onPress: () => void;
  /** Handler for plus button - marks as visited */
  onAddVisited: () => void;
  /** Handler for heart button - adds to wishlist */
  onToggleWishlist: () => void;
  /** Optional custom container style */
  style?: ViewStyle;
  /** Test ID for testing purposes */
  testID?: string;
}

function arePropsEqual(prevProps: CountryCardProps, nextProps: CountryCardProps): boolean {
  return (
    prevProps.code === nextProps.code &&
    prevProps.name === nextProps.name &&
    prevProps.region === nextProps.region &&
    prevProps.imageUrl === nextProps.imageUrl &&
    prevProps.isVisited === nextProps.isVisited &&
    prevProps.isWishlisted === nextProps.isWishlisted
  );
}

export const CountryCard = React.memo(function CountryCard({
  code,
  name,
  region,
  isVisited = false,
  isWishlisted = false,
  onPress,
  onAddVisited,
  onToggleWishlist,
  style,
  testID,
}: CountryCardProps) {
  const flagEmoji = useMemo(() => getFlagEmoji(code), [code]);

  const handleAddVisitedPress = useCallback(
    (e: GestureResponderEvent) => {
      e.stopPropagation?.();
      onAddVisited();
    },
    [onAddVisited]
  );

  const handleWishlistPress = useCallback(
    (e: GestureResponderEvent) => {
      e.stopPropagation?.();
      onToggleWishlist();
    },
    [onToggleWishlist]
  );

  return (
    <TouchableOpacity
      style={[styles.container, style]}
      onPress={onPress}
      activeOpacity={0.9}
      accessibilityRole="button"
      accessibilityLabel={`${name}, tap to view details`}
      testID={testID || `country-card-${code}`}
    >
      {/* Image Placeholder */}
      <View style={styles.imagePlaceholder}>
        <Ionicons name="image-outline" size={48} color="#A0A0A5" />
      </View>

      {/* Flag Badge - Top Left */}
      <View style={styles.flagContainer}>
        <Text style={styles.flagEmoji}>{flagEmoji}</Text>
      </View>

      {/* Action Buttons - Top Right */}
      <View style={styles.actionsContainer}>
        {/* Plus Button - Add to Visited */}
        <TouchableOpacity
          style={[styles.actionButton, isVisited && styles.actionButtonVisited]}
          onPress={handleAddVisitedPress}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={isVisited ? 'Already visited' : 'Mark as visited'}
          testID={`country-card-visited-${code}`}
        >
          <Ionicons
            name={isVisited ? 'checkmark' : 'add'}
            size={24}
            color={isVisited ? '#fff' : '#2E7D32'}
          />
        </TouchableOpacity>

        {/* Heart Button - Add to Wishlist */}
        <TouchableOpacity
          style={[styles.actionButton, isWishlisted && styles.actionButtonWishlisted]}
          onPress={handleWishlistPress}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
          testID={`country-card-wishlist-${code}`}
        >
          <Ionicons
            name={isWishlisted ? 'heart' : 'heart-outline'}
            size={22}
            color={isWishlisted ? '#B8860B' : '#999'}
          />
        </TouchableOpacity>
      </View>

      {/* Country Name Label - Bottom Left */}
      <View style={styles.nameContainer}>
        <Text style={styles.countryName} numberOfLines={1}>
          {name}
        </Text>
        {region && (
          <Text style={styles.regionName} numberOfLines={1}>
            {region}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}, arePropsEqual);

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#E5E5EA',
    height: 200,
    position: 'relative',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#D1D1D6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  flagContainer: {
    position: 'absolute',
    top: 12,
    left: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  flagEmoji: {
    fontSize: 22,
  },
  nameContainer: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 60,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  countryName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  regionName: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  actionsContainer: {
    position: 'absolute',
    top: 12,
    right: 12,
    gap: 8,
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  actionButtonVisited: {
    backgroundColor: '#2E7D32',
  },
  actionButtonWishlisted: {
    backgroundColor: '#FFD700',
  },
});
