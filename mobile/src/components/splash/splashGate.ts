/**
 * Splash gate: lets screens under the animated splash hold their entrance
 * until the splash starts to dissolve.
 *
 * The first onboarding screen mounts underneath `AnimatedSplash`, so any
 * entrance it plays on mount happens while nobody can see it. `AnimatedSplash`
 * marks the gate open when its fade begins (with a backstop in `App` once the
 * splash unmounts), and screens read it through `useSplashDone()`.
 *
 * One module-level flag backs every subscriber, the same shape as
 * `useReducedMotion`. The gate only ever opens; it never closes again.
 */

import { useSyncExternalStore } from 'react';

let splashDone = false;
const subscribers = new Set<() => void>();

function subscribe(notify: () => void): () => void {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}

function getSnapshot(): boolean {
  return splashDone;
}

/** Open the gate. Safe to call more than once. */
export function markSplashDone(): void {
  if (splashDone) return;
  splashDone = true;
  subscribers.forEach((notify) => notify());
}

/** True once the animated splash has started fading out (or never ran). */
export function useSplashDone(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Test-only: close the gate again. */
export function __resetSplashGateForTests(): void {
  splashDone = false;
}
