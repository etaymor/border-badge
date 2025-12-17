import React, { useMemo } from 'react';
import { Dimensions, Image, StyleSheet, TouchableOpacity, View, ViewStyle } from 'react-native';

import { getStampImage } from '../../assets/stampImages';
import quillIcon from '../../../assets/quill-icon.png';

const { width: screenWidth } = Dimensions.get('window');
const STAMP_MARGIN = 8;
const STAMP_PADDING = 16;
// 2 stamps per row with margins between and padding on sides
const STAMP_SIZE = (screenWidth - STAMP_PADDING * 2 - STAMP_MARGIN) / 2;

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
    width: STAMP_SIZE,
    height: STAMP_SIZE,
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
