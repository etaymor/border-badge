/**
 * Tests for useStableCallback.
 *
 * The hook backs the per-id stable-callback pattern used by CountryDetailScreen,
 * DreamsScreen, TripsListScreen and TripDetailScreen. Two properties must hold
 * simultaneously, and they are in tension:
 *
 * 1. Identity stability - the returned function NEVER changes identity, so the
 *    zero-arg per-id callbacks that close over it can be cached in a Map and the
 *    child's `React.memo` holds across parent re-renders.
 * 2. Freshness - invoking it always dispatches to the LATEST `fn` passed in, so
 *    a handler whose closure depends on changing state (e.g. DreamsScreen's
 *    wishlist toggle reading `wishlistCountries`) is never stale.
 *
 * A naive `useCallback(fn, [])` satisfies (1) and fails (2). Writing
 * `ref.current = fn` during render satisfies both but violates the Rules of
 * React (render-phase mutation), which the React Compiler may miscompile. The
 * hook syncs the ref in an effect instead.
 */

import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';

import { useStableCallback } from '@hooks/useStableCallback';

describe('useStableCallback', () => {
  it('dispatches to the LATEST fn after a re-render (not the one captured on mount)', () => {
    const first = jest.fn();
    const second = jest.fn();

    const { result, rerender } = renderHook(({ fn }) => useStableCallback(fn), {
      initialProps: { fn: first },
    });

    result.current();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    rerender({ fn: second });

    result.current();
    // Would fail against `useCallback(fn, [])`, which stays bound to `first`.
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('forwards arguments and returns the latest fn result', () => {
    const { result, rerender } = renderHook(
      ({ factor }) => useStableCallback((n: number) => n * factor),
      {
        initialProps: { factor: 2 },
      }
    );

    expect(result.current(3)).toBe(6);

    rerender({ factor: 10 });

    expect(result.current(3)).toBe(30);
  });

  it('keeps a permanently stable identity across many re-renders', () => {
    const { result, rerender } = renderHook(({ fn }: { fn: () => void }) => useStableCallback(fn), {
      initialProps: { fn: jest.fn() as () => void },
    });

    const initialIdentity = result.current;

    for (let i = 0; i < 10; i += 1) {
      rerender({ fn: jest.fn() });
      expect(result.current).toBe(initialIdentity);
    }
  });

  it('sees state updated by an earlier press when pressed again (in a real component)', () => {
    const seen: number[] = [];

    function Probe() {
      const [count, setCount] = useState(0);
      const onPress = useStableCallback(() => {
        seen.push(count);
        setCount((c) => c + 1);
      });

      return (
        <Pressable testID="probe" onPress={onPress}>
          <Text>{count}</Text>
        </Pressable>
      );
    }

    render(<Probe />);

    act(() => {
      fireEvent.press(screen.getByTestId('probe'));
    });
    act(() => {
      fireEvent.press(screen.getByTestId('probe'));
    });
    act(() => {
      fireEvent.press(screen.getByTestId('probe'));
    });

    // A stale closure would record [0, 0, 0].
    expect(seen).toEqual([0, 1, 2]);
  });
});
