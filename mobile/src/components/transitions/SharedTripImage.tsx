/**
 * SharedTripImage - Shared element wrapper for trip cover images
 *
 * Wraps trip cover images/thumbnails with Transition.View to enable
 * smooth shared element transitions between trip list and trip detail.
 *
 * Usage:
 * - In TripCard: <SharedTripImage tripId="123">...</SharedTripImage>
 * - In TripDetailScreen: <SharedTripImage tripId="123">...</SharedTripImage>
 *
 * The matching tripId ensures the transition system can morph between the two elements.
 */

import React, { type ReactNode } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Transition from 'react-native-screen-transitions';

/**
 * Generate a consistent shared element tag for trip images
 */
export function getTripSharedTag(tripId: string): string {
  return `trip-${tripId}`;
}

interface SharedTripImageProps {
  /** Trip ID (UUID) */
  tripId: string;
  /** Content to render inside the shared element wrapper */
  children: ReactNode;
  /** Optional style to apply to the wrapper */
  style?: StyleProp<ViewStyle>;
  /** Optional test ID for testing */
  testID?: string;
}

/**
 * Wrapper component that enables shared element transitions for trip images.
 * Use the same tripId on both source and destination screens.
 */
export function SharedTripImage({ tripId, children, style, testID }: SharedTripImageProps) {
  const sharedTag = getTripSharedTag(tripId);

  return (
    <Transition.View sharedBoundTag={sharedTag} style={style} testID={testID}>
      {children}
    </Transition.View>
  );
}

/**
 * Pressable variant for interactive trip elements (e.g., in trip list)
 * Automatically includes shared element tag for seamless transitions
 */
interface SharedTripPressableProps extends SharedTripImageProps {
  /** Handler for press events */
  onPress?: () => void;
  /** Handler for long press events */
  onLongPress?: () => void;
  /** Accessibility role for the pressable element */
  accessibilityRole?: 'button' | 'link' | 'none';
  /** Accessibility label for screen readers */
  accessibilityLabel?: string;
  /** Handler for press in events (for animations) */
  onPressIn?: () => void;
  /** Handler for press out events (for animations) */
  onPressOut?: () => void;
}

export function SharedTripPressable({
  tripId,
  children,
  style,
  testID,
  onPress,
  onLongPress,
  accessibilityRole,
  accessibilityLabel,
  onPressIn,
  onPressOut,
}: SharedTripPressableProps) {
  const sharedTag = getTripSharedTag(tripId);

  return (
    <Transition.Pressable
      sharedBoundTag={sharedTag}
      style={style}
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
    >
      {children}
    </Transition.Pressable>
  );
}
