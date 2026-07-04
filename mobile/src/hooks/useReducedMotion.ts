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
 * Performance: A single module-level cache + ONE shared `AccessibilityInfo`
 * listener backs every subscriber. Previously each hook instance did its own
 * async `isReduceMotionEnabled()` round-trip and registered its own native
 * `reduceMotionChanged` listener — with ~200 country cards on screen that meant
 * ~200 async calls and ~200 native listeners. Now the first subscriber lazily
 * resolves the initial value and attaches the single listener; the last
 * subscriber to unmount tears it down. Updates fan out to all subscribers via
 * `useSyncExternalStore`, which keeps the hook's boolean return API identical.
 *
 * @see https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions
 * @see https://reactnative.dev/docs/accessibilityinfo
 */

import { AccessibilityInfo, type EmitterSubscription } from 'react-native';
import { useSyncExternalStore } from 'react';

// Module-level cached value shared by every subscriber.
let cachedReduceMotion = false;
// Whether we've resolved the initial async value at least once.
let hasResolvedInitial = false;
// The single native listener subscription (lazily attached).
let nativeSubscription: EmitterSubscription | null = null;
// All React subscribers' notify callbacks.
const subscribers = new Set<() => void>();

function notifyAll(): void {
  subscribers.forEach((notify) => notify());
}

function setCachedValue(value: boolean): void {
  if (cachedReduceMotion === value) return;
  cachedReduceMotion = value;
  notifyAll();
}

function attachNativeListenerIfNeeded(): void {
  if (nativeSubscription) return;

  // Attach the single shared native listener.
  nativeSubscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setCachedValue);

  // Resolve the initial value exactly once (async round-trip happens once total,
  // not once per component). Re-resolve when the listener is re-attached after a
  // full teardown so a preference change while unmounted is still reflected.
  if (!hasResolvedInitial || subscribers.size > 0) {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        hasResolvedInitial = true;
        setCachedValue(value);
      })
      .catch(() => {
        // If the API fails, default to false (animations enabled) so the app
        // continues to work even if the accessibility API fails.
        hasResolvedInitial = true;
        setCachedValue(false);
      });
  }
}

function detachNativeListenerIfUnused(): void {
  if (subscribers.size > 0) return;
  if (nativeSubscription) {
    nativeSubscription.remove();
    nativeSubscription = null;
  }
}

function subscribe(notify: () => void): () => void {
  const isFirstSubscriber = subscribers.size === 0;
  subscribers.add(notify);

  if (isFirstSubscriber) {
    attachNativeListenerIfNeeded();
  }

  return () => {
    subscribers.delete(notify);
    detachNativeListenerIfUnused();
  };
}

function getSnapshot(): boolean {
  return cachedReduceMotion;
}

/**
 * Hook to detect if the user has enabled "Reduce Motion" in their accessibility settings.
 * When true, animations should be disabled or simplified to prevent discomfort for users
 * with vestibular disorders or motion sensitivity.
 *
 * @returns {boolean} True if reduce motion is enabled, false otherwise
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}
