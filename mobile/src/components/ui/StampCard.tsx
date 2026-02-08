import React, { useMemo } from 'react';
import { Image as RNImage, StyleSheet, TouchableOpacity, View, ViewStyle } from 'react-native';
import { Image } from 'expo-image';

import { getStampImage } from '../../assets/stampImages';
import quillIcon from '../../../assets/quill-icon.png';

// Note: StampCard uses flex:1 + aspectRatio:1 instead of fixed dimensions
// This allows it to work properly with AnimatedCardWrapper's flex:1 style
// and prevents layout conflicts during FlatList virtualization

export interface StampCardProps {
  /** ISO 3166-1 alpha-2 country code (e.g., "US", "FR") */
  code: string;
  /** Whether the country has any trips logged */
  hasTrips?: boolean;
  /** Handler when stamp is pressed - navigates to CountryDetail */
  onPress: () => void;
  /** Optional custom container style */
  style?: ViewStyle;
  /** Test ID for testing purposes */
  testID?: string;
}

export const StampCard = React.memo(function StampCard({
  code,
  hasTrips = false,
  onPress,
  style,
  testID,
}: StampCardProps) {
  const stampImage = useMemo(() => getStampImage(code), [code]);

  // Deterministic rotation based on country code for organic feel
  // Range: -5deg to +5deg (Reduced from +/- 9deg)
  const rotation = useMemo(() => {
    const hash = code.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const angle = (hash % 11) - 5;
    return `${angle}deg`;
  }, [code]);

  if (!stampImage) {
    return null;
  }

  return (
    <TouchableOpacity
      style={[styles.container, style]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`View ${code} country details`}
      testID={testID || `stamp-card-${code}`}
    >
      <Image
        source={stampImage}
        style={[styles.stampImage, { transform: [{ rotate: rotation }] }]}
        contentFit="contain"
        recyclingKey={code}
      />
      {hasTrips && (
        <View style={styles.tripsIndicator} testID={`stamp-card-trips-${code}`}>
          <RNImage source={quillIcon} style={styles.tripsIcon} />
        </View>
      )}
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    aspectRatio: 1, // Square stamps
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stampImage: {
    width: '92%',
    height: '92%',
  },
  tripsIndicator: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 38,
    height: 38,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tripsIcon: {
    width: 38,
    height: 38,
    resizeMode: 'contain',
  },
});
