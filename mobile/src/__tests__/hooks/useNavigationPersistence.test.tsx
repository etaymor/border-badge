/**
 * Tests for useNavigationPersistence write debouncing (U11).
 *
 * Rapid navigation should coalesce into ONE AsyncStorage write ~1s after the
 * last state change, instead of one write per change. The restore/read path
 * stays immediate (covered by navigationPersistence util tests).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';
import type { NavigationState } from '@react-navigation/native';
import type { Session } from '@supabase/supabase-js';

import { useNavigationPersistence } from '@hooks/useNavigationPersistence';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

const mockSetItem = AsyncStorage.setItem as jest.Mock;

function makeSession(): Session {
  return { user: { id: 'user-1' } } as unknown as Session;
}

function makeState(routeName: string): NavigationState {
  return {
    key: 'root',
    index: 0,
    routeNames: [routeName],
    type: 'stack',
    stale: false,
    routes: [{ key: `${routeName}-key`, name: routeName }],
  } as unknown as NavigationState;
}

describe('useNavigationPersistence write debounce', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('coalesces rapid navigation into a single debounced write', () => {
    const { result } = renderHook(() => useNavigationPersistence(makeSession()));

    act(() => {
      result.current.handleNavigationStateChange(makeState('A'));
      result.current.handleNavigationStateChange(makeState('B'));
      result.current.handleNavigationStateChange(makeState('C'));
    });

    // No write yet — still within the debounce window.
    expect(mockSetItem).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    // Exactly one write, and it persists the LAST state (C).
    expect(mockSetItem).toHaveBeenCalledTimes(1);
    const [, payload] = mockSetItem.mock.calls[0];
    expect(payload).toContain('"name":"C"');
    expect(payload).not.toContain('"name":"A"');
  });

  it('does not write before the debounce window elapses', () => {
    const { result } = renderHook(() => useNavigationPersistence(makeSession()));

    act(() => {
      result.current.handleNavigationStateChange(makeState('A'));
      jest.advanceTimersByTime(999);
    });

    expect(mockSetItem).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(mockSetItem).toHaveBeenCalledTimes(1);
  });

  it('flushNavigationWrite persists the pending state immediately', () => {
    const { result } = renderHook(() => useNavigationPersistence(makeSession()));

    act(() => {
      result.current.handleNavigationStateChange(makeState('Z'));
    });
    expect(mockSetItem).not.toHaveBeenCalled();

    act(() => {
      result.current.flushNavigationWrite();
    });

    expect(mockSetItem).toHaveBeenCalledTimes(1);
    const [, payload] = mockSetItem.mock.calls[0];
    expect(payload).toContain('"name":"Z"');

    // The pending timer is cleared — no second write when the window elapses.
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(mockSetItem).toHaveBeenCalledTimes(1);
  });
});
