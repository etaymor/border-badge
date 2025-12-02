/**
 * E2E test initialization and helpers
 */

import { device, element, by, expect, waitFor } from 'detox';

// Re-export Detox APIs for convenience
export { device, element, by, expect, waitFor };

/**
 * Test user configuration
 * Uses unique emails per test run since email verification is disabled in Supabase
 */
export const testData = {
  /** Generate a unique email for this test run */
  uniqueEmail: () => `test+${Date.now()}@example.com`,
  /** Generate a unique trip name */
  uniqueTripName: () => `Test Trip ${Date.now()}`,
  /** Generate a unique entry name */
  uniqueEntryName: () => `Test Entry ${Date.now()}`,
  /** Standard password that meets complexity requirements */
  testPassword: 'TestPassword123!',
};

/**
 * Wait for app to be ready after launch
 */
export async function waitForAppReady(): Promise<void> {
  // Wait for loading screen to disappear
  await waitFor(element(by.id('loading-screen')))
    .not.toBeVisible()
    .withTimeout(10000);
}

/**
 * Sign up a new user
 * Note: Email verification is disabled, so users are auto-verified
 */
export async function signUp(email: string, password: string): Promise<void> {
  // Navigate to sign up screen from welcome
  await element(by.id('welcome-get-started-button')).tap();

  // Fill in sign up form
  await element(by.id('signup-email-input')).typeText(email);
  await element(by.id('signup-password-input')).typeText(password);
  await element(by.id('signup-confirm-password-input')).typeText(password);

  // Submit
  await element(by.id('signup-submit-button')).tap();

  // Wait for onboarding to start (or main screen if onboarding completed)
  await waitFor(element(by.id('start-journey-button')).or(element(by.id('trips-tab'))))
    .toBeVisible()
    .withTimeout(15000);
}

/**
 * Login helper for tests that require authentication
 */
export async function login(email: string, password: string): Promise<void> {
  // Navigate to login if on welcome screen
  try {
    const loginButton = element(by.id('welcome-login-button'));
    await waitFor(loginButton).toBeVisible().withTimeout(3000);
    await loginButton.tap();
  } catch {
    // Might already be on login screen
  }

  // Fill credentials
  await element(by.id('login-email-input')).typeText(email);
  await element(by.id('login-password-input')).typeText(password);
  await element(by.id('login-submit-button')).tap();

  // Wait for successful login - either onboarding or main tabs
  await waitFor(element(by.id('start-journey-button')).or(element(by.id('trips-tab'))))
    .toBeVisible()
    .withTimeout(15000);
}

/**
 * Complete onboarding flow with minimal selections
 */
export async function completeOnboarding(): Promise<void> {
  // Swipe through carousel to get to CTA
  const carousel = element(by.type('RCTScrollView'));
  for (let i = 0; i < 3; i++) {
    await carousel.swipe('left');
  }

  // Start journey
  await element(by.id('start-journey-button')).tap();

  // Skip motivation step
  await waitFor(element(by.text('Skip')))
    .toBeVisible()
    .withTimeout(5000);
  await element(by.text('Skip')).tap();

  // Skip home country
  await waitFor(element(by.id('home-country-skip-button')))
    .toBeVisible()
    .withTimeout(5000);
  await element(by.id('home-country-skip-button')).tap();

  // Skip dream destination
  await waitFor(element(by.text('Skip')))
    .toBeVisible()
    .withTimeout(5000);
  await element(by.text('Skip')).tap();

  // Skip country selection (go through all continents)
  for (let i = 0; i < 6; i++) {
    await waitFor(element(by.id('save-continue-button')))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.id('save-continue-button')).tap();
  }

  // Wait for main screen
  await waitFor(element(by.label('trips-tab')))
    .toBeVisible()
    .withTimeout(10000);
}

/**
 * Logout helper
 */
export async function logout(): Promise<void> {
  // Navigate to profile tab
  await element(by.label('profile-tab')).tap();

  // Tap sign out
  await waitFor(element(by.id('sign-out-button')))
    .toBeVisible()
    .withTimeout(5000);
  await element(by.id('sign-out-button')).tap();

  // Wait for welcome screen or login screen
  await waitFor(
    element(by.id('welcome-get-started-button')).or(element(by.id('login-submit-button')))
  )
    .toBeVisible()
    .withTimeout(10000);
}

/**
 * Navigate to a specific tab
 * Note: Uses accessibility labels since React Navigation 7 doesn't support testID on tab buttons
 */
export async function navigateToTab(tabId: 'passport' | 'trips' | 'profile'): Promise<void> {
  await element(by.label(`${tabId}-tab`)).tap();
}

/**
 * Clear app state between tests
 */
export async function clearAppState(): Promise<void> {
  await device.clearKeychain();
  await device.launchApp({ newInstance: true, delete: true });
}

/**
 * Type text slowly (for inputs that have validation/debouncing)
 */
export async function typeTextSlowly(elementId: string, text: string): Promise<void> {
  const input = element(by.id(elementId));
  for (const char of text) {
    await input.typeText(char);
    // Small delay between characters
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Scroll until element is visible
 */
export async function scrollToElement(
  scrollViewId: string,
  elementId: string,
  direction: 'up' | 'down' = 'down'
): Promise<void> {
  await waitFor(element(by.id(elementId)))
    .toBeVisible()
    .whileElement(by.id(scrollViewId))
    .scroll(200, direction);
}

/**
 * Create a new trip and return to trips list
 */
export async function createTrip(name: string, _countryCode = 'USA'): Promise<void> {
  // Navigate to trips tab
  await element(by.label('trips-tab')).tap();

  // Tap FAB or empty state button to add trip
  try {
    await element(by.id('fab-add-trip')).tap();
  } catch {
    await element(by.id('empty-add-trip-button')).tap();
  }

  // Fill trip form
  await element(by.id('trip-name-input')).typeText(name);

  // Save
  await element(by.id('trip-save-button')).tap();

  // Wait for trips list
  await waitFor(element(by.id('trips-list')).or(element(by.id('empty-add-trip-button'))))
    .toBeVisible()
    .withTimeout(10000);
}

/**
 * Delete a trip by navigating to it and using the delete button
 */
export async function deleteTrip(tripName: string): Promise<void> {
  // Tap on the trip card
  await element(by.text(tripName)).tap();

  // Wait for trip detail screen
  await waitFor(element(by.id('delete-trip-button')))
    .toBeVisible()
    .withTimeout(5000);

  // Tap delete
  await element(by.id('delete-trip-button')).tap();

  // Confirm deletion
  await waitFor(element(by.id('delete-trip-dialog-confirm')))
    .toBeVisible()
    .withTimeout(3000);
  await element(by.id('delete-trip-dialog-confirm')).tap();

  // Wait for navigation back or undo snackbar
  await waitFor(element(by.label('trips-tab')))
    .toBeVisible()
    .withTimeout(5000);
}
