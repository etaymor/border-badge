/**
 * Smoke tests - verify the app launches and basic navigation works
 */

import { device, element, by, expect } from 'detox';

describe('App Launch', () => {
  beforeAll(async () => {
    await device.launchApp();
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it('should launch the app successfully', async () => {
    // App should launch without crashing
    // Look for any visible element to confirm app rendered
    await expect(element(by.type('RCTView')).atIndex(0)).toExist();
  });

  it('should show the onboarding or home screen', async () => {
    // Depending on auth state, should show either onboarding or home
    // At minimum, something should be visible
    await expect(element(by.type('RCTView')).atIndex(0)).toExist();
  });
});

describe('Navigation', () => {
  beforeAll(async () => {
    await device.launchApp();
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  // Note: These tests assume user is logged in
  // In a real scenario, you'd set up auth state first

  it('should navigate between tabs', async () => {
    // This test will need to be updated once testIDs are added to the app
    // For now, it serves as a placeholder for navigation testing
    await expect(element(by.type('RCTView')).atIndex(0)).toExist();
  });
});
