/**
 * Bound a native call that may never settle.
 *
 * Over a `ph://` asset whose pixels live only in iCloud ("Optimize iPhone
 * Storage"), native calls such as `Image.getSize`, `manipulateAsync`,
 * `getAssetInfoAsync` and `copyAsync` can hang without ever calling back — not a
 * rejection, so a surrounding `catch` never runs and the caller waits forever.
 *
 * Races `work` against a watchdog timer and, when a `signal` is given, against
 * its abort, so Cancel settles the caller immediately instead of waiting on a
 * call nothing can interrupt. Both lose with a rejection rather than a null so
 * callers route them through their existing failure path. Pass `ms: null` for
 * abort-only racing (work that carries its own timeouts). The abandoned promise
 * is left to settle whenever the native layer gets to it; nothing reads it.
 */
export function withNativeTimeout<T>(
  work: Promise<T>,
  label: string,
  ms: number | null,
  signal?: AbortSignal
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(new Error(`${label} aborted`));
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  const guard = new Promise<never>((_resolve, reject) => {
    if (ms !== null) {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }
    if (signal) {
      onAbort = () => reject(new Error(`${label} aborted`));
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });

  return Promise.race([work, guard]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  });
}
