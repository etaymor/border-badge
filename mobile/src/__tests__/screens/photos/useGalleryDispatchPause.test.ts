/**
 * The gallery must not compete with vision preparation for the serial native
 * image queue — and must not leave the import paused when it closes.
 */

import { renderHook } from '@testing-library/react-native';

import { useGalleryDispatchPause } from '../../../screens/photos/useGalleryDispatchPause';
import { suggestionDispatch } from '../../../services/photoImport/suggestionDispatch';

describe('useGalleryDispatchPause', () => {
  beforeEach(() => {
    suggestionDispatch.resetForTests();
  });

  it('pauses while open and releases on close', () => {
    const { rerender } = renderHook(({ open }) => useGalleryDispatchPause(open), {
      initialProps: { open: false },
    });
    expect(suggestionDispatch.getState().isPaused).toBe(false);

    rerender({ open: true });
    expect(suggestionDispatch.getState().isPaused).toBe(true);

    rerender({ open: false });
    expect(suggestionDispatch.getState().isPaused).toBe(false);
  });

  it('releases when the screen unmounts with the gallery still open', () => {
    const { unmount } = renderHook(() => useGalleryDispatchPause(true));
    expect(suggestionDispatch.getState().isPaused).toBe(true);

    unmount();
    expect(suggestionDispatch.getState().isPaused).toBe(false);
  });

  it('leaves a backgrounded import paused after the gallery closes', () => {
    suggestionDispatch.pause('lifecycle');
    const { rerender } = renderHook(({ open }) => useGalleryDispatchPause(open), {
      initialProps: { open: true },
    });

    rerender({ open: false });

    // The app is still in the background: closing the gallery released only the
    // gallery's own hold.
    expect(suggestionDispatch.getState().isPaused).toBe(true);
  });
});
