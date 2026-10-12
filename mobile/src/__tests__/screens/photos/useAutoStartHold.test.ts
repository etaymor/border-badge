/**
 * What the photo import screen holds on screen while an auto-start is pending.
 *
 * Bug: opening PhotoImport with `autoStart` (Photo Trips / Passport "check for
 * new photos") flickered through three different UIs before the scan settled —
 * the idle stamp collage (while `lastImportTime` was still loading), then the
 * cream "Preparing... / Checking for New Photos" view (once it loaded), then
 * the navy scan stage. The hold below replaces both interim views: a pending
 * auto-start shows the scan stage it is about to start, so idle -> scanning is
 * one continuous view. It never depends on `lastImportTime`.
 */

import { renderHook } from '@testing-library/react-native';

import { useAutoStartHold, type UseAutoStartHoldOptions } from '@screens/photos/useAutoStartHold';

const base: UseAutoStartHoldOptions = {
  autoStart: true,
  skipToSuggestions: false,
  homeCountry: 'US',
  phase: 'idle',
  permissionUi: 'none',
  permissionReady: true,
};

function renderHold(initial: Partial<UseAutoStartHoldOptions> = {}) {
  return renderHook((props: UseAutoStartHoldOptions) => useAutoStartHold(props), {
    initialProps: { ...base, ...initial },
  });
}

describe('useAutoStartHold', () => {
  it('holds the scan stage from first render through the scan starting', () => {
    const { result, rerender } = renderHold({ permissionReady: false });

    // Permission status still loading: a bare navy stage, since the carousel
    // may yet replace it. Never the stamp collage or the cream Preparing view.
    expect(result.current).toBe('stage');

    rerender({ ...base });
    expect(result.current).toBe('scan');

    rerender({ ...base, phase: 'scanning' });
    expect(result.current).toBe('scan');
  });

  it('releases the hold once the auto-start has left idle, so a cancel shows the real idle', () => {
    const { result, rerender } = renderHold();
    rerender({ ...base, phase: 'scanning' });
    rerender({ ...base, phase: 'idle' });

    expect(result.current).toBe('none');
  });

  it('holds a plain loading view when auto-start goes straight to cached suggestions', () => {
    const { result, rerender } = renderHold({ skipToSuggestions: true });
    expect(result.current).toBe('loading');

    rerender({ ...base, skipToSuggestions: true, phase: 'suggestions' });
    rerender({ ...base, skipToSuggestions: true, phase: 'idle' });
    expect(result.current).toBe('none');
  });

  it('keeps the scan hold after a carousel grant hands back to the auto-start', () => {
    const { result, rerender } = renderHold();
    rerender({ ...base, permissionUi: 'preheat' });
    expect(result.current).toBe('none');

    // Granted: the carousel closes and useAutoStartWorkflow starts the scan on
    // the next effect pass. The idle stage must not flash in between.
    rerender({ ...base, permissionUi: 'none' });
    expect(result.current).toBe('scan');
  });

  it('does not hold when there is no auto-start, or it can never run', () => {
    expect(renderHold({ autoStart: false }).result.current).toBe('none');
    expect(renderHold({ autoStart: undefined }).result.current).toBe('none');
    // useAutoStartWorkflow needs a home country unless skipping to suggestions.
    expect(renderHold({ homeCountry: null }).result.current).toBe('none');
  });
});
