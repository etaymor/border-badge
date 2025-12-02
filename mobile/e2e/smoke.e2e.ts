/**
 * Smoke tests - verify the app launches and basic navigation works
 */

import { device, by, waitForEither } from './init';

describe('App Launch', () => {
  beforeAll(async () => {
    await device.launchApp();
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it('should launch the app successfully', async () => {
    // App should launch without crashing
    // Should see either welcome screen (not logged in) or main tabs (logged in)
    await waitForEither(by.id('welcome-get-started-button'), by.label('trips-tab'), 15000);
  });

  it('should show the onboarding or home screen', async () => {
    // Depending on auth state, should show either onboarding carousel or main tabs
    await waitForEither(by.text('Hello, Explorer!'), by.label('trips-tab'), 15000);
  });
});

describe('Navigation', () => {
  beforeAll(async () => {
    await device.launchApp();
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  // Note: These tests require user to be logged in
  // The auth.e2e.ts and trips.e2e.ts files handle logged-in scenarios

  it('should show welcome or logged in state', async () => {
    // Verify the app is in a valid state - either welcome or main screen
    await waitForEither(by.id('welcome-get-started-button'), by.label('trips-tab'), 15000);
  });
});
