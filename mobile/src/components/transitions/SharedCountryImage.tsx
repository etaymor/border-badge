/**
 * SharedCountryImage - Shared element wrapper for country flags/stamps
 *
 * Wraps country images (flags or stamps) with Transition.View to enable
 * smooth shared element transitions between passport grid and country detail.
 *
 * Usage:
 * - In PassportScreen: <SharedCountryImage countryId="US">...</SharedCountryImage>
 * - In CountryDetailScreen: <SharedCountryImage countryId="US">...</SharedCountryImage>
 *
 * The matching countryId ensures the transition system can morph between the two elements.
 */

import React, { type ReactNode } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Transition from 'react-native-screen-transitions';

/**
 * Generate a consistent shared element tag for country images
 */
export function getCountrySharedTag(countryId: string): string {
  return `country-${countryId}`;
}

interface SharedCountryImageProps {
  /** ISO country code (e.g., "US", "FR", "JP") */
  countryId: string;
  /** Content to render inside the shared element wrapper */
  children: ReactNode;
  /** Optional style to apply to the wrapper */
  style?: StyleProp<ViewStyle>;
  /** Optional test ID for testing */
  testID?: string;
}

/**
 * Wrapper component that enables shared element transitions for country images.
 * Use the same countryId on both source and destination screens.
 */
export function SharedCountryImage({
  countryId,
  children,
  style,
  testID,
}: SharedCountryImageProps) {
  const sharedTag = getCountrySharedTag(countryId);

  return (
    <Transition.View sharedBoundTag={sharedTag} style={style} testID={testID}>
      {children}
    </Transition.View>
  );
}

/**
 * Pressable variant for interactive country elements (e.g., in passport grid)
 * Automatically includes shared element tag for seamless transitions
 */
interface SharedCountryPressableProps extends SharedCountryImageProps {
  /** Handler for press events */
  onPress?: () => void;
  /** Handler for long press events */
  onLongPress?: () => void;
  /** Handler for press in events (for animations) */
  onPressIn?: () => void;
  /** Handler for press out events (for animations) */
  onPressOut?: () => void;
  /** Accessibility role for the pressable element */
  accessibilityRole?: 'button' | 'link' | 'none';
  /** Accessibility label for screen readers */
  accessibilityLabel?: string;
}

export function SharedCountryPressable({
  countryId,
  children,
  style,
  testID,
  onPress,
  onLongPress,
  onPressIn,
  onPressOut,
  accessibilityRole,
  accessibilityLabel,
}: SharedCountryPressableProps) {
  const sharedTag = getCountrySharedTag(countryId);

  return (
    <Transition.Pressable
      sharedBoundTag={sharedTag}
      style={style}
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </Transition.Pressable>
  );
}
