import { act, renderHook } from '@testing-library/react-native';

import {
  __resetSplashGateForTests,
  markSplashDone,
  useSplashDone,
} from '@components/splash/splashGate';

describe('splashGate', () => {
  afterEach(() => __resetSplashGateForTests());

  it('starts closed and opens once the splash is marked done', () => {
    const { result } = renderHook(() => useSplashDone());
    expect(result.current).toBe(false);
    act(() => markSplashDone());
    expect(result.current).toBe(true);
  });

  it('is idempotent', () => {
    markSplashDone();
    markSplashDone();
    const { result } = renderHook(() => useSplashDone());
    expect(result.current).toBe(true);
  });
});
