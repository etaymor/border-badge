/**
 * SharedEntryImage - Shared element wrapper for entry images
 *
 * Wraps entry images with Transition.View to enable smooth shared element
 * transitions between entry grid cards and entry detail views.
 *
 * Usage:
 * - In EntryGridCard: <SharedEntryImage entryId="abc123">...</SharedEntryImage>
 * - In EntryDetailScreen: <SharedEntryImage entryId="abc123">...</SharedEntryImage>
 *
 * The matching entryId ensures the transition system can morph between the two elements.
 */

import React, { type ReactNode } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Transition from 'react-native-screen-transitions';

/**
 * Generate a consistent shared element tag for entry images
 */
export function getEntrySharedTag(entryId: string): string {
  return `entry-${entryId}`;
}

interface SharedEntryImageProps {
  /** Entry ID (UUID) */
  entryId: string;
  /** Content to render inside the shared element wrapper */
  children: ReactNode;
  /** Optional style to apply to the wrapper */
  style?: StyleProp<ViewStyle>;
  /** Optional test ID for testing */
  testID?: string;
}

/**
 * Wrapper component that enables shared element transitions for entry images.
 * Use the same entryId on both source and destination screens.
 */
export function SharedEntryImage({ entryId, children, style, testID }: SharedEntryImageProps) {
  const sharedTag = getEntrySharedTag(entryId);

  return (
    <Transition.View sharedBoundTag={sharedTag} style={style} testID={testID}>
      {children}
    </Transition.View>
  );
}

/**
 * Pressable variant for interactive entry elements (e.g., in entry grid)
 * Automatically includes shared element tag for seamless transitions
 */
interface SharedEntryPressableProps extends SharedEntryImageProps {
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

export function SharedEntryPressable({
  entryId,
  children,
  style,
  testID,
  onPress,
  onLongPress,
  onPressIn,
  onPressOut,
  accessibilityRole,
  accessibilityLabel,
}: SharedEntryPressableProps) {
  const sharedTag = getEntrySharedTag(entryId);

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
