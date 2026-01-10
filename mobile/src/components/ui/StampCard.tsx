import React, { useMemo } from 'react';
import { Image, StyleSheet, TouchableOpacity, View, ViewStyle } from 'react-native';

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
      <Image source={stampImage} style={styles.stampImage} resizeMode="contain" />
      {hasTrips && (
        <View style={styles.tripsIndicator} testID={`stamp-card-trips-${code}`}>
          <Image source={quillIcon} style={styles.tripsIcon} />
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
  },
  stampImage: {
    width: '100%',
    height: '100%',
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
