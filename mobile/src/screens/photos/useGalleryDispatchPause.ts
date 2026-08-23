/**
 * Hold the suggestion dispatch paused while the photo gallery is open.
 *
 * Vision preparation is native image work — `Image.getSize`, `manipulateAsync`,
 * and for an iCloud-offloaded asset a download — and Expo's async function
 * queue is SERIAL. A 40-location import is a steady stream of that work, so the
 * decode for the photo the user just tapped queues behind it and the gallery
 * takes seconds to appear. The interaction the user is waiting on wins.
 *
 * A pause, never a `reset()`: batches already on the wire keep running and
 * still cache, and the workers park rather than exit, so closing the gallery
 * continues the same plan instead of restarting it. The `gallery` owner is
 * independent of the `lifecycle` one, so backgrounding the app with the gallery
 * open — and foregrounding with it still open — both behave.
 */

import { useEffect } from 'react';

import { suggestionDispatch } from '@services/photoImport/suggestionDispatch';

export function useGalleryDispatchPause(isOpen: boolean): void {
  useEffect(() => {
    if (!isOpen) return;
    suggestionDispatch.pause('gallery');
    // Also covers unmounting with the gallery open (a swipe-back), which would
    // otherwise leave the import paused with nothing left to release it.
    return () => suggestionDispatch.resume('gallery');
  }, [isOpen]);
}
