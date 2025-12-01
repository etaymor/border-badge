import React, { useCallback, useMemo } from 'react';
import { GestureResponderEvent, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { getFlagEmoji } from '@utils/flags';

interface CountryGridItemProps {
  code: string;
  name: string;
  isSelected: boolean;
  isWishlisted: boolean;
  onToggleVisited: () => void;
  onToggleWishlist: () => void;
}

// Custom comparison to prevent re-renders from new function references
function arePropsEqual(prevProps: CountryGridItemProps, nextProps: CountryGridItemProps): boolean {
  return (
    prevProps.code === nextProps.code &&
    prevProps.name === nextProps.name &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isWishlisted === nextProps.isWishlisted
  );
  // Intentionally ignore function props - they should be stable via useCallback in parent
}

export const CountryGridItem = React.memo(function CountryGridItem({
  code,
  name,
  isSelected,
  isWishlisted,
  onToggleVisited,
  onToggleWishlist,
}: CountryGridItemProps) {
  // Memoize flag emoji calculation
  const flagEmoji = useMemo(() => getFlagEmoji(code), [code]);

  // Memoize star button press handler to avoid new function reference each render
  const handleStarPress = useCallback(
    (e: GestureResponderEvent) => {
      e.stopPropagation?.();
      onToggleWishlist();
    },
    [onToggleWishlist]
  );

  return (
    <TouchableOpacity
      style={[styles.container, isSelected && styles.containerSelected]}
      onPress={onToggleVisited}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${isSelected ? 'visited' : 'not visited'}`}
      accessibilityHint="Double tap to toggle visited status"
    >
      {/* Grey placeholder for country illustration */}
      <View style={styles.illustrationPlaceholder}>
        <Text style={styles.flagEmoji}>{flagEmoji}</Text>
      </View>

      <Text style={styles.countryName} numberOfLines={2}>
        {name}
      </Text>

      {/* Wishlist star button */}
      <TouchableOpacity
        style={[styles.starButton, isWishlisted && styles.starButtonActive]}
        onPress={handleStarPress}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={`${isWishlisted ? 'Remove from' : 'Add to'} wishlist`}
      >
        <Text style={styles.starIcon}>{isWishlisted ? '★' : '☆'}</Text>
      </TouchableOpacity>

      {/* Selected checkmark */}
      {isSelected && (
        <View style={styles.checkmark}>
          <Text style={styles.checkmarkText}>✓</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}, arePropsEqual);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    margin: 4,
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    padding: 8,
    alignItems: 'center',
    minHeight: 120,
    position: 'relative',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  containerSelected: {
    borderColor: '#007AFF',
    backgroundColor: '#E8F4FF',
  },
  illustrationPlaceholder: {
    width: 60,
    height: 60,
    backgroundColor: '#E5E5EA',
    borderRadius: 8,
    marginBottom: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  flagEmoji: {
    fontSize: 28,
  },
  countryName: {
    fontSize: 12,
    fontWeight: '500',
    color: '#1a1a1a',
    textAlign: 'center',
  },
  starButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  starButtonActive: {
    backgroundColor: '#FFD700',
  },
  starIcon: {
    fontSize: 14,
    color: '#666',
  },
  checkmark: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmarkText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: 'bold',
  },
});
