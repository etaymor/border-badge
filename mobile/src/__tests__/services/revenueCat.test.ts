/**
 * Tests for revenueCat.ts logIn promise lifecycle.
 *
 * Covers:
 * - prepareLogIn / settleLogIn / waitForLogIn coordination
 * - Bug: settleLogIn clears logInPromise so late callers get false
 */

// We need to test the actual module, not a mock.
// The module under test has no native dependencies except Purchases,
// which we mock at the RN level.
jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    isConfigured: jest.fn().mockResolvedValue(false),
    setLogLevel: jest.fn(),
    logIn: jest.fn().mockResolvedValue({ customerInfo: {} }),
    logOut: jest.fn().mockResolvedValue({}),
    setEmail: jest.fn(),
    setDisplayName: jest.fn(),
  },
  LOG_LEVEL: { DEBUG: 'DEBUG' },
}));

jest.mock('@config/env', () => ({
  env: { revenueCatIosApiKey: 'test-key' },
  isDevelopment: false,
}));

import { prepareLogIn, settleLogIn, waitForLogIn } from '@services/revenueCat';

describe('revenueCat logIn promise lifecycle', () => {
  it('waitForLogIn returns false when no logIn was prepared', async () => {
    const result = await waitForLogIn();
    expect(result).toBe(false);
  });

  it('waitForLogIn resolves true after settleLogIn(true)', async () => {
    prepareLogIn();
    settleLogIn(true);
    const result = await waitForLogIn();
    expect(result).toBe(true);
  });

  it('waitForLogIn resolves false after settleLogIn(false)', async () => {
    prepareLogIn();
    settleLogIn(false);
    const result = await waitForLogIn();
    expect(result).toBe(false);
  });

  /**
   * BUG REPRODUCTION: settleLogIn clears logInPromise immediately.
   *
   * Scenario: settleLogIn(true) fires, then PaywallScreen calls
   * waitForLogIn() AFTER settleLogIn has already completed.
   * Expected: should get `true` (the login succeeded).
   * Actual (before fix): gets `false` because logInPromise was nulled.
   */
  it('BUG: waitForLogIn called AFTER settleLogIn returns false instead of cached result', async () => {
    prepareLogIn();
    settleLogIn(true);

    // Simulate a small delay (paywall screen mounts after settleLogIn)
    await new Promise((resolve) => setTimeout(resolve, 10));

    // This call happens after settleLogIn has already cleared logInPromise
    const result = await waitForLogIn();

    // This assertion captures the bug: we EXPECT true, but the current
    // implementation returns false because logInPromise was set to null.
    expect(result).toBe(true);
  });

  it('prepareLogIn settles previous pending promise with false', async () => {
    prepareLogIn();
    const firstPromise = waitForLogIn();

    // Calling prepareLogIn again should settle the first promise
    prepareLogIn();
    const firstResult = await firstPromise;
    expect(firstResult).toBe(false);

    // The new promise should still be pending until settled
    settleLogIn(true);
    const secondResult = await waitForLogIn();
    expect(secondResult).toBe(true);
  });
});
