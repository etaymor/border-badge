import React, { useEffect, useMemo } from 'react';
import {
  Animated,
  Dimensions,
  Image,
  StyleSheet,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';

import { SharedCountryPressable } from '@components/transitions/SharedCountryImage';
import { useAnimatedPress, AnimatedPressPresets } from '@hooks/useAnimatedPress';
import { useBreathingAnimation, BreathingPresets } from '@hooks/useBreathingAnimation';
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
  /** Whether to enable shared element transition */
  enableSharedElement?: boolean;
  /** Whether to enable breathing animation for visited stamps (default: true) */
  enableBreathing?: boolean;
}

export const StampCard = React.memo(function StampCard({
  code,
  hasTrips = false,
  onPress,
  style,
  testID,
  enableSharedElement = true,
  enableBreathing = true,
}: StampCardProps) {
  const stampImage = useMemo(() => getStampImage(code), [code]);

  // Press feedback animation
  const { scaleValue: pressScale, pressHandlers } = useAnimatedPress(AnimatedPressPresets.default);

  // Breathing animation for "alive" feel - only for visited stamps (which have stamp images)
  const { breathingScale, startBreathing, stopBreathing } = useBreathingAnimation(
    BreathingPresets.subtle
  );

  // Start breathing animation when component mounts (stamps are visited countries)
  useEffect(() => {
    if (enableBreathing && stampImage) {
      startBreathing();
    }
    return () => {
      stopBreathing();
    };
  }, [enableBreathing, stampImage, startBreathing, stopBreathing]);

  // Combine press scale and breathing scale - memoize to avoid creating new animated node each render
  const combinedScale = useMemo(
    () => Animated.multiply(pressScale, breathingScale),
    [pressScale, breathingScale]
  );

  if (!stampImage) {
    return null;
  }

  const content = (
    <>
      <Image source={stampImage} style={styles.stampImage} resizeMode="contain" />
      {hasTrips && (
        <View style={styles.tripsIndicator} testID={`stamp-card-trips-${code}`}>
          <Image source={quillIcon} style={styles.tripsIcon} />
        </View>
      )}
    </>
  );

  // Use SharedCountryPressable for shared element transitions
  if (enableSharedElement) {
    return (
      <Animated.View style={{ transform: [{ scale: combinedScale }] }}>
        <SharedCountryPressable
          countryId={code}
          style={[styles.container, style]}
          onPress={onPress}
          onPressIn={pressHandlers.onPressIn}
          onPressOut={pressHandlers.onPressOut}
          testID={testID || `stamp-card-${code}`}
          accessibilityRole="button"
          accessibilityLabel={`View ${code} country details`}
        >
          {content}
        </SharedCountryPressable>
      </Animated.View>
    );
  }

  // Fallback to regular TouchableOpacity with animations
  return (
    <Animated.View style={{ transform: [{ scale: combinedScale }] }}>
      <TouchableOpacity
        style={[styles.container, style]}
        onPress={onPress}
        onPressIn={pressHandlers.onPressIn}
        onPressOut={pressHandlers.onPressOut}
        activeOpacity={1}
        accessibilityRole="button"
        accessibilityLabel={`View ${code} country details`}
        testID={testID || `stamp-card-${code}`}
      >
        {content}
      </TouchableOpacity>
    </Animated.View>
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
