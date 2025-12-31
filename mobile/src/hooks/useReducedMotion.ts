/**
 * useReducedMotion - Hook for respecting user's reduce motion accessibility preference
 *
 * Checks the device's accessibility settings for the "Reduce Motion" preference.
 * This is a WCAG 2.1 Level AA requirement for users with vestibular disorders
 * or motion sensitivity.
 *
 * Usage:
 * const reduceMotion = useReducedMotion();
 * if (!reduceMotion) {
 *   // Play animations
 * }
 *
 * @see https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions
 * @see https://reactnative.dev/docs/accessibilityinfo
 */

import { AccessibilityInfo } from 'react-native';
import { useEffect, useState } from 'react';

/**
 * Hook to detect if the user has enabled "Reduce Motion" in their accessibility settings.
 * When true, animations should be disabled or simplified to prevent discomfort for users
 * with vestibular disorders or motion sensitivity.
 *
 * @returns {boolean} True if reduce motion is enabled, false otherwise
 */
export function useReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    // Get initial value
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => {
        // If the API fails, default to false (animations enabled)
        // This ensures the app continues to work even if accessibility API fails
        setReduceMotion(false);
      });

    // Listen for changes
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);

    // Cleanup listener on unmount
    return () => {
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}
