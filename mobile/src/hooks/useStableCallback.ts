/**
 * useStableCallback - a callback with a permanently stable identity that always
 * dispatches to the LATEST implementation.
 *
 * Usage:
 * const stableOnPress = useStableCallback(handlePress);
 *
 * List screens cache per-id, zero-arg callbacks in a ref-held `Map` so each row
 * receives the SAME function identity on every parent render and the row's
 * `React.memo` holds (tapping one card no longer re-renders its siblings). Those
 * cached callbacks are created once, so whatever they close over must never go
 * stale — this hook is that indirection.
 *
 * The ref is synced in an effect, never during render. Writing `ref.current = fn`
 * in the render body is a Rules of React violation (render must be pure); the
 * React Compiler is free to memoize around it and can hand back a callback bound
 * to a stale `fn`.
 *
 * Timing: because the sync runs in `useEffect`, a call made in the same commit
 * *before* effects flush would still see the previous `fn`. That is the same
 * trade-off React's own `useEffectEvent` makes, and it is safe here: these are
 * user-tap handlers (navigation, mutations), which fire long after commit. Do
 * not use this for a callback invoked synchronously during render or layout.
 */

import { useCallback, useEffect, useRef } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useStableCallback<T extends (...args: any[]) => any>(fn: T): T {
  const fnRef = useRef(fn);

  useEffect(() => {
    fnRef.current = fn;
  });

  return useCallback(((...args: Parameters<T>): ReturnType<T> => fnRef.current(...args)) as T, []);
}
